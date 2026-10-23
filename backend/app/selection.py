"""Forecast selection: "what was the latest forecast the buyer could see at decision time?"

Assumption (documented in README): the decision cutoff for delivery day D is
`cutoff_time` UK wall-clock on D-1 (default 09:00 Europe/London). For each target half-hour
we take the forecast vintage with the greatest publishTime <= cutoff. Using zoneinfo means
the cutoff is converted to UTC correctly on DST-change weeks (UTC+0 in Jan, UTC+1 in summer).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

import pandas as pd

from .config import DEFAULT_CUTOFF, UK_TZ


def parse_cutoff(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


def cutoff_utc(delivery_day: date, cutoff: time, days_before: int = 1) -> pd.Timestamp:
    """UTC instant of `cutoff` (UK local) on the day `days_before` days before delivery_day."""
    local = datetime.combine(delivery_day - timedelta(days=days_before), cutoff, tzinfo=UK_TZ)
    return pd.Timestamp(local).tz_convert("UTC")


def delivery_day_of(start_time: pd.Series) -> pd.Series:
    """UK-local calendar day each UTC start_time belongs to."""
    return start_time.dt.tz_convert(UK_TZ).dt.date


def add_horizon(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["horizon_h"] = (df["start_time"] - df["publish_time"]).dt.total_seconds() / 3600.0
    return df


def select_latest_forecasts(forecasts: pd.DataFrame, cutoff: str = DEFAULT_CUTOFF,
                            days_before: int = 1) -> pd.DataFrame:
    """One row per target start_time: the latest vintage with publish_time <= cutoff(D).

    Targets with no vintage published before their cutoff are dropped (never filled with
    later data - that would leak information the buyer did not have).
    """
    cols = ["start_time", "publish_time", "forecast", "delivery_day", "cutoff", "horizon_h"]
    if forecasts.empty:
        return pd.DataFrame(columns=cols)
    ct = parse_cutoff(cutoff)
    df = forecasts.copy()
    df["delivery_day"] = delivery_day_of(df["start_time"])
    cutoffs = {d: cutoff_utc(d, ct, days_before) for d in df["delivery_day"].unique()}
    df["cutoff"] = pd.to_datetime(df["delivery_day"].map(cutoffs), utc=True)
    df = df[df["publish_time"] <= df["cutoff"]]
    df = (df.sort_values(["start_time", "publish_time"])
            .groupby("start_time", as_index=False).tail(1))
    return add_horizon(df)[cols].reset_index(drop=True)


def join_actuals(forecasts: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Align on start_time (UTC). Forecast rows without an actual keep actual = NaN."""
    return forecasts.merge(actuals, on="start_time", how="left")
