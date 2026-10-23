"""Fetch Elexon BMRS data and store it locally.

Run:  python -m app.ingestion            (uses the delivery-day window from config)

Endpoints (https://bmrs.elexon.co.uk/api-documentation):
  WINDFOR  GET /datasets/WINDFOR/stream?publishDateTimeFrom&publishDateTimeTo
  FUELHH   GET /datasets/FUELHH/stream?settlementDateFrom&settlementDateTo&fuelType=WIND
The /stream variants return a flat JSON array (no pagination), but the API caps the window
size, so we request small date chunks and merge them. Duplicates and nulls are handled in
`clean_forecasts` / `clean_actuals`, and writes are upserts, so re-runs are idempotent.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from typing import Iterator, List, NamedTuple

import pandas as pd
import requests

from . import config, db


class FetchPlan(NamedTuple):
    """What must be downloaded to serve delivery days first_day..last_day."""
    forecast_publish_from: date   # first day (UTC) of forecast publish times
    forecast_publish_to: date     # last day (UTC) of forecast publish times, inclusive
    actual_from: date             # first day of actuals (one day of slack for UK/UTC boundaries)
    actual_to: date               # last day of actuals, inclusive


def fetch_plan(first_day: str = config.DATA_FIRST_DAY, last_day: str = config.DATA_LAST_DAY) -> FetchPlan:
    d0, d1 = date.fromisoformat(first_day), date.fromisoformat(last_day)
    return FetchPlan(d0 - timedelta(days=config.FORECAST_LOOKBACK_DAYS), d1,
                     d0 - timedelta(days=1), d1 + timedelta(days=1))


def _get(path: str, params: dict, retries: int = 4) -> list:
    url = f"{config.BMRS_BASE}{path}"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
            return data["data"] if isinstance(data, dict) else data
        except (requests.RequestException, ValueError):
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return []


def _chunks(start: date, end: date, days: int) -> Iterator[tuple]:
    cur = start
    while cur <= end:
        nxt = min(cur + timedelta(days=days), end + timedelta(days=1))
        yield cur, nxt
        cur = nxt


def _iso(d: date) -> str:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_forecasts(rows: List[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["startTime", "publishTime", "generation"])
    df = df.dropna(subset=["startTime", "publishTime", "generation"])
    df["generation"] = pd.to_numeric(df["generation"], errors="coerce")
    df = df.dropna(subset=["generation"])
    return df.drop_duplicates(subset=["startTime", "publishTime"], keep="last")


def clean_actuals(rows: List[dict]) -> pd.DataFrame:
    """Keep WIND only; if a period appears twice keep the most recently published value."""
    df = pd.DataFrame(rows, columns=["startTime", "publishTime", "fuelType", "generation"])
    df = df[df["fuelType"] == "WIND"].dropna(subset=["startTime", "generation"])
    df["generation"] = pd.to_numeric(df["generation"], errors="coerce")
    df = df.dropna(subset=["generation"])
    return df.sort_values("publishTime").drop_duplicates(subset=["startTime"], keep="last")


def store(fc_rows: List[dict], act_rows: List[dict], path=config.DB_PATH) -> dict:
    """Clean raw API rows and upsert them into SQLite. No network access."""
    fc, act = clean_forecasts(fc_rows), clean_actuals(act_rows)
    with db.connect(path) as con:
        db.init_db(con)
        con.executemany("INSERT OR REPLACE INTO wind_forecast VALUES (?,?,?)",
                        fc[["startTime", "publishTime", "generation"]].itertuples(index=False, name=None))
        con.executemany("INSERT OR REPLACE INTO wind_actual VALUES (?,?)",
                        act[["startTime", "generation"]].itertuples(index=False, name=None))
    return {"raw_forecast_rows": len(fc_rows), "forecast_rows": len(fc),
            "dropped_forecast_rows": len(fc_rows) - len(fc),
            "raw_actual_rows": len(act_rows), "actual_rows": len(act),
            "dropped_actual_rows": len(act_rows) - len(act)}  # includes non-WIND rows


def ingest(first_day: str = config.DATA_FIRST_DAY, last_day: str = config.DATA_LAST_DAY) -> dict:
    plan = fetch_plan(first_day, last_day)
    fc_rows: List[dict] = []
    for a, b in _chunks(plan.forecast_publish_from, plan.forecast_publish_to, days=3):
        fc_rows += _get("/datasets/WINDFOR/stream",
                        {"publishDateTimeFrom": _iso(a), "publishDateTimeTo": _iso(b)})
    act_rows: List[dict] = []
    for a, b in _chunks(plan.actual_from, plan.actual_to, days=7):
        act_rows += _get("/datasets/FUELHH/stream",
                         {"settlementDateFrom": a.isoformat(),
                          "settlementDateTo": (b - timedelta(days=1)).isoformat(),
                          "fuelType": "WIND"})
    return store(fc_rows, act_rows)


if __name__ == "__main__":
    print(ingest())
