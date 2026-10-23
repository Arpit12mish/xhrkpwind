"""The configured delivery-day window, the delivery-day logic and the stored data must agree.

These tests fail if someone changes DATA_FIRST_DAY / DATA_LAST_DAY (or the cutoff logic)
without re-running ingestion, or if the snapshot does not actually cover the window.
"""
from datetime import date, timedelta

import pandas as pd
import pytest

from app import config, db, ingestion, selection

FIRST = date.fromisoformat(config.DATA_FIRST_DAY)
LAST = date.fromisoformat(config.DATA_LAST_DAY)
DAYS = [FIRST + timedelta(days=i) for i in range((LAST - FIRST).days + 1)]


@pytest.fixture(scope="module")
def data():
    return db.load_forecasts(), db.load_actuals()


def test_window_means_decisions_made_in_january_2026():
    # Decision for delivery day D is made on D-1, so decision days must be exactly 1..31 Jan.
    assert FIRST - timedelta(days=1) == date(2026, 1, 1)
    assert LAST - timedelta(days=1) == date(2026, 1, 31)
    assert len(DAYS) == 31


def test_snapshot_forecasts_start_before_first_cutoff(data):
    fc, _ = data
    assert fc["publish_time"].min() <= selection.cutoff_utc(FIRST, selection.parse_cutoff("00:00"))


def test_every_window_day_has_a_pre_cutoff_forecast_for_every_hour(data):
    fc, _ = data
    sel = selection.select_latest_forecasts(fc, config.DEFAULT_CUTOFF)
    win = sel[sel["delivery_day"].isin(DAYS)]
    counts = win.groupby("delivery_day").size()
    assert list(counts.index) == DAYS
    assert (counts == 24).all()          # hourly forecast, GMT days in January
    assert (win["publish_time"] <= win["cutoff"]).all()


def test_actuals_cover_every_half_hour_of_every_window_day(data):
    _, act = data
    day = selection.delivery_day_of(act["start_time"])
    counts = act[day.isin(DAYS)].groupby(day[day.isin(DAYS)]).size()
    assert list(counts.index) == DAYS and (counts == 48).all()


def test_no_selected_target_lies_outside_window_days_unexpectedly(data):
    fc, _ = data
    sel = selection.select_latest_forecasts(fc, config.DEFAULT_CUTOFF)
    assert FIRST in set(sel["delivery_day"]) and LAST in set(sel["delivery_day"])


def test_ingestion_plan_covers_window_cutoffs():
    p = ingestion.fetch_plan()
    first_cutoff = selection.cutoff_utc(FIRST, selection.parse_cutoff("00:00")).date()
    assert p.forecast_publish_from <= first_cutoff           # vintages before the earliest cutoff
    assert p.forecast_publish_to >= LAST                     # vintages up to the last delivery day
    assert p.actual_from <= FIRST and p.actual_to >= LAST


def test_decision_day_boundaries_match_uk_local_day(data):
    fc, _ = data
    sel = selection.select_latest_forecasts(fc, config.DEFAULT_CUTOFF)
    last = sel[sel["delivery_day"] == LAST]["start_time"]
    assert last.min() == pd.Timestamp("2026-02-01 00:00", tz="UTC")   # January: UK local == UTC
    assert last.max() == pd.Timestamp("2026-02-01 23:00", tz="UTC")
