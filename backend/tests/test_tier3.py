"""Tier 3: naive persistence baseline (forecast skill) and weekday/weekend error profile."""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import db, planning, service
from app.main import app

client = TestClient(app)


def _ev(times, forecast, actual, day):
    t = pd.to_datetime(times, utc=True)
    return pd.DataFrame({"start_time": t, "forecast": forecast, "actual": actual,
                         "error": np.asarray(forecast, float) - np.asarray(actual, float), "delivery_day": day})


def _act(times, values):
    return pd.DataFrame({"start_time": pd.to_datetime(times, utc=True), "actual": values})


def test_persistence_guess_takes_same_uk_clock_hour_and_handles_dst():
    # 30 Mar 2026 10:00 BST (09:00 UTC). Two days earlier is 28 Mar 10:00 GMT = 10:00 UTC (clocks changed on 29 Mar).
    ev = _ev(["2026-03-30 09:00"], [1000], [800], date(2026, 3, 30))
    act = _act(["2026-03-28 10:00", "2026-03-28 09:00", "2026-03-29 09:00"], [111.0, 999.0, 222.0])
    assert planning.persistence_guess(ev, act, 2).iloc[0] == 111.0     # same clock hour, not same UTC offset
    assert planning.persistence_guess(ev, act, 1).iloc[0] == 222.0     # 29 Mar 10:00 BST = 09:00 UTC


def test_persistence_guess_skips_wall_clock_times_that_do_not_exist():
    # 31 Mar 2026 01:30 BST: two days earlier is 29 Mar 01:30, which does not exist (clocks jump 01:00 -> 02:00).
    ev = _ev(["2026-03-31 00:30"], [1000], [800], date(2026, 3, 31))
    act = _act(["2026-03-29 00:30", "2026-03-29 01:30"], [5.0, 6.0])
    assert np.isnan(planning.persistence_guess(ev, act, 2).iloc[0])


def test_skill_maths_and_missing_guess_hours_are_excluded():
    ev = _ev(["2026-01-10 00:00", "2026-01-10 01:00", "2026-01-10 02:00"], [110, 90, 100], [100, 100, 100], date(2026, 1, 10))
    guess = pd.Series([140.0, 60.0, np.nan])
    s = planning.skill_vs_guess(ev, guess)
    assert s["n"] == 2 and s["excluded"] == 1
    assert s["forecast_mae"] == 10 and s["guess_mae"] == 40 and s["skill_mae"] == pytest.approx(0.75)
    assert s["guess_bias"] == 0
    worse = planning.skill_vs_guess(ev, pd.Series([101.0, 99.0, 100.0]))
    assert worse["skill_mae"] < 0                                     # a negative skill is reported, not hidden


def test_fair_guess_for_day_d_uses_nothing_from_d_minus_1_on():
    fc, act = db.load_forecasts(), db.load_actuals()
    D = date(2026, 1, 20)
    ev = service.build_eval_frame(fc, act, "09:00", "decision")
    ev = ev[ev["delivery_day"] == D].reset_index(drop=True)
    dirty = act.copy()
    dirty.loc[dirty["start_time"].dt.tz_convert("Europe/London").dt.date >= D - timedelta(days=1), "actual"] *= 10
    pd.testing.assert_series_equal(planning.persistence_guess(ev, act, 2), planning.persistence_guess(ev, dirty, 2))
    # ...while the 'yesterday' guess does change: it uses data after the cutoff, which is why it is flagged
    assert not planning.persistence_guess(ev, act, 1).equals(planning.persistence_guess(ev, dirty, 1))


def test_api_baseline_compares_on_the_same_hours():
    j = client.get("/api/baseline").json()
    fair, yday = j["guesses"]
    assert fair["name"] == "two_days_before" and fair["known_at_cutoff"] is True
    assert yday["name"] == "yesterday" and yday["known_at_cutoff"] is False
    assert fair["n"] == yday["n"] and fair["forecast_mae"] == yday["forecast_mae"]
    assert fair["n"] + j["hours_without_guess"] == 31 * 24
    assert fair["skill_mae"] == pytest.approx(1 - fair["forecast_mae"] / fair["guess_mae"], abs=1e-3)


@pytest.mark.parametrize("params", [{"start": "2026-01-20", "end": "2026-01-10"}, {"start": "2025-12-01"},
                                    {"end": "2026-03-01"}, {"cutoff": "7"}])
def test_api_baseline_validation(params):
    assert client.get("/api/baseline", params=params).status_code == 422


def test_daytype_profile_counts_and_small_sample_flag():
    j = client.get("/api/accuracy").json()["by_daytype"]
    by = {g["day_type"]: g for g in j["groups"]}
    assert by["weekday"]["days"] + by["weekend"]["days"] == 31
    assert by["weekday"]["hours"] + by["weekend"]["hours"] == 744
    assert by["weekend"]["days"] == 10 and j["enough"] is False and j["min_days"] == 30   # never quoted as solid
    assert j["test"]["n"] == 31


def test_daytype_profile_hand_built():
    days = [date(2026, 1, 5) + timedelta(days=i) for i in range(7)]   # Mon..Sun
    rows = [{"delivery_day": d, "error": (300.0 if d.weekday() >= 5 else 100.0)} for d in days for _ in range(2)]
    p = planning.daytype_profile(pd.DataFrame(rows), min_days=2)
    by = {g["day_type"]: g for g in p["groups"]}
    assert by["weekday"]["days"] == 5 and by["weekend"]["days"] == 2
    assert by["weekday"]["typical_miss"] == 100 and by["weekend"]["typical_miss"] == 300
    assert p["enough"] is True and p["test"]["r"] == pytest.approx(1.0)
