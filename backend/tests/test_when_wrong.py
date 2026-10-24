""""When the forecast is wrong": exceedance table (feature 1) and the plan replay (feature 4)."""
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


# ================================================================================= feature 1: exceedance
def test_exceedance_hand_built():
    # errors (forecast - actual): 600 and 2500 are shortfalls; -700 means more wind than forecast.
    hist = pd.DataFrame({"forecast": [1000.0, 2000, 3000, 4000], "error": [600.0, 2500, -700, 0],
                         "delivery_day": [date(2026, 1, 2)] * 2 + [date(2026, 1, 3)] * 2})
    t = planning.exceedance_table(hist, steps=(500, 1000, 3000), min_n=1)
    assert t["all"]["below"] == [0.5, 0.25, 0.0]      # >500: 600, 2500; >1000: 2500; >3000: none
    assert t["all"]["above"] == [0.25, 0.0, 0.0]      # < -500: -700
    assert t["all"]["n_hours"] == 4 and t["all"]["n_days"] == 2


def test_exceedance_small_levels_are_flagged_too_few():
    rng = np.random.default_rng(3)
    hist = pd.DataFrame({"forecast": rng.uniform(0, 20000, 60), "error": rng.normal(0, 1000, 60),
                         "delivery_day": [date(2026, 1, 2) + timedelta(days=i % 3) for i in range(60)]})
    t = planning.exceedance_table(hist)                # 60 hours -> 20 per level < 30
    assert t["available"] and all(l["too_few"] for l in t["levels"])
    t2 = planning.exceedance_table(pd.concat([hist] * 2, ignore_index=True))
    assert not any(l["too_few"] for l in t2["levels"])


def test_exceedance_shares_fall_as_the_step_grows(real):
    j = client.get("/api/decision", params={"day": "2026-01-15"}).json()["how_wrong"]
    for row in [j["all"], *j["levels"]]:
        assert row["below"] == sorted(row["below"], reverse=True) and row["above"] == sorted(row["above"], reverse=True)
    assert j["basis"] == "prior" and j["all"]["n_hours"] == 12 * 24 and j["day_level"] in ("low", "mid", "high")


def test_exceedance_uses_known_days_even_when_margin_uses_every_day(real):
    fc, act = real
    a = service.decision(fc, act, D, band_basis="all")["how_wrong"]
    b = service.decision(fc, act, D, band_basis="prior")["how_wrong"]
    assert a == b


def test_exceedance_ignores_everything_from_d_minus_1_on(real):
    fc, act = real
    clean = service.decision(fc, act, D)["how_wrong"]
    assert clean == service.decision(fc, corrupt_from(act, D - timedelta(days=1)), D)["how_wrong"]
    assert clean != service.decision(fc, corrupt_from(act, D - timedelta(days=2)), D)["how_wrong"]


def test_exceedance_not_available_without_history():
    assert client.get("/api/decision", params={"day": "2026-01-03"}).json()["how_wrong"]["available"] is False


# ===================================================================================== feature 4: replay
def _ev(days_errors, forecast=1000.0):
    rows = []
    for d, errs in days_errors.items():
        rows += [{"delivery_day": d, "forecast": forecast, "error": e} for e in errs]
    return pd.DataFrame(rows)


def test_replay_arithmetic_hand_built():
    d1, d2, d3 = (date(2026, 1, i) for i in (1, 2, 3))
    ev = _ev({d1: [0, 10], d2: [5, 5], d3: [25, -10, 2]})
    r = planning.replay(ev, [d1, d2, d3], q=0.5, method="flat", min_n=1, price_short=100, price_unused=10)
    by = {x["day"]: x for x in r["days"]}
    assert by["2026-01-01"]["margin_known"] is False and "short_mwh" not in by["2026-01-01"]   # no zeros for unknown days
    assert by["2026-01-02"]["margin_known"] is False
    # d3: reserve = median of d1 errors [0, 10] = 5. needed = [25, 0, 2]. short = [20, 0, 0]; unused = [0, 5, 3].
    x = by["2026-01-03"]
    assert x["reserve_avg"] == 5 and x["short_mwh"] == 20 and x["unused_mwh"] == 8 and x["needed_mwh"] == 27
    assert x["covered_share"] == pytest.approx(2 / 3, abs=1e-3) and x["short_hours"] == 1
    assert x["cost"] == 20 * 100 + 8 * 10
    assert r["totals"]["days_with_margin"] == 1 and r["totals"]["days_without_margin"] == 2 and r["totals"]["cost"] == 2080


def test_replay_negative_margin_holds_no_reserve():
    d1, d2, d3 = (date(2026, 1, i) for i in (1, 2, 3))
    ev = _ev({d1: [-50, -40], d2: [0], d3: [-5, 30]})
    x = {r["day"]: r for r in planning.replay(ev, [d1, d2, d3], 0.5, "flat", min_n=1)["days"]}["2026-01-03"]
    assert x["reserve_avg"] == 0 and x["short_mwh"] == 30 and x["unused_mwh"] == 0


def test_replay_matches_the_margin_check_on_covered_share():
    for p in ({}, {"cost_ratio": 9}, {"margin_by": "level"}, {"cost_ratio": 1, "margin_by": "level"}):
        r, m = client.get("/api/replay", params=p).json(), client.get("/api/margin-check", params=p).json()
        assert r["totals"]["covered_share"] == m["achieved"] and r["totals"]["hours"] == m["n_hours"]


def test_replay_reserve_for_a_day_ignores_that_day_and_the_day_before(real):
    fc, act = real
    clean = {x["day"]: x.get("reserve_avg") for x in service.replay(fc, act)["days"]}
    dirty = {x["day"]: x.get("reserve_avg") for x in service.replay(fc, corrupt_from(act, D - timedelta(days=1)))["days"]}
    for day in clean:
        if date.fromisoformat(day) <= D:          # those reserves are learned from days <= D-2
            assert clean[day] == dirty[day], day


def test_replay_cost_only_with_both_prices():
    j = client.get("/api/replay", params={"price_short": 200, "price_unused": 20}).json()
    t = j["totals"]
    assert t["cost"] == pytest.approx(t["short_mwh"] * 200 + t["unused_mwh"] * 20, abs=1)
    assert client.get("/api/replay").json()["totals"]["cost"] is None


@pytest.mark.parametrize("params", [{"price_short": 200}, {"price_unused": 20}, {"price_short": -1, "price_unused": 5},
                                    {"price_short": 1e6, "price_unused": 5}, {"price_short": "x", "price_unused": 5},
                                    {"cost_ratio": 20}, {"margin_by": "x"}, {"cutoff": "25:00"}])
def test_replay_validation(params):
    assert client.get("/api/replay", params=params).status_code == 422


def test_each_price_is_its_own_parameter():
    # guards a FastAPI pitfall: one shared Query object made a single price fill both parameters
    j = client.get("/api/replay", params={"price_short": 200, "price_unused": 20}).json()
    assert j["prices"] == {"short": 200, "unused": 20}
