"""Feature 2 ("What if wind is lower than forecast?") and feature 3 ("How much backup is worth it?")."""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import db, planning, service
from app.main import app

client = TestClient(app)
D = date(2026, 1, 20)


@pytest.fixture(scope="module")
def real():
    return db.load_forecasts(), db.load_actuals()


def corrupt_from(act, first_bad):
    a = act.copy()
    a.loc[a["start_time"].dt.tz_convert("Europe/London").dt.date >= first_bad, "actual"] *= 10
    return a


# ======================================================================================= feature 2: what if
def test_what_if_maths_hand_built():
    s = {x["id"]: x for x in planning.what_if([1000, 2000, 100], [150, 150, 150], bad_hour=500, demand=1800)}
    p20 = s["pct20"]
    assert [h["drop"] for h in p20["per_hour"]] == [200, 400, 20]
    assert [h["covered"] for h in p20["per_hour"]] == [150, 150, 20]
    assert [h["left"] for h in p20["per_hour"]] == [50, 250, 0]
    assert p20["day"]["drop_mwh"] == 620 and p20["day"]["left_mwh"] == 300 and p20["day"]["hours_left"] == 2
    # bad hour: 500 MW below the forecast, never below zero wind (the 100 MW hour only drops by 100)
    assert [h["drop"] for h in s["bad_hour"]["per_hour"]] == [500, 500, 100]
    # demand 1,800: buy at forecast = [800, 0, 1700]; at 20% less wind = [1000, 200, 1720] -> extra = [200, 200, 20]
    assert p20["demand"]["extra_mwh"] == 420 and p20["demand"]["buy_avg_forecast"] == pytest.approx(2500 / 3, abs=1e-3)


def test_what_if_without_reserve_or_bad_hour():
    s = {x["id"]: x for x in planning.what_if([1000.0], None, bad_hour=None)}
    assert s["pct10"]["reserve_known"] is False and s["pct10"]["day"]["left_mwh"] == 100   # nothing held, all left to buy
    assert s["bad_hour"]["available"] is False


def test_bad_hour_is_the_90th_percentile_of_known_misses_with_sample_rule():
    hist = pd.DataFrame({"error": np.arange(-50.0, 50.0), "delivery_day": [date(2026, 1, 2)] * 100})
    b = planning.bad_hour_mw(hist)
    assert b["mw"] == pytest.approx(np.percentile(np.abs(np.arange(-50.0, 50.0)), 90)) and b["available"]
    assert planning.bad_hour_mw(hist.iloc[:29])["available"] is False


def test_api_what_if_uses_known_days_reserve_even_when_plan_uses_every_day():
    a = client.get("/api/decision", params={"day": "2026-01-15"}).json()["what_if"]
    b = client.get("/api/decision", params={"day": "2026-01-15", "band_basis": "all"}).json()["what_if"]
    assert a["scenarios"] == b["scenarios"] and a["basis"] == b["basis"] == "prior"
    assert a["same_reserve_as_plan"] is True and b["same_reserve_as_plan"] is False
    plan = client.get("/api/decision", params={"day": "2026-01-15"}).json()["margin"]["avg"]
    assert a["reserve_avg"] == pytest.approx(plan, abs=0.01)      # default settings: same reserve as the plan


def test_what_if_ignores_everything_from_d_minus_1_on(real):
    fc, act = real
    clean = service.decision(fc, act, D, demand=20000)["what_if"]
    assert clean == service.decision(fc, corrupt_from(act, D - timedelta(days=1)), D, demand=20000)["what_if"]
    assert clean != service.decision(fc, corrupt_from(act, D - timedelta(days=2)), D, demand=20000)["what_if"]


def test_what_if_on_a_day_without_history():
    w = client.get("/api/decision", params={"day": "2026-01-03"}).json()["what_if"]
    s = {x["id"]: x for x in w["scenarios"]}
    assert w["reserve_known"] is False and s["bad_hour"]["available"] is False
    assert s["pct20"]["day"]["left_mwh"] == s["pct20"]["day"]["drop_mwh"]


# ===================================================================================== feature 3: trade-off
def test_tradeoff_hand_built():
    d = [date(2026, 1, i) for i in (1, 2, 3)]
    ev = pd.DataFrame({"delivery_day": [d[0]] * 4 + [d[2]] * 2, "forecast": 1000.0, "error": [0, 10, 20, 30, 15, 40]})
    rows = {r["ratio"]: r for r in planning.tradeoff(ev, d, [1.0, 3.0], "flat", min_n=1)}
    # day 3 reserve = q-quantile of day-1 errors [0, 10, 20, 30]: ratio 1 -> median 15; ratio 3 -> 75th pct 22.5
    r1, r3 = rows[1.0], rows[3.0]
    assert r1["avg_reserve"] == 15 and r1["covered_share"] == 0.5 and r1["avg_short"] == pytest.approx(12.5) and r1["avg_unused"] == 0
    assert r3["avg_reserve"] == 22.5 and r3["avg_short"] == pytest.approx(8.75) and r3["avg_unused"] == pytest.approx(3.75)


def test_tradeoff_more_backup_covers_more_and_leaves_more_unused():
    rows = client.get("/api/tradeoff").json()["rows"]
    cov, unused, short = [r["covered_share"] for r in rows], [r["avg_unused"] for r in rows], [r["avg_short"] for r in rows]
    assert [r["ratio"] for r in rows] == [1, 2, 3, 5, 9]
    assert cov == sorted(cov) and unused == sorted(unused) and short == sorted(short, reverse=True)


def test_tradeoff_rows_match_the_replay():
    tr = {r["ratio"]: r for r in client.get("/api/tradeoff", params={"margin_by": "level", "cost_ratio": 4}).json()["rows"]}
    assert 4.0 in tr                                                       # the current setting is always included
    for ratio in (3, 4):
        rp = client.get("/api/replay", params={"cost_ratio": ratio, "margin_by": "level"}).json()["totals"]
        assert tr[float(ratio)]["covered_share"] == rp["covered_share"] and tr[float(ratio)]["short_mwh"] == rp["short_mwh"]


@pytest.mark.parametrize("params", [{"cost_ratio": 0.5}, {"cost_ratio": 11}, {"margin_by": "x"}, {"cutoff": "9"}])
def test_tradeoff_validation(params):
    assert client.get("/api/tradeoff", params=params).status_code == 422
