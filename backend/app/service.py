"""Glue between storage, selection and metrics. Pure functions taking DataFrames where possible."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import pandas as pd

from . import metrics, selection
from . import config
from .config import DEFAULT_BAND_COVERAGE, DEFAULT_CUTOFF, UK_TZ


def _iso(ts) -> Optional[str]:
    return None if pd.isna(ts) else ts.strftime("%Y-%m-%dT%H:%M:%SZ")


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


def decision(forecasts, actuals, day: date, cutoff=DEFAULT_CUTOFF,
             coverage=DEFAULT_BAND_COVERAGE, band_basis="all") -> dict:
    ct = selection.parse_cutoff(cutoff)
    sel = selection.select_latest_forecasts(forecasts, cutoff)
    sel = sel[sel["delivery_day"] == day]
    joined = selection.join_actuals(sel, actuals)

    # Error history for the safety band.
    hist = build_eval_frame(forecasts, actuals, cutoff, "decision")
    # Only delivery days inside the configured window: the snapshot also holds a few slack
    # days (e.g. 1 Jan, 2 Feb) whose decisions are not "made in January".
    hist = hist[(hist["delivery_day"] >= date.fromisoformat(config.DATA_FIRST_DAY))
                & (hist["delivery_day"] <= date.fromisoformat(config.DATA_LAST_DAY))]
    if band_basis == "prior":
        # Only days whose actuals were fully known before the D-1 cutoff, i.e. <= D-2.
        hist = hist[hist["delivery_day"] <= day - timedelta(days=2)]
    band = metrics.error_band(hist["error"], coverage)
    lo, hi = band["lo"], band["hi"]

    rows = []
    for r in joined.itertuples():
        a = None if pd.isna(r.actual) else float(r.actual)
        rows.append({
            "start_time": _iso(r.start_time), "forecast": float(r.forecast), "actual": a,
            "publish_time": _iso(r.publish_time), "horizon_h": round(r.horizon_h, 2),
            # actual ~ forecast - error  =>  [forecast - hi, forecast + (-lo)]
            "lower": None if hi is None else max(0.0, float(r.forecast) - hi),
            "upper": None if lo is None else float(r.forecast) - lo,
        })
    day_actuals = actuals[selection.delivery_day_of(actuals["start_time"]) == day]
    known = joined.dropna(subset=["actual"])
    day_err = metrics.add_errors(known) if len(known) else known
    return {
        "day": day.isoformat(), "cutoff_local": f"{(day - timedelta(days=1)).isoformat()} {cutoff}",
        "cutoff_utc": _iso(selection.cutoff_utc(day, ct)),
        "latest_publish_time": _iso(sel["publish_time"].max()) if len(sel) else None,
        "band": {**band, "basis": band_basis, "n": int(len(hist))},
        "forecast_mean": metrics._num(sel["forecast"].mean()) if len(sel) else None,
        "forecast_peak": metrics._num(sel["forecast"].max()) if len(sel) else None,
        "forecast_min": metrics._num(sel["forecast"].min()) if len(sel) else None,
        "realised": metrics.summarize(day_err, coverage) if len(known) else None,
        "rows": rows,
        # Full half-hourly actuals for the day (the forecast itself is hourly).
        "actual_series": [{"start_time": _iso(r.start_time), "actual": float(r.actual)}
                          for r in day_actuals.sort_values("start_time").itertuples()],
    }


def accuracy(forecasts, actuals, start: date, end: date, cutoff=DEFAULT_CUTOFF,
             basis="decision", min_h: Optional[float] = None, max_h: Optional[float] = None,
             coverage=DEFAULT_BAND_COVERAGE, max_points: int = 3000) -> dict:
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
        "points": [{"start_time": _iso(r.start_time), "forecast": r.forecast, "actual": r.actual,
                    "error": r.error, "horizon_h": round(r.horizon_h, 2)}
                   for r in pts.itertuples()],
    }
