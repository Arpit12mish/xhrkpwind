"""Tier-1 planning features: net buy, margin by wind level, cost-aware margin, margin check.

Each feature has (a) maths/edge-case tests and (b) a no-look-ahead test: data from day D-1 onwards is
corrupted, and every number the buyer would use for day D (with band_basis='prior') must not change.
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import db, planning, service
from app.main import app

client = TestClient(app)
D = date(2026, 1, 20)


# ------------------------------------------------------------------------------------------ helpers
@pytest.fixture(scope="module")
def real():
    return db.load_forecasts(), db.load_actuals()


def corrupt_from(actuals: pd.DataFrame, first_bad: date) -> pd.DataFrame:
    """Multiply every actual on or after `first_bad` (UK day) by 10 - information not known at D-1 09:00."""
    a = actuals.copy()
    uk_day = a["start_time"].dt.tz_convert("Europe/London").dt.date
    a.loc[uk_day >= first_bad, "actual"] *= 10
    return a


def decision_numbers(res):
    """Everything in a decision response that is a planning input (excludes realised outcomes)."""
    m = res["margin"]
    return {"margin": {k: m[k] for k in ("q", "available", "n", "avg", "min", "max", "cuts", "flat", "levels")},
            "band": res["band"], "demand": res["demand"],
            "rows": [{k: r.get(k) for k in ("forecast", "level", "margin", "plan", "lower", "upper",
                                             "net", "buy", "net_cover", "buy_cover")} for r in res["rows"]]}


# ===================================================================================== Feature 3: cost
@pytest.mark.parametrize("ratio,q", [(1, 0.5), (3, 0.75), (9, 0.9), (10, 10 / 11)])
def test_cost_quantile(ratio, q):
    assert planning.cost_quantile(ratio) == pytest.approx(q)


@pytest.mark.parametrize("bad", [0.99, 0, -3, 10.01, 50, float("nan"), float("inf"), None])
def test_cost_quantile_rejects_out_of_range(bad):
    with pytest.raises(ValueError):
        planning.cost_quantile(bad)


def test_higher_cost_ratio_never_gives_a_smaller_margin():
    rng = np.random.default_rng(1)
    hist = pd.DataFrame({"forecast": rng.uniform(2000, 20000, 600), "error": rng.normal(1500, 2000, 600)})
    for method in ("flat", "level"):
        prev = None
        for r in [1, 1.5, 2, 3, 5, 9, 10]:
            t = planning.margin_table(hist, planning.cost_quantile(r), method=method)
            margins = [x["used"]["margin"] for x in t["levels"]] + [t["flat"]["margin"]]
            if prev is not None:
                assert all(m >= p for m, p in zip(margins, prev)), (method, r)
            prev = margins


def test_decision_defaults_are_flat_margin_from_known_days_only():
    j = client.get("/api/decision", params={"day": "2026-01-15"}).json()
    assert j["margin"]["method"] == "flat" and j["margin"]["basis"] == "prior"
    assert j["margin"]["n"] == 12 * 24                     # 2..13 Jan (12 days) known at the 14 Jan cutoff
    for d in ("2026-01-02", "2026-01-03", "2026-01-04"):  # fewer than 30 known hours: no margin
        assert client.get("/api/decision", params={"day": d}).json()["margin"]["available"] is False
    assert client.get("/api/decision", params={"day": "2026-01-05"}).json()["margin"]["available"] is True


def test_api_margin_grows_with_cost_ratio():
    avgs = [client.get("/api/decision", params={"day": "2026-01-15", "cost_ratio": r}).json()["margin"]["avg"] for r in (1, 3, 9, 10)]
    assert avgs == sorted(avgs) and avgs[0] < avgs[-1]


def test_margin_is_the_q_quantile_and_covers_q_of_history():
    e = pd.Series(np.arange(0, 1000, 1.0))  # errors 0..999
    t = planning.margin_table(pd.DataFrame({"forecast": 1.0, "error": e}), 0.75, method="flat", min_n=1)
    assert t["flat"]["margin"] == pytest.approx(np.quantile(e, 0.75))
    assert (e <= t["flat"]["margin"]).mean() == pytest.approx(0.75, abs=0.002)


# ================================================================================ Feature 2: wind level
def test_level_cuts_and_assignment():
    cuts = planning.level_cuts([1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert cuts == pytest.approx([np.quantile(range(1, 10), 1 / 3), np.quantile(range(1, 10), 2 / 3)])
    assert list(planning.assign_levels([1, 4, 9], cuts)) == ["low", "mid", "high"]
    assert planning.level_cuts([1, 2]) is None


def test_level_margins_use_their_own_quantile_when_big_enough():
    low = pd.DataFrame({"forecast": np.linspace(1000, 2000, 40), "error": np.linspace(0, 100, 40)})
    mid = pd.DataFrame({"forecast": np.linspace(5000, 6000, 40), "error": np.linspace(0, 1000, 40)})
    high = pd.DataFrame({"forecast": np.linspace(9000, 10000, 40), "error": np.linspace(0, 3000, 40)})
    t = planning.margin_table(pd.concat([low, mid, high]), 0.9, method="level", min_n=30)
    by = {x["level"]: x for x in t["levels"]}
    assert not any(x["fallback"] for x in t["levels"])
    assert by["low"]["used"]["margin"] == pytest.approx(np.quantile(low["error"], 0.9))
    assert by["high"]["used"]["margin"] == pytest.approx(np.quantile(high["error"], 0.9))
    assert by["low"]["used"]["margin"] < t["flat"]["margin"] < by["high"]["used"]["margin"]


def test_level_with_fewer_than_30_hours_falls_back_to_flat():
    h = pd.DataFrame({"forecast": np.r_[np.full(40, 1000.0), np.full(40, 5000.0), np.full(10, 9000.0)],
                      "error": np.r_[np.zeros(40), np.full(40, 50.0), np.full(10, 9999.0)]})
    t = planning.margin_table(h, 0.75, method="level", min_n=30)
    for x in t["levels"]:
        if x["own"]["n"] < 30:
            assert x["fallback"] and x["used"] == t["flat"]
        else:
            assert not x["fallback"] and x["used"] == x["own"]
    assert any(x["fallback"] for x in t["levels"]) and t["available"]


def test_no_margin_at_all_when_total_history_below_30():
    t = planning.margin_table(pd.DataFrame({"forecast": [1.0] * 29, "error": [5.0] * 29}), 0.75)
    assert not t["available"]
    assert planning.hourly_margins([100, 200], t)["margin"].isna().all()


def test_flat_method_uses_one_margin_for_every_hour():
    rng = np.random.default_rng(2)
    h = pd.DataFrame({"forecast": rng.uniform(0, 20000, 300), "error": rng.normal(0, 1000, 300)})
    t = planning.margin_table(h, 0.75, method="flat")
    m = planning.hourly_margins([500, 10000, 19000], t)["margin"]
    assert m.nunique() == 1 and m.iloc[0] == t["flat"]["margin"]


def test_prior_history_contains_only_days_up_to_d_minus_2(real):
    ev = service.build_eval_frame(*real, "09:00", "decision")
    h = planning.history_for(ev, D, "prior", date(2026, 1, 2), date(2026, 2, 1))
    assert h["delivery_day"].max() == D - timedelta(days=2) and h["delivery_day"].min() == date(2026, 1, 2)


# =================================================================================== Feature 1: net buy
def test_net_buy_arithmetic():
    r = planning.net_buy([4000, 12000, 10000], [3000, 11000, 9500], 10000)
    assert [h["net"] for h in r["per_hour"]] == [6000, -2000, 0]
    assert [h["buy"] for h in r["per_hour"]] == [6000, 0, 0]
    assert [h["buy_cover"] for h in r["per_hour"]] == [7000, 0, 500]
    s = r["summary"]
    assert s["avg_buy"] == pytest.approx(2000) and s["avg_buy_cover"] == pytest.approx(2500)
    assert s["buy_mwh"] == 6000 and s["buy_cover_mwh"] == 7500 and s["spare_hours"] == 1


def test_net_buy_zero_demand_and_wind_above_demand():
    r = planning.net_buy([5000, 6000], [4000, 5000], 0)
    assert all(h["buy"] == 0 and h["buy_cover"] == 0 for h in r["per_hour"])
    assert r["summary"]["spare_hours"] == 2 and r["summary"]["avg_buy"] == 0
    assert [h["net"] for h in r["per_hour"]] == [-5000, -6000]   # signed value kept for display


def test_api_demand_fields_match_manual_arithmetic():
    j = client.get("/api/decision", params={"day": "2026-01-15", "demand": 25000}).json()
    for r in j["rows"]:
        assert r["net"] == pytest.approx(25000 - r["forecast"])
        assert r["buy_cover"] == pytest.approx(max(0, 25000 - r["plan"]))
    assert j["demand"]["avg_buy"] == pytest.approx(np.mean([max(0, 25000 - r["forecast"]) for r in j["rows"]]), abs=1e-3)


def test_api_without_margin_history_gives_no_cover_figures():
    j = client.get("/api/decision", params={"day": "2026-01-02", "band_basis": "prior", "demand": 20000}).json()
    assert j["margin"]["available"] is False
    assert j["demand"]["avg_buy"] is not None and j["demand"]["avg_buy_cover"] is None
    assert all(r["buy_cover"] is None and r["plan"] is None for r in j["rows"])


# ============================================================================== no look-ahead, Features 1-3
@pytest.mark.parametrize("params", [{"cost_ratio": 3, "margin_by": "level"}, {"cost_ratio": 9, "margin_by": "flat"},
                                    {"cost_ratio": 1, "margin_by": "level", "demand": 25000}])
def test_decision_inputs_ignore_everything_from_d_minus_1_on(real, params):
    fc, act = real
    clean = service.decision(fc, act, D, band_basis="prior", **params)
    dirty = service.decision(fc, corrupt_from(act, D - timedelta(days=1)), D, band_basis="prior", **params)
    assert decision_numbers(clean) == decision_numbers(dirty)
    # ...whereas corrupting D-2 (known at the cutoff) must change them: the test is not vacuous.
    dirtier = service.decision(fc, corrupt_from(act, D - timedelta(days=2)), D, band_basis="prior", **params)
    assert decision_numbers(clean)["margin"] != decision_numbers(dirtier)["margin"]


def test_decision_ignores_forecasts_published_after_the_cutoff(real):
    fc, act = real
    late = fc[fc["publish_time"] > pd.Timestamp("2026-01-19 09:00", tz="UTC")].copy()
    late["forecast"] *= 5
    fc2 = pd.concat([fc[fc["publish_time"] <= pd.Timestamp("2026-01-19 09:00", tz="UTC")], late])
    a = service.decision(fc, act, D, band_basis="prior", demand=25000)
    b = service.decision(fc2, act, D, band_basis="prior", demand=25000)
    assert decision_numbers(a) == decision_numbers(b)


# ============================================================================ Feature 4: margin check
def _ev(days_errors, forecast=1000.0):
    rows = []
    for d, errs in days_errors.items():
        rows += [{"delivery_day": d, "forecast": forecast, "error": e} for e in errs]
    return pd.DataFrame(rows)


def test_backtest_hand_built_example():
    d1, d2, d3, d4 = (date(2026, 1, i) for i in (1, 2, 3, 4))
    ev = _ev({d1: [0, 10], d2: [20, 30], d3: [5, 40], d4: [25, 26]})
    r = planning.backtest(ev, [d1, d2, d3, d4], q=0.5, method="flat", min_n=1)
    # d1, d2: no day <= D-2 yet -> skipped. d3: history = d1 errors [0, 10] -> margin 5 -> covered [5<=5, 40<=5] = 1/2.
    # d4: history = d1+d2 [0,10,20,30] -> margin 15 -> covered [25<=15, 26<=15] = 0/2.
    assert r["skipped_days"] == ["2026-01-01", "2026-01-02"]
    by = {x["day"]: x for x in r["by_day"]}
    assert by["2026-01-03"]["margin_avg"] == 5 and by["2026-01-03"]["achieved"] == 0.5
    assert by["2026-01-04"]["margin_avg"] == 15 and by["2026-01-04"]["achieved"] == 0.0
    assert r["achieved"] == 0.25 and r["n_hours"] == 4 and r["target"] == 0.5


def test_backtest_margin_for_a_day_ignores_that_day_and_the_day_before():
    d = [date(2026, 1, i) for i in range(1, 6)]
    base = {x: [1.0, 2.0, 3.0] for x in d}
    changed = {**base, d[3]: [999.0, 999.0, 999.0], d[4]: [-5.0, -5.0, -5.0]}
    a = {x["day"]: x["margin_avg"] for x in planning.backtest(_ev(base), d, 0.75, "flat", min_n=1)["by_day"]}
    b = {x["day"]: x["margin_avg"] for x in planning.backtest(_ev(changed), d, 0.75, "flat", min_n=1)["by_day"]}
    assert a["2026-01-05"] == b["2026-01-05"]          # day 5's margin uses days <= 3 only (day 4 changed)
    assert a["2026-01-04"] == b["2026-01-04"]          # day 4's margin uses days <= 2 only


def test_api_margin_check_walk_forward_uses_prior_days(real):
    j = client.get("/api/margin-check").json()
    assert j["basis"] == "prior" and j["target"] == 0.75
    assert "2026-01-02" in j["skipped_days"]             # nothing known before the first decision
    assert sum(x["n"] for x in j["by_day"]) == j["n_hours"] == sum(x["n"] for x in j["by_level"])
    fc, act = real
    clean = service.margin_check(fc, act)
    dirty = service.margin_check(fc, corrupt_from(act, D))   # corrupt the future of D-1 and later
    m_clean = {x["day"]: x["margin_avg"] for x in clean["by_day"]}
    m_dirty = {x["day"]: x["margin_avg"] for x in dirty["by_day"]}
    for day in m_clean:
        if date.fromisoformat(day) <= D + timedelta(days=1):    # their history ends at or before D-1
            assert m_clean[day] == m_dirty[day], day


# =============================================================================== validation (422)
@pytest.mark.parametrize("params", [{"cost_ratio": 0.5}, {"cost_ratio": 11}, {"cost_ratio": "x"}, {"cost_ratio": "nan"},
                                    {"margin_by": "hourly"}, {"demand": -1}, {"demand": "lots"}, {"demand": 1e9},
                                    {"demand": "inf"}])
def test_decision_rejects_bad_planning_inputs(params):
    assert client.get("/api/decision", params={"day": "2026-01-15", **params}).status_code == 422


@pytest.mark.parametrize("params", [{"cost_ratio": 0}, {"cost_ratio": 10.5}, {"margin_by": "x"}, {"cutoff": "9am"}])
def test_margin_check_rejects_bad_inputs(params):
    assert client.get("/api/margin-check", params=params).status_code == 422


def test_margin_check_reports_the_other_method_on_the_same_hours():
    j = client.get("/api/margin-check").json()
    k = client.get("/api/margin-check", params={"margin_by": "level"}).json()
    assert j["method"] == "flat" and j["compare"]["method"] == "level"
    assert j["compare"]["achieved"] == k["achieved"] and j["compare"]["margin_avg"] == k["margin_avg"]
    assert j["compare"]["n_hours"] == j["n_hours"]


def test_margin_check_ok_variants():
    for p in ({}, {"cost_ratio": 9, "margin_by": "flat"}, {"cutoff": "12:00"}):
        assert client.get("/api/margin-check", params=p).status_code == 200
