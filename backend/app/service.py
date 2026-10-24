"""Glue between storage, selection and metrics. Pure functions taking DataFrames where possible."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from . import metrics, planning, selection
from . import config
from .config import DEFAULT_BAND_COVERAGE, DEFAULT_CUTOFF, UK_TZ


def _iso(ts) -> Optional[str]:
    return None if pd.isna(ts) else ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _compact(x: float):
    """19412.0 -> 19412 (smaller JSON); other values rounded to 1 dp."""
    x = round(float(x), 1)
    return int(x) if x.is_integer() else x


def build_eval_frame(forecasts, actuals, cutoff, basis="decision") -> pd.DataFrame:
    """Rows of (forecast, actual) pairs aligned on start_time.

    basis='decision': one forecast per target (latest before cutoff) - what the buyer saw.
    basis='all':      every published vintage with horizon > 0 - used to study error vs horizon.
    """
    if basis == "decision":
        fc = selection.select_latest_forecasts(forecasts, cutoff)
    else:
        fc = selection.add_horizon(forecasts)
        fc = fc[fc["horizon_h"] > 0].copy()
        fc["delivery_day"] = selection.delivery_day_of(fc["start_time"])
    df = metrics.add_errors(selection.join_actuals(fc, actuals))
    return df.dropna(subset=["actual"]).reset_index(drop=True)


def _window():
    return date.fromisoformat(config.DATA_FIRST_DAY), date.fromisoformat(config.DATA_LAST_DAY)


def decision(forecasts, actuals, day: date, cutoff=DEFAULT_CUTOFF,
             coverage=DEFAULT_BAND_COVERAGE, band_basis=config.DEFAULT_BAND_BASIS, cost_ratio: float = config.DEFAULT_COST_RATIO,
             margin_by: str = config.DEFAULT_MARGIN_BY, demand: Optional[float] = None,
             ramp_mw: Optional[float] = None) -> dict:
    ct = selection.parse_cutoff(cutoff)
    sel = selection.select_latest_forecasts(forecasts, cutoff)
    sel = sel[sel["delivery_day"] == day]
    joined = selection.join_actuals(sel, actuals)

    # Error history the decision may learn from: window days only (the snapshot also holds a few slack
    # days such as 1 Jan / 2 Feb), and with band_basis='prior' only days <= D-2 (known at the cutoff).
    first, last = _window()
    ev_all = build_eval_frame(forecasts, actuals, cutoff, "decision")
    hist = planning.history_for(ev_all, day, band_basis, first, last)
    band = metrics.error_band(hist["error"], coverage)

    # Cost-aware margin, optionally by wind level (terciles of the history's forecasts).
    q = planning.cost_quantile(cost_ratio)
    table = planning.margin_table(hist, q, coverage, margin_by)
    hm = planning.hourly_margins(joined["forecast"], table)
    plan_wind = [None if m is None or pd.isna(m) else max(0.0, float(f) - m) for f, m in zip(joined["forecast"], hm["margin"])]
    nb = None
    if demand is not None and table["available"]:
        nb = planning.net_buy(joined["forecast"], plan_wind, float(demand))
    elif demand is not None:  # no margin yet (too little history): buy figures without cover only
        nb = planning.net_buy(joined["forecast"], joined["forecast"], float(demand))
        for ph in nb["per_hour"]:
            ph["net_cover"] = ph["buy_cover"] = None
        nb["summary"].update(avg_buy_cover=None, buy_cover_mwh=None, spare_cover_hours=None)

    rows = []
    for i, r in enumerate(joined.itertuples()):
        a = None if pd.isna(r.actual) else float(r.actual)
        h = hm.iloc[i]
        lo, hi = (h["lo"], h["hi"]) if table["available"] else (band["lo"], band["hi"])
        row = {
            "start_time": _iso(r.start_time), "forecast": float(r.forecast), "actual": a,
            "publish_time": _iso(r.publish_time), "horizon_h": round(r.horizon_h, 2),
            # usual range around the forecast: actual ~ forecast - error  =>  [forecast - hi, forecast - lo]
            "lower": None if hi is None else max(0.0, float(r.forecast) - hi),
            "upper": None if lo is None else float(r.forecast) - lo,
            "level": h["level"], "margin": None if pd.isna(h["margin"]) else float(h["margin"]),
            "plan": plan_wind[i],
        }
        if nb is not None:
            row.update(nb["per_hour"][i])
        rows.append(row)

    # Ramp watch: forecast change within 1-3 hours, read from the version actually used.
    sizes_today = planning.ramp_sizes(joined, forecasts)
    sizes_hist = planning.ramp_sizes(hist, forecasts)
    auto_r = planning.ramp_threshold(sizes_hist)
    threshold = ramp_mw if ramp_mw is not None else auto_r
    for i, r in enumerate(rows):
        sz = sizes_today.iloc[i] if len(sizes_today) else None
        r["ramp_size"] = None if sz is None or pd.isna(sz) else round(float(sz), 1)
        r["ramp"] = bool(threshold is not None and r["ramp_size"] is not None and r["ramp_size"] >= threshold)
    ramps = {"threshold": threshold, "source": "user" if ramp_mw is not None else "auto", "auto_threshold": auto_r,
             "hours_today": sum(r["ramp"] for r in rows),
             "history": planning.ramp_error_stats(hist, sizes_hist, threshold) if threshold is not None else None}

    # Forecast stability: versions of this day's forecast published in the 24 h up to the cutoff.
    cut_ts = selection.cutoff_utc(day, ct)
    versions = planning.day_average_by_version(forecasts, joined["start_time"], cut_ts)
    stability = {"versions": [{"publish_time": _iso(v["publish_time"]), "day_avg": metrics._num(v["day_avg"])} for v in versions],
                 "revision": metrics._num(planning.revision_of(versions)),
                 "history": _stability_history(forecasts, hist, cutoff)}

    # How wrong can the forecast be? Always learned from days already known at the cutoff, whatever band_basis is.
    known_hist = planning.history_for(ev_all, day, "prior", first, last)
    how_wrong = planning.exceedance_table(known_hist)
    day_level = planning.assign_levels([sel["forecast"].mean()], how_wrong["cuts"])[0] if len(sel) and how_wrong["cuts"] else None
    how_wrong.update(day_level=day_level, basis="prior")

    # What if wind is lower than forecast? Reserve and bad-hour miss from days already known at the cutoff only.
    known_table = planning.margin_table(known_hist, q, coverage, margin_by)
    known_res = planning.hourly_margins(joined["forecast"], known_table)["margin"]
    bad = planning.bad_hour_mw(known_hist)
    what_if = {"basis": "prior", "reserve_known": known_table["available"],
               "reserve_avg": metrics._num(np.maximum(known_res.astype(float), 0).mean()) if known_table["available"] and len(joined) else None,
               "same_reserve_as_plan": band_basis == "prior", "bad_hour": bad,
               "scenarios": planning.what_if(joined["forecast"], known_res.astype(float).to_numpy() if known_table["available"] else None,
                                             bad["mw"], float(demand) if demand is not None else None)}

    margins = [r["margin"] for r in rows if r["margin"] is not None]
    day_actuals = actuals[selection.delivery_day_of(actuals["start_time"]) == day]
    known = joined.dropna(subset=["actual"])
    day_err = metrics.add_errors(known) if len(known) else known
    return {
        "day": day.isoformat(), "cutoff_local": f"{(day - timedelta(days=1)).isoformat()} {cutoff}",
        "cutoff_utc": _iso(selection.cutoff_utc(day, ct)),
        "latest_publish_time": _iso(sel["publish_time"].max()) if len(sel) else None,
        "band": {**band, "basis": band_basis, "n": int(len(hist))},
        "margin": {"cost_ratio": cost_ratio, "q": table["q"], "method": margin_by, "basis": band_basis,
                   "available": table["available"], "n": table["flat"]["n"], "min_n": table["min_n"],
                   "avg": metrics._num(sum(margins) / len(margins)) if margins else None,
                   "min": metrics._num(min(margins)) if margins else None,
                   "max": metrics._num(max(margins)) if margins else None,
                   "flat": table["flat"], "cuts": table["cuts"], "levels": table["levels"]},
        "demand": nb["summary"] if nb is not None else None,
        "ramps": ramps, "stability": stability, "how_wrong": how_wrong, "what_if": what_if,
        "forecast_mean": metrics._num(sel["forecast"].mean()) if len(sel) else None,
        "forecast_peak": metrics._num(sel["forecast"].max()) if len(sel) else None,
        "forecast_min": metrics._num(sel["forecast"].min()) if len(sel) else None,
        "realised": metrics.summarize(day_err, coverage) if len(known) else None,
        "rows": rows,
        # Full half-hourly actuals for the day (the forecast itself is hourly).
        "actual_series": [{"start_time": _iso(r.start_time), "actual": float(r.actual)}
                          for r in day_actuals.sort_values("start_time").itertuples()],
    }


def _stability_history(forecasts, hist: pd.DataFrame, cutoff: str) -> dict:
    """Across the history days the decision may use: does a bigger revision before the cutoff go with a bigger miss?"""
    ct = selection.parse_cutoff(cutoff)
    rows = []
    for d, g in hist.groupby("delivery_day"):
        v = planning.day_average_by_version(forecasts, g["start_time"], selection.cutoff_utc(d, ct))
        rev = planning.revision_of(v)
        if rev is not None:
            rows.append({"revision": abs(rev), "mae": g["error"].abs().mean()})
    df = pd.DataFrame(rows, columns=["revision", "mae"])
    test = planning.correlation_test(df["revision"], df["mae"])
    return {**test, "min_n": planning.MIN_N, "enough": test["n"] >= planning.MIN_N}


def recent_bias(forecasts, actuals, cutoff=DEFAULT_CUTOFF) -> dict:
    """Does the recent mean error carry over? Lag tests on daily mean error, and a walk-forward correction test.

    The primary rule (decided before looking at results) is k = 3: the last three days known at the cutoff.
    lowers_mae reports whether that rule lowers the hourly MAE. No adjusted forecast is offered in the app: the gain
    comes from the FUELHH level gap, not from a real day-to-day pattern (see docs/DESIGN.md).
    """
    first, last = _window()
    ev = build_eval_frame(forecasts, actuals, cutoff, "decision")
    ev = ev[(ev["delivery_day"] >= first) & (ev["delivery_day"] <= last)]
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    daily = planning.daily_mean_error(ev)
    primary = planning.bias_correction_backtest(ev, days, 3)
    expanding = planning.bias_correction_backtest(ev, days, None)
    lowers_mae = primary["mae_corrected"] is not None and primary["mae_corrected"] < primary["mae_raw"]
    return {"cutoff": cutoff, "lag_1": planning.lag_test(daily, 1), "lag_2": planning.lag_test(daily, 2),
            "primary": primary, "all_known_days": expanding, "lowers_mae": lowers_mae,
            "daily": [{"day": d.isoformat(), "mean_error": metrics._num(v)} for d, v in daily.items()]}


def baseline(forecasts, actuals, start: date, end: date, cutoff=DEFAULT_CUTOFF) -> dict:
    """Decision-time forecast vs naive persistence guesses on the same hours."""
    ev = build_eval_frame(forecasts, actuals, cutoff, "decision")
    ev = ev[(ev["delivery_day"] >= start) & (ev["delivery_day"] <= end)].reset_index(drop=True)
    g2 = planning.persistence_guess(ev, actuals, 2)
    g1 = planning.persistence_guess(ev, actuals, 1)
    both = g2.notna() & g1.notna()          # judge every guess on exactly the same hours
    sub = ev[both]
    return {"start": start.isoformat(), "end": end.isoformat(), "cutoff": cutoff,
            "guesses": [
                {"name": "two_days_before", "known_at_cutoff": True, **planning.skill_vs_guess(sub, g2[both])},
                {"name": "yesterday", "known_at_cutoff": False, **planning.skill_vs_guess(sub, g1[both])},
            ],
            "hours_without_guess": int((~both).sum())}


def replay(forecasts, actuals, cutoff=DEFAULT_CUTOFF, cost_ratio: float = config.DEFAULT_COST_RATIO,
           margin_by: str = config.DEFAULT_MARGIN_BY, price_short: Optional[float] = None,
           price_unused: Optional[float] = None, coverage=DEFAULT_BAND_COVERAGE) -> dict:
    """"If you had followed this plan" over every window day, with the margin known at each day's cutoff."""
    first, last = _window()
    ev = build_eval_frame(forecasts, actuals, cutoff, "decision")
    ev = ev[(ev["delivery_day"] >= first) & (ev["delivery_day"] <= last)]
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    res = planning.replay(ev, days, planning.cost_quantile(cost_ratio), margin_by, coverage,
                          price_short=price_short, price_unused=price_unused)
    return {"cutoff": cutoff, "cost_ratio": cost_ratio, "basis": "prior", **res}


def tradeoff(forecasts, actuals, cutoff=DEFAULT_CUTOFF, margin_by: str = config.DEFAULT_MARGIN_BY,
             cost_ratio: float = config.DEFAULT_COST_RATIO, coverage=DEFAULT_BAND_COVERAGE) -> dict:
    """How much backup is worth it: the replay for several cost settings (plus the current one)."""
    first, last = _window()
    ev = build_eval_frame(forecasts, actuals, cutoff, "decision")
    ev = ev[(ev["delivery_day"] >= first) & (ev["delivery_day"] <= last)]
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    ratios = sorted(set(planning.TRADEOFF_RATIOS) | {float(cost_ratio)})
    return {"cutoff": cutoff, "method": margin_by, "basis": "prior", "current_ratio": float(cost_ratio),
            "rows": planning.tradeoff(ev, days, ratios, margin_by, coverage)}


def cutoff_compare(forecasts, actuals, cutoffs=("06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00")) -> dict:
    first, last = _window()
    rows = []
    for c in cutoffs:
        ev = build_eval_frame(forecasts, actuals, c, "decision")
        rows.append(planning.cutoff_row(ev[(ev["delivery_day"] >= first) & (ev["delivery_day"] <= last)], c))
    return {"rows": rows, "default_cutoff": DEFAULT_CUTOFF}


def margin_check(forecasts, actuals, cutoff=DEFAULT_CUTOFF, cost_ratio: float = config.DEFAULT_COST_RATIO,
                 margin_by: str = config.DEFAULT_MARGIN_BY, coverage=DEFAULT_BAND_COVERAGE) -> dict:
    """Walk-forward check of the margin over every window day, using only days known at each cutoff."""
    first, last = _window()
    ev = build_eval_frame(forecasts, actuals, cutoff, "decision")
    ev = ev[(ev["delivery_day"] >= first) & (ev["delivery_day"] <= last)]
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    q = planning.cost_quantile(cost_ratio)
    res = planning.backtest(ev, days, q, margin_by, coverage)
    # The same check with the other method, so the page can say honestly whether the wind-level split helps.
    other = "flat" if margin_by == "level" else "level"
    alt = planning.backtest(ev, days, q, other, coverage)
    compare = {k: alt[k] for k in ("achieved", "margin_avg", "n_hours", "by_level")}
    return {"cutoff": cutoff, "cost_ratio": cost_ratio, "method": margin_by, "basis": "prior", **res,
            "compare": {"method": other, **compare}}


def accuracy(forecasts, actuals, start: date, end: date, cutoff=DEFAULT_CUTOFF,
             basis="decision", min_h: Optional[float] = None, max_h: Optional[float] = None,
             coverage=DEFAULT_BAND_COVERAGE, max_points: int = 1500) -> dict:
    df = build_eval_frame(forecasts, actuals, cutoff, basis)
    df = df[(df["delivery_day"] >= start) & (df["delivery_day"] <= end)]
    if min_h is not None:
        df = df[df["horizon_h"] >= min_h]
    if max_h is not None:
        df = df[df["horizon_h"] <= max_h]
    df = df.copy()
    df["hour"] = df["start_time"].dt.tz_convert(UK_TZ).dt.hour
    df["day"] = df["delivery_day"].astype(str)
    df["horizon_bin"] = (df["horizon_h"] // 3 * 3).astype(int)  # 3-hour buckets

    step = max(1, len(df) // max_points)
    pts = df.sort_values("start_time").iloc[::step]
    return {
        "filters": {"start": start.isoformat(), "end": end.isoformat(), "cutoff": cutoff,
                    "basis": basis, "min_h": min_h, "max_h": max_h},
        "summary": metrics.summarize(df, coverage),
        "by_horizon": metrics.group_metrics(df, "horizon_bin"),
        "by_hour": metrics.group_metrics(df, "hour"),
        "by_day": metrics.group_metrics(df, "day"),
        "histogram": metrics.histogram(df["error"]),
        "by_daytype": planning.daytype_profile(df),
        "points": [{"start_time": _iso(r.start_time), "forecast": _compact(r.forecast), "actual": _compact(r.actual),
                    "horizon_h": round(r.horizon_h, 1)}
                   for r in pts.itertuples()],
    }
