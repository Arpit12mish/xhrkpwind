"""Planning tools for the day-ahead buyer: cost-aware margin, margin by wind level, net buy, margin check.

All functions are pure (DataFrames in, plain dicts/frames out). They only ever see the history they are
given; `history_for` is the single place that decides which past hours a decision for day D may use.

Conventions (same as metrics.py): error = forecast - actual, so a positive error is a shortfall of wind.
A margin m means "plan for forecast - m". The hour is covered when actual >= forecast - m, i.e. error <= m.
"""
from __future__ import annotations

import warnings
from datetime import date, timedelta
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

MIN_N = 30                      # smallest sample we will quote a band-specific number for
LEVELS = ("low", "mid", "high")
COST_RATIO_MIN, COST_RATIO_MAX = 1.0, 10.0


def _f(x) -> Optional[float]:
    if x is None:
        return None
    x = float(x)
    return None if np.isnan(x) or np.isinf(x) else round(x, 3)


# ---------------------------------------------------------------------------------------------- cost
def cost_quantile(ratio: float) -> float:
    """Newsvendor quantile. A shortfall costs `ratio` times a surplus (surplus cost = 1).

    Minimising expected cost of planning for wind w gives P(actual < w) = 1 / (ratio + 1), i.e. the
    margin is the q-quantile of the error with q = ratio / (ratio + 1). It covers about q of hours.
    """
    if ratio is None or not np.isfinite(ratio) or not COST_RATIO_MIN <= ratio <= COST_RATIO_MAX:
        raise ValueError(f"cost ratio must be between {COST_RATIO_MIN:g} and {COST_RATIO_MAX:g}")
    return ratio / (ratio + 1.0)


# --------------------------------------------------------------------------------------------- history
def history_for(eval_frame: pd.DataFrame, day: date, band_basis: str, first: date, last: date) -> pd.DataFrame:
    """Past (forecast, actual) hours a decision for `day` may learn from.

    'all'   : every window day (in-sample; the existing default, documented as slightly optimistic).
    'prior' : only days <= D-2, whose actuals were complete before the D-1 cutoff (no look-ahead).
    """
    dd = eval_frame["delivery_day"]
    h = eval_frame[(dd >= first) & (dd <= last)]
    if band_basis == "prior":
        h = h[h["delivery_day"] <= day - timedelta(days=2)]
    return h


# ------------------------------------------------------------------------------------------- wind level
def level_cuts(values) -> Optional[List[float]]:
    """Tercile cut points of forecast values; None if there are too few values to split."""
    v = pd.Series(values, dtype="float64").dropna()
    if len(v) < 3:
        return None
    return [float(np.quantile(v, 1 / 3)), float(np.quantile(v, 2 / 3))]


def assign_levels(values, cuts: Optional[List[float]]) -> np.ndarray:
    v = np.asarray(values, dtype="float64")
    if cuts is None:
        return np.array([None] * len(v), dtype=object)
    return np.where(v <= cuts[0], "low", np.where(v <= cuts[1], "mid", "high")).astype(object)


def _stats(err: pd.Series, q: float, coverage: float) -> Dict:
    e = pd.Series(err, dtype="float64").dropna()
    if e.empty:
        return {"n": 0, "typical_miss": None, "margin": None, "lo": None, "hi": None}
    tail = (1 - coverage) / 2
    return {"n": int(len(e)), "typical_miss": _f(e.abs().mean()), "margin": _f(np.quantile(e, q)),
            "lo": _f(np.quantile(e, tail)), "hi": _f(np.quantile(e, 1 - tail))}


def margin_table(hist: pd.DataFrame, q: float, coverage: float = 0.8, method: str = "level",
                 min_n: int = MIN_N) -> Dict:
    """Margins learned from `hist` (columns: forecast, error).

    flat  : one margin for every hour (q-quantile of all errors).
    level : hours split into low/mid/high forecast terciles (cut points from hist's own forecasts);
            each level gets its own q-quantile, but falls back to the flat value when it has < min_n hours.
    available is False when even the flat sample is smaller than min_n: then no margin is quoted at all.
    """
    flat = _stats(hist["error"], q, coverage)
    cuts = level_cuts(hist["forecast"])
    levels = assign_levels(hist["forecast"], cuts)
    out_levels = []
    for i, name in enumerate(LEVELS):
        own = _stats(hist["error"][levels == name], q, coverage) if cuts else _stats(pd.Series(dtype="float64"), q, coverage)
        fallback = method == "flat" or own["n"] < min_n
        out_levels.append({
            "level": name,
            "forecast_from": None if not cuts or i == 0 else _f(cuts[i - 1]),
            "forecast_to": None if not cuts or i == 2 else _f(cuts[i]),
            "own": own,
            "fallback": bool(fallback),
            "used": flat if fallback else own,
        })
    return {"method": method, "q": _f(q), "coverage": coverage, "min_n": min_n,
            "available": flat["n"] >= min_n, "cuts": cuts, "flat": flat, "levels": out_levels}


def hourly_margins(forecasts, table: Dict) -> pd.DataFrame:
    """Per-hour level, margin and usual-range offsets for the given forecast values."""
    f = np.asarray(forecasts, dtype="float64")
    lv = assign_levels(f, table["cuts"])
    by = {x["level"]: x for x in table["levels"]}
    rows = []
    for level in lv:
        if not table["available"]:
            rows.append({"level": level, "margin": None, "lo": None, "hi": None, "fallback": None})
            continue
        entry = by.get(level)
        used = entry["used"] if entry else table["flat"]
        rows.append({"level": level, "margin": used["margin"], "lo": used["lo"], "hi": used["hi"],
                     "fallback": bool(entry["fallback"]) if entry else True})
    return pd.DataFrame(rows, columns=["level", "margin", "lo", "hi", "fallback"])


# --------------------------------------------------------------------------------------------- net buy
def net_buy(forecast, plan, demand: float) -> Dict:
    """Power to buy beyond wind, per hour (hourly forecast => 1 hour per value) and for the day.

    net  = demand - forecast (negative = wind alone exceeds demand); buy = max(0, net).
    With cover: the same against the planned wind (forecast - margin).
    """
    f = np.asarray(forecast, dtype="float64")
    p = np.asarray(plan, dtype="float64")
    net = demand - f
    net_cover = demand - p
    buy, buy_cover = np.maximum(net, 0.0), np.maximum(net_cover, 0.0)
    n = len(f)
    return {
        "per_hour": [{"net": _f(a), "buy": _f(b), "net_cover": _f(c), "buy_cover": _f(d)}
                     for a, b, c, d in zip(net, buy, net_cover, buy_cover)],
        "summary": {
            "demand": _f(demand), "hours": n,
            "avg_buy": _f(buy.mean()) if n else None, "avg_buy_cover": _f(buy_cover.mean()) if n else None,
            "buy_mwh": _f(buy.sum()), "buy_cover_mwh": _f(buy_cover.sum()),
            "spare_hours": int((net < 0).sum()), "spare_cover_hours": int((net_cover < 0).sum()),
        },
    }


# ------------------------------------------------------------------------------------------ margin check
def backtest(eval_window: pd.DataFrame, days: List[date], q: float, method: str = "level",
             coverage: float = 0.8, min_n: int = MIN_N) -> Dict:
    """Walk forward through `days`: margin for day D learned only from days <= D-2, then scored on D.

    `eval_window` needs delivery_day, forecast, error. Days with too little history are skipped (listed).
    """
    scored, skipped = [], []
    for d in days:
        hist = eval_window[eval_window["delivery_day"] <= d - timedelta(days=2)]
        table = margin_table(hist, q, coverage, method, min_n)
        today = eval_window[eval_window["delivery_day"] == d]
        if not table["available"] or today.empty:
            skipped.append(d.isoformat())
            continue
        hm = hourly_margins(today["forecast"], table)
        part = pd.DataFrame({"day": d.isoformat(), "level": hm["level"].values,
                             "margin": hm["margin"].values.astype("float64"),
                             "covered": today["error"].values <= hm["margin"].values.astype("float64")})
        scored.append(part)
    if not scored:
        return {"target": _f(q), "achieved": None, "margin_avg": None, "n_hours": 0, "n_days": 0,
                "skipped_days": skipped, "by_day": [], "by_level": []}
    s = pd.concat(scored, ignore_index=True)
    by_day = [{"day": k, "n": int(len(g)), "achieved": _f(g["covered"].mean()), "margin_avg": _f(g["margin"].mean())}
              for k, g in s.groupby("day", sort=True)]
    by_level = [{"level": k, "n": int(len(g)), "achieved": _f(g["covered"].mean())}
                for k, g in s.groupby("level", sort=False) if k is not None]
    by_level.sort(key=lambda r: LEVELS.index(r["level"]))
    return {"target": _f(q), "achieved": _f(s["covered"].mean()), "margin_avg": _f(s["margin"].mean()), "n_hours": int(len(s)),
            "n_days": len(by_day), "skipped_days": skipped, "by_day": by_day, "by_level": by_level}


# =============================================================================================== Tier 2
# ---------------------------------------------------------------------------------------- ramp watch
def ramp_sizes(rows: pd.DataFrame, forecasts: pd.DataFrame, max_lag_h: int = 3) -> pd.Series:
    """Largest change of the forecast over the previous 1..max_lag_h hours, read from the SAME forecast version.

    rows: start_time, publish_time (the version used for that hour). forecasts: every version (start_time,
    publish_time, forecast). Using one version avoids counting a jump between two versions as a ramp.
    NaN where none of the earlier hours exist in that version.
    """
    if rows.empty:
        return pd.Series(dtype="float64")
    look = forecasts.set_index(["publish_time", "start_time"])["forecast"]
    look = look[~look.index.duplicated(keep="last")]
    here = look.reindex(pd.MultiIndex.from_arrays([rows["publish_time"], rows["start_time"]])).to_numpy()
    sizes = []
    for k in range(1, max_lag_h + 1):
        before = look.reindex(pd.MultiIndex.from_arrays([rows["publish_time"], rows["start_time"] - pd.Timedelta(hours=k)])).to_numpy()
        sizes.append(np.abs(here - before))
    with warnings.catch_warnings():   # an hour with no earlier value in its version is expected (-> NaN)
        warnings.simplefilter("ignore", RuntimeWarning)
        out = np.nanmax(np.vstack(sizes), axis=0) if len(sizes) else np.full(len(rows), np.nan)
    return pd.Series(out, index=rows.index, dtype="float64")


def ramp_threshold(history_sizes: pd.Series, pct: float = 0.9) -> Optional[float]:
    s = pd.Series(history_sizes, dtype="float64").dropna()
    return _f(np.quantile(s, pct)) if len(s) else None


def ramp_error_stats(hist: pd.DataFrame, sizes: pd.Series, threshold: float, min_n: int = MIN_N) -> Dict:
    """Error size in ramp hours vs other hours, from history only. Sizes only, no timing claim."""
    is_ramp = sizes >= threshold

    def st(e):
        e = pd.Series(e, dtype="float64").dropna()
        return {"n": int(len(e)), "typical_miss": _f(e.abs().mean()) if len(e) else None,
                "bad_hour": _f(np.percentile(e.abs(), 90)) if len(e) else None}
    ramp, calm = st(hist["error"][is_ramp.values]), st(hist["error"][~is_ramp.values])
    enough = ramp["n"] >= min_n and calm["n"] >= min_n
    ratio = _f(ramp["typical_miss"] / calm["typical_miss"]) if enough and calm["typical_miss"] else None
    return {"ramp": ramp, "other": calm, "enough": enough, "min_n": min_n, "ratio": ratio}


# ------------------------------------------------------------------------------------- forecast stability
def day_average_by_version(forecasts: pd.DataFrame, day_hours: pd.Series, cutoff_ts: pd.Timestamp,
                           window_h: int = 24) -> List[Dict]:
    """Day-average forecast from each version published in (cutoff - window_h, cutoff] that covers every hour."""
    want = set(pd.to_datetime(day_hours, utc=True))
    if not want:
        return []
    f = forecasts[(forecasts["publish_time"] > cutoff_ts - pd.Timedelta(hours=window_h))
                  & (forecasts["publish_time"] <= cutoff_ts) & forecasts["start_time"].isin(want)]
    out = []
    for pt, g in f.groupby("publish_time", sort=True):
        if len(set(g["start_time"])) == len(want):
            out.append({"publish_time": pt, "day_avg": float(g["forecast"].mean())})
    return out


def revision_of(versions: List[Dict]) -> Optional[float]:
    """Latest minus earliest day-average among the versions (signed MW); None if fewer than two versions."""
    return None if len(versions) < 2 else versions[-1]["day_avg"] - versions[0]["day_avg"]


def correlation_test(x, y, n_perm: int = 2000, seed: int = 0) -> Dict:
    """Pearson r between x and y with a two-sided permutation p-value (no distribution assumptions)."""
    d = pd.DataFrame({"x": x, "y": y}).dropna()
    n = len(d)
    if n < 3 or d["x"].std() == 0 or d["y"].std() == 0:
        return {"n": n, "r": None, "p": None}
    r = float(np.corrcoef(d["x"], d["y"])[0, 1])
    rng = np.random.default_rng(seed)
    yv = d["y"].to_numpy()
    perm = np.array([np.corrcoef(d["x"], rng.permutation(yv))[0, 1] for _ in range(n_perm)])
    p = float((np.sum(np.abs(perm) >= abs(r) - 1e-12) + 1) / (n_perm + 1))
    return {"n": n, "r": _f(r), "p": _f(p)}


# -------------------------------------------------------------------------------------------- recent bias
def daily_mean_error(ev: pd.DataFrame) -> pd.Series:
    return ev.groupby("delivery_day")["error"].mean().sort_index()


def lag_test(daily: pd.Series, lag: int) -> Dict:
    """Does a day's mean error go with the mean error `lag` days earlier? (only consecutive calendar days)"""
    s = daily.copy()
    s.index = pd.to_datetime(s.index)
    prev = s.copy()
    prev.index = prev.index + pd.Timedelta(days=lag)
    j = pd.concat([s.rename("today"), prev.rename("before")], axis=1).dropna()
    return {"lag_days": lag, **correlation_test(j["before"], j["today"])}


def bias_correction_backtest(ev: pd.DataFrame, days: List[date], k: Optional[int] = 3) -> Dict:
    """Walk-forward: correct day D's forecast by the mean daily error of the last k days known at the cutoff
    (days <= D-2); k=None uses every known day. Compares hourly MAE with and without the correction."""
    daily = daily_mean_error(ev)
    raw_err, cor_err, used, skipped = [], [], [], []
    for d in days:
        known = daily[daily.index <= d - timedelta(days=2)]
        if k is not None:
            known = known.iloc[-k:]
        today = ev[ev["delivery_day"] == d]
        if today.empty or len(known) < (k or 1):
            skipped.append(d.isoformat())
            continue
        c = float(known.mean())
        raw_err.append(today["error"].to_numpy())
        cor_err.append(today["error"].to_numpy() - c)   # (forecast - c) - actual
        used.append(d.isoformat())
    if not used:
        return {"k": k, "n_days": 0, "n_hours": 0, "mae_raw": None, "mae_corrected": None, "skipped_days": skipped}
    r, c = np.concatenate(raw_err), np.concatenate(cor_err)
    return {"k": k, "n_days": len(used), "n_hours": int(len(r)), "mae_raw": _f(np.abs(r).mean()),
            "mae_corrected": _f(np.abs(c).mean()), "skipped_days": skipped}


# ------------------------------------------------------------------------------------- cutoff comparison
def cutoff_row(ev: pd.DataFrame, cutoff: str) -> Dict:
    e = ev["error"]
    return {"cutoff": cutoff, "n": int(len(ev)),
            "versions_utc": sorted(ev["publish_time"].dt.strftime("%H:%M").unique().tolist()),
            "mae": _f(e.abs().mean()) if len(e) else None,
            "bad_hour": _f(np.percentile(e.abs(), 90)) if len(e) else None,
            "bias": _f(e.mean()) if len(e) else None,
            "horizon_min": _f(ev["horizon_h"].min()) if len(ev) else None,
            "horizon_max": _f(ev["horizon_h"].max()) if len(ev) else None}


# =============================================================================================== Tier 3
def persistence_guess(ev: pd.DataFrame, actuals: pd.DataFrame, lag_days: int) -> pd.Series:
    """Naive guess: the recorded wind at the same UK clock hour `lag_days` earlier (DST-safe via local time).

    lag_days=2 is the latest complete day known at a D-1 cutoff; lag_days=1 is NOT known at that cutoff.
    """
    a = actuals.set_index("start_time")["actual"]
    a = a[~a.index.duplicated(keep="last")]
    # Calendar days in local wall-clock time (a plain 48 h would land an hour off across a clock change).
    # A wall-clock time that does not exist, or happens twice, on a clock-change day gets no guess (excluded).
    wall = ev["start_time"].dt.tz_convert("Europe/London").dt.tz_localize(None) - pd.Timedelta(days=lag_days)
    key = wall.dt.tz_localize("Europe/London", nonexistent="NaT", ambiguous="NaT").dt.tz_convert("UTC")
    return pd.Series(a.reindex(key).to_numpy(), index=ev.index, dtype="float64")


def skill_vs_guess(ev: pd.DataFrame, guess: pd.Series) -> Dict:
    """Compare forecast and guess on the same hours. Skill = 1 - forecast error / guess error (positive = forecast better)."""
    ok = guess.notna() & ev["actual"].notna()
    f_err, g_err = ev.loc[ok, "error"], guess[ok] - ev.loc[ok, "actual"]
    if not ok.any():
        return {"n": 0}
    f_mae, g_mae = float(f_err.abs().mean()), float(g_err.abs().mean())
    f_rmse, g_rmse = float(np.sqrt((f_err ** 2).mean())), float(np.sqrt((g_err ** 2).mean()))
    return {"n": int(ok.sum()), "excluded": int((~ok).sum()), "forecast_mae": _f(f_mae), "guess_mae": _f(g_mae),
            "forecast_rmse": _f(f_rmse), "guess_rmse": _f(g_rmse), "guess_bias": _f(g_err.mean()),
            "skill_mae": _f(1 - f_mae / g_mae) if g_mae else None, "skill_rmse": _f(1 - f_rmse / g_rmse) if g_rmse else None}


def daytype_profile(ev: pd.DataFrame, min_days: int = MIN_N) -> Dict:
    """Error on weekdays vs weekends (UK delivery day), with hours, days and a day-level permutation test."""
    wk = ev["delivery_day"].map(lambda d: d.weekday() >= 5)
    groups = []
    for name, flag in (("weekday", False), ("weekend", True)):
        g = ev[wk == flag]
        e = g["error"]
        groups.append({"day_type": name, "days": int(g["delivery_day"].nunique()), "hours": int(len(g)),
                       "typical_miss": _f(e.abs().mean()) if len(e) else None, "bias": _f(e.mean()) if len(e) else None,
                       "bad_hour": _f(np.percentile(e.abs(), 90)) if len(e) else None})
    day = ev.assign(weekend=wk).groupby("delivery_day").agg(mae=("error", lambda e: e.abs().mean()), weekend=("weekend", "first"))
    test = correlation_test(day["weekend"].astype(float), day["mae"])
    enough = all(g["days"] >= min_days for g in groups)
    return {"groups": groups, "test": test, "enough": enough, "min_days": min_days}


# =============================================================================================== "When the forecast is wrong"
EXCEEDANCE_STEPS = (500, 1000, 2000, 3000, 4000)


def _exceed_row(sub: pd.DataFrame, steps) -> Dict:
    e = sub["error"].to_numpy(dtype="float64")
    n = len(e)
    share = lambda mask: _f(mask.mean()) if n else None  # noqa: E731
    return {"n_hours": int(n), "n_days": int(sub["delivery_day"].nunique()) if n else 0,
            "below": [share(e > s) for s in steps],     # wind ended more than s below the forecast (forecast - actual > s)
            "above": [share(e < -s) for s in steps]}    # wind ended more than s above the forecast


def exceedance_table(hist: pd.DataFrame, steps=EXCEEDANCE_STEPS, min_n: int = MIN_N) -> Dict:
    """Share of past hours in which wind ended below / above the forecast by more than each step, overall and by
    forecast level (terciles of the history's own forecasts). A level with fewer than min_n hours is "too few to tell"
    and points to the all-hours row."""
    everything = _exceed_row(hist, steps)
    cuts = level_cuts(hist["forecast"])
    lv = assign_levels(hist["forecast"], cuts)
    levels = []
    for i, name in enumerate(LEVELS):
        own = _exceed_row(hist[lv == name], steps) if cuts else _exceed_row(hist.iloc[0:0], steps)
        levels.append({"level": name, **own,
                       "forecast_from": None if not cuts or i == 0 else _f(cuts[i - 1]),
                       "forecast_to": None if not cuts or i == 2 else _f(cuts[i]),
                       "too_few": own["n_hours"] < min_n})
    return {"steps": list(steps), "min_n": min_n, "available": everything["n_hours"] >= min_n,
            "cuts": cuts, "all": everything, "levels": levels}


# ======================================================================================================= replay
def replay(eval_window: pd.DataFrame, days: List[date], q: float, method: str = "flat", coverage: float = 0.8,
           min_n: int = MIN_N, price_short: Optional[float] = None, price_unused: Optional[float] = None) -> Dict:
    """"If you had followed this plan": walk forward through `days`, holding each day's margin as known at its cutoff
    (learned from days <= D-2), and score it against what happened. Per hour (1 hour per hourly forecast value):
        needed = max(0, forecast - actual); reserve = max(0, margin);
        short = max(0, needed - reserve); unused = max(0, reserve - needed); covered = needed <= reserve.
    Days with too little history are returned with margin_known=False and no figures (not zeros)."""
    out, tot_short, tot_unused, tot_cov, tot_hours = [], 0.0, 0.0, 0, 0
    costs = price_short is not None and price_unused is not None
    for d in days:
        hist = eval_window[eval_window["delivery_day"] <= d - timedelta(days=2)]
        today = eval_window[eval_window["delivery_day"] == d]
        table = margin_table(hist, q, coverage, method, min_n)
        if today.empty:
            continue
        if not table["available"]:
            out.append({"day": d.isoformat(), "margin_known": False, "n_hours": int(len(today)), "known_hours": table["flat"]["n"]})
            continue
        reserve = np.maximum(hourly_margins(today["forecast"], table)["margin"].to_numpy(dtype="float64"), 0.0)
        needed = np.maximum(today["error"].to_numpy(dtype="float64"), 0.0)
        short, unused = np.maximum(needed - reserve, 0.0), np.maximum(reserve - needed, 0.0)
        covered = int((needed <= reserve).sum())
        row = {"day": d.isoformat(), "margin_known": True, "n_hours": int(len(today)),
               "reserve_avg": _f(reserve.mean()), "short_mwh": _f(short.sum()), "unused_mwh": _f(unused.sum()),
               "needed_mwh": _f(needed.sum()), "covered_share": _f(covered / len(today)), "short_hours": int((short > 0).sum())}
        if costs:
            row["cost"] = _f(short.sum() * price_short + unused.sum() * price_unused)
        out.append(row)
        tot_short += short.sum(); tot_unused += unused.sum(); tot_cov += covered; tot_hours += len(today)
    known = [r for r in out if r["margin_known"]]
    totals = {"days_with_margin": len(known), "days_without_margin": len(out) - len(known), "hours": tot_hours,
              "short_mwh": _f(tot_short) if known else None, "unused_mwh": _f(tot_unused) if known else None,
              "covered_share": _f(tot_cov / tot_hours) if tot_hours else None,
              "cost": _f(tot_short * price_short + tot_unused * price_unused) if costs and known else None}
    return {"target": _f(q), "method": method, "days": out, "totals": totals,
            "prices": {"short": price_short, "unused": price_unused} if costs else None}


# =========================================================================================================== what if
WHAT_IF = (("pct10", "10% less wind than forecast", 0.10), ("pct20", "20% less wind than forecast", 0.20),
           ("pct30", "30% less wind than forecast", 0.30), ("bad_hour", "A bad hour from past results", None))


def bad_hour_mw(hist: pd.DataFrame, min_n: int = MIN_N) -> Dict:
    """The existing "bad-hour miss" (90th percentile of the absolute miss), from the given known hours only."""
    e = hist["error"].abs()
    n = len(e)
    return {"mw": _f(np.percentile(e, 90)) if n >= min_n else None, "n_hours": int(n),
            "n_days": int(hist["delivery_day"].nunique()) if n else 0, "available": n >= min_n, "min_n": min_n}


def what_if(forecast, reserve, bad_hour: Optional[float] = None, demand: Optional[float] = None) -> List[Dict]:
    """What-if scenarios (not predictions). Wind is assumed to come in below the forecast by a share of it, or by the
    bad-hour miss (never below zero). Per hour: drop = forecast - what-if wind; covered = min(drop, reserve);
    left = drop - covered (bought at the last minute). With a demand: extra buy need = buy at what-if wind - buy at forecast.
    `reserve` may be None (no reserve known): then nothing is covered and every scenario says so."""
    f = np.asarray(forecast, dtype="float64")
    known = reserve is not None
    r = np.maximum(np.asarray(reserve, dtype="float64"), 0.0) if known else np.zeros_like(f)
    out = []
    for sid, label, share in WHAT_IF:
        if share is None and bad_hour is None:
            out.append({"id": sid, "label": label, "available": False})
            continue
        wind = np.maximum(f * (1 - share), 0.0) if share is not None else np.maximum(f - bad_hour, 0.0)
        drop = f - wind
        covered = np.minimum(drop, r)
        left = drop - covered
        sc = {"id": sid, "label": label, "available": True, "reserve_known": known,
              "per_hour": [{"wind": _f(w), "drop": _f(d), "covered": _f(c), "left": _f(x)} for w, d, c, x in zip(wind, drop, covered, left)],
              "day": {"avg_drop": _f(drop.mean()) if len(f) else None, "drop_mwh": _f(drop.sum()),
                      "covered_mwh": _f(covered.sum()), "left_mwh": _f(left.sum()),
                      "hours_left": int((left > 1e-9).sum()), "max_left": _f(left.max()) if len(f) else None,
                      "covered_share_of_drop": _f(covered.sum() / drop.sum()) if drop.sum() > 0 else None}}
        if demand is not None:
            base, scn = np.maximum(demand - f, 0.0), np.maximum(demand - wind, 0.0)
            sc["demand"] = {"buy_avg_forecast": _f(base.mean()), "buy_avg_what_if": _f(scn.mean()),
                            "extra_avg": _f((scn - base).mean()), "extra_mwh": _f((scn - base).sum())}
        out.append(sc)
    return out


# ======================================================================================================= trade-off
TRADEOFF_RATIOS = (1.0, 2.0, 3.0, 5.0, 9.0)


def tradeoff(eval_window: pd.DataFrame, days: List[date], ratios, method: str = "flat", coverage: float = 0.8,
             min_n: int = MIN_N) -> List[Dict]:
    """For each cost setting, replay the window (reserve known at each cutoff) and report the trade-off:
    covered share against average unused reserve and average remaining shortfall (MW per hour)."""
    rows = []
    for ratio in ratios:
        rep = replay(eval_window, days, cost_quantile(ratio), method, coverage, min_n)
        t, known = rep["totals"], [d for d in rep["days"] if d["margin_known"]]
        h = t["hours"]
        rows.append({"ratio": ratio, "aim": _f(cost_quantile(ratio)), "hours": h, "days": t["days_with_margin"],
                     "covered_share": t["covered_share"],
                     "avg_reserve": _f(sum(d["reserve_avg"] * d["n_hours"] for d in known) / h) if h else None,
                     "avg_unused": _f(t["unused_mwh"] / h) if h else None, "avg_short": _f(t["short_mwh"] / h) if h else None,
                     "short_mwh": t["short_mwh"], "unused_mwh": t["unused_mwh"]})
    return rows
