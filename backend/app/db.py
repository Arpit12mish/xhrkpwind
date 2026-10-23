"""SQLite storage. Timestamps are stored as ISO-8601 UTC strings ('2026-01-09T04:30:00Z')."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from urllib.parse import quote

import pandas as pd

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS wind_forecast (
    start_time   TEXT NOT NULL,   -- target period start (UTC)
    publish_time TEXT NOT NULL,   -- when this vintage was published (UTC)
    generation   REAL NOT NULL,   -- MW
    PRIMARY KEY (start_time, publish_time)
);
CREATE TABLE IF NOT EXISTS wind_actual (
    start_time   TEXT PRIMARY KEY, -- half-hour start (UTC)
    generation   REAL NOT NULL     -- MW (FUELHH, fuelType = WIND)
);
CREATE INDEX IF NOT EXISTS idx_fc_start ON wind_forecast(start_time);
"""


@contextmanager
def connect(path=DB_PATH, readonly: bool = False):
    if readonly:
        # mode=ro + immutable=1: never writes (no journal/lock files), so it works on a
        # read-only filesystem such as a serverless function bundle. Safe because the
        # snapshot is only replaced by re-running ingestion, never while serving.
        con = sqlite3.connect(f"file:{quote(str(path))}?mode=ro&immutable=1", uri=True)
    else:
        con = sqlite3.connect(path)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)


def _read(sql: str, cols: dict) -> pd.DataFrame:
    with connect(readonly=True) as con:
        df = pd.read_sql_query(sql, con)
    for c in cols["times"]:
        df[c] = pd.to_datetime(df[c], utc=True)
    return df


def load_forecasts() -> pd.DataFrame:
    return _read(
        "SELECT start_time, publish_time, generation AS forecast FROM wind_forecast",
        {"times": ["start_time", "publish_time"]},
    )


def load_actuals() -> pd.DataFrame:
    return _read(
        "SELECT start_time, generation AS actual FROM wind_actual",
        {"times": ["start_time"]},
    )
