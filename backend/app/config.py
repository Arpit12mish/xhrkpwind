"""Central configuration. Everything here can be overridden by environment variables."""
from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")

BMRS_BASE = "https://data.elexon.co.uk/bmrs/api/v1"
DB_PATH = Path(os.getenv("WIND_DB_PATH", Path(__file__).resolve().parents[1] / "data" / "wind.db"))

# Decision cutoff: UK local wall-clock time on D-1 by which the buyer must have decided.
# ASSUMPTION - the assignment does not specify it and GB has more than one day-ahead auction
# (EPEX 60-min at 09:20, Nord Pool N2EX at 09:50 - see README). 09:00 is a deliberately early
# working cutoff that precedes both gates. Override with DECISION_CUTOFF or in the UI.
DEFAULT_CUTOFF = os.getenv("DECISION_CUTOFF", "09:00")

# Delivery days covered by the app. A decision for delivery day D is made on D-1, so
# "decisions made in January 2026" = delivery days 2 Jan .. 1 Feb 2026.
DATA_FIRST_DAY = os.getenv("DATA_FIRST_DAY", "2026-01-02")
DATA_LAST_DAY = os.getenv("DATA_LAST_DAY", "2026-02-01")
# Forecast vintages are fetched from this many days before the first delivery day, so the
# first day has vintages before its D-1 cutoff and the "all vintages" view has some history.
FORECAST_LOOKBACK_DAYS = 4

# A shortfall of wind costs this many times as much as a surplus (default for the cost-aware margin, 1 to 10).
DEFAULT_COST_RATIO = 3.0
# Defaults for the Plan page margin: one flat margin, learned only from days already known at the cutoff
# (days <= D-2). The walk-forward check found the wind-level split no better overall, and "prior" never
# uses the day being planned.
DEFAULT_MARGIN_BY = "flat"
DEFAULT_BAND_BASIS = "prior"

# Width of the safety-margin band (central coverage of the signed error), e.g. 0.8 = P10..P90.
DEFAULT_BAND_COVERAGE = 0.8
