"""Tier-2 features: ramp watch, forecast stability, recent bias, cutoff comparison.

Each has maths/edge-case tests plus a no-look-ahead test (data from D-1 on, or forecasts published after the
cutoff, are corrupted; every number shown for day D with band_basis='prior' must stay the same).
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
T = lambda s: pd.Timestamp(s, tz="UTC")  # noqa: E731


@pytest.fixture(scope="module")
def real():
    return db.load_forecasts(), db.load_actuals()


def corrupt_actuals_from(act, first_bad):
    a = act.copy()
    a.loc[a["start_time"].dt.tz_convert("Europe/London").dt.date >= first_bad, "actual"] *= 10
    return a


def corrupt_forecasts_after(fc, ts):
    f = fc.copy()
    f.loc[f["publish_time"] > ts, "forecast"] *= 7
    return f


def tier2_numbers(res):
    rows = [{k: r.get(k) for k in ("ramp_size", "ramp")} for r in res["rows"]]
    return {"ramps": res["ramps"], "stability": res["stability"], "rows": rows}


# ========================================================================================= F5 ramp watch
def _versions(rows):
    return pd.DataFrame(rows, columns=["publish_time", "start_time", "forecast"]).assign(
        publish_time=lambda d: pd.to_datetime(d.publish_time, utc=True), start_time=lambda d: pd.to_datetime(d.start_time, utc=True))


def test_ramp_size_is_largest_change_within_3_hours_of_the_same_version():
    v1 = "2026-01-10 07:30"
    fc = _versions([(v1, "2026-01-11 00:00", 0), (v1, "2026-01-11 01:00", 100), (v1, "2026-01-11 02:00", 1000),
                    (v1, "2026-01-11 03:00", 1100), (v1, "2026-01-11 04:00", 1100), (v1, "2026-01-11 05:00", 1100),
                    (v1, "2026-01-11 06:00", 1100), (v1, "2026-01-11 07:00", 1100)])
    rows = fc[["start_time", "publish_time"]]
    s = planning.ramp_sizes(rows, fc).tolist()
    assert np.isnan(s[0])                     # nothing earlier in this version
    assert s[1:5] == [100, 1000, 1100, 1000]  # t=04:00 looks back to 01:00 (100) -> 1000
    assert s[6] == 0 and s[7] == 0            # flat for 3+ hours


def test_ramp_ignores_jumps_between_versions():
    fc = _versions([("2026-01-10 04:30", "2026-01-11 00:00", 0), ("2026-01-10 07:30", "2026-01-11 01:00", 5000)])
    rows = fc[fc["publish_time"] == T("2026-01-10 07:30")][["start_time", "publish_time"]]
    assert np.isnan(planning.ramp_sizes(rows, fc).iloc[0])   # 00:00 is not in the 07:30 version


def test_ramp_threshold_and_stats_with_small_sample_fallback():
    assert planning.ramp_threshold(pd.Series(np.arange(101.0))) == pytest.approx(90.0)
    hist = pd.DataFrame({"error": np.r_[np.full(10, 500.0), np.full(90, 100.0)]})
    sizes = pd.Series(np.r_[np.full(10, 2000.0), np.full(90, 10.0)])
    st = planning.ramp_error_stats(hist, sizes, 1000)
    assert st["ramp"]["n"] == 10 and st["other"]["n"] == 90 and st["ramp"]["typical_miss"] == 500
    assert st["enough"] is False and st["ratio"] is None          # 10 ramp hours < 30: no comparison claimed
    st2 = planning.ramp_error_stats(pd.concat([hist] * 3, ignore_index=True), pd.concat([sizes] * 3, ignore_index=True), 1000)
    assert st2["enough"] and st2["ratio"] == pytest.approx(5.0)


def test_api_ramp_threshold_default_and_user_value():
    j = client.get("/api/decision", params={"day": "2026-01-15"}).json()["ramps"]
    assert j["source"] == "auto" and j["threshold"] == j["auto_threshold"] > 0
    k = client.get("/api/decision", params={"day": "2026-01-15", "ramp_mw": 500}).json()
    assert k["ramps"]["source"] == "user" and k["ramps"]["threshold"] == 500
    assert k["ramps"]["hours_today"] == sum(r["ramp"] for r in k["rows"]) >= j["hours_today"]
    assert all(r["ramp"] == (r["ramp_size"] is not None and r["ramp_size"] >= 500) for r in k["rows"])


# =================================================================================== F6 forecast stability
def test_day_average_by_version_needs_full_coverage_and_respects_cutoff():
    hours = ["2026-01-11 00:00", "2026-01-11 01:00"]
    fc = _versions([("2026-01-10 02:30", hours[0], 100), ("2026-01-10 02:30", hours[1], 300),
                    ("2026-01-10 04:30", hours[0], 200),                                   # misses 01:00 -> excluded
                    ("2026-01-10 07:30", hours[0], 400), ("2026-01-10 07:30", hours[1], 600),
                    ("2026-01-10 09:30", hours[0], 9e9), ("2026-01-10 09:30", hours[1], 9e9)])  # after cutoff
    v = planning.day_average_by_version(fc, pd.Series(pd.to_datetime(hours, utc=True)), T("2026-01-10 09:00"))
    assert [x["day_avg"] for x in v] == [200, 500] and planning.revision_of(v) == 300
    assert planning.revision_of(v[:1]) is None


def test_correlation_test_detects_strong_and_no_relationship():
    x = np.arange(40.0)
    strong = planning.correlation_test(x, 2 * x + 1)
    assert strong["r"] == pytest.approx(1.0) and strong["p"] < 0.01
    noise = planning.correlation_test(x, np.random.default_rng(5).normal(size=40))
    assert abs(noise["r"]) < 0.4 and noise["p"] > 0.05
    assert planning.correlation_test([1, 2], [3, 4])["r"] is None


# ======================================================================================== F7 recent bias
def _ev_days(errs):
    rows = []
    for d, e in errs.items():
        rows += [{"delivery_day": d, "error": x} for x in e]
    return pd.DataFrame(rows)


def test_bias_correction_backtest_hand_built():
    d = [date(2026, 1, i) for i in range(1, 5)]
    ev = _ev_days({d[0]: [100, 100], d[1]: [300, 300], d[2]: [150, 50], d[3]: [500, 500]})
    r = planning.bias_correction_backtest(ev, d, k=1)
    # d3 uses d1 (mean 100): |150-100|, |50-100| -> 50, 50. d4 uses d2 (300): |500-300| x2 -> 200, 200.
    assert r["skipped_days"] == ["2026-01-01", "2026-01-02"]
    assert r["mae_raw"] == pytest.approx((150 + 50 + 500 + 500) / 4)
    assert r["mae_corrected"] == pytest.approx((50 + 50 + 200 + 200) / 4)


def test_bias_correction_never_uses_d_minus_1():
    d = [date(2026, 1, i) for i in range(1, 6)]
    base = {x: [100.0] for x in d}
    a = planning.bias_correction_backtest(_ev_days(base), d, k=2)
    b = planning.bias_correction_backtest(_ev_days({**base, d[3]: [9999.0]}), d[:4] + [d[4]], k=2)
    # day 5 uses days 2-3 only, so changing day 4 must not change day 5's corrected error
    a5 = planning.bias_correction_backtest(_ev_days(base), [d[4]], k=2)
    b5 = planning.bias_correction_backtest(_ev_days({**base, d[3]: [9999.0]}), [d[4]], k=2)
    assert a5["mae_corrected"] == b5["mae_corrected"] == 0
    assert a["n_days"] == b["n_days"]


def test_lag_test_on_known_series():
    days = pd.date_range("2026-01-01", periods=40).date
    s = pd.Series(np.sin(np.arange(40) / 2.0), index=days)
    one = planning.lag_test(s, 1)
    assert one["n"] == 39 and one["r"] > 0.8


def test_recent_bias_toggle_rule_matches_backtest():
    j = client.get("/api/recent-bias").json()
    assert j["primary"]["k"] == 3 and j["all_known_days"]["k"] is None
    assert j["lowers_mae"] == (j["primary"]["mae_corrected"] < j["primary"]["mae_raw"]) and "offered" not in j
    assert j["lag_2"]["lag_days"] == 2 and j["lag_2"]["n"] >= 25


def test_plan_page_has_no_adjusted_forecast(real):
    fc, act = real
    res = service.decision(fc, act, D)
    assert "correction" not in res and all("forecast_adj" not in r for r in res["rows"])
    j = client.get("/api/decision", params={"day": "2026-01-15", "bias_adjust": "true"}).json()   # old flag is ignored
    assert "correction" not in j

# ======================================================================== no look-ahead for F5, F6, F7
def test_tier2_numbers_ignore_actuals_from_d_minus_1_on(real):
    fc, act = real
    clean = service.decision(fc, act, D, band_basis="prior")
    dirty = service.decision(fc, corrupt_actuals_from(act, D - timedelta(days=1)), D, band_basis="prior")
    assert tier2_numbers(clean) == tier2_numbers(dirty)
    dirtier = service.decision(fc, corrupt_actuals_from(act, D - timedelta(days=2)), D, band_basis="prior")
    assert tier2_numbers(clean) != tier2_numbers(dirtier)          # the test can fail


def test_tier2_numbers_ignore_forecasts_published_after_the_cutoff(real):
    fc, act = real
    cut = T("2026-01-19 09:00")
    a = service.decision(fc, act, D, band_basis="prior")
    b = service.decision(corrupt_forecasts_after(fc, cut), act, D, band_basis="prior")
    assert tier2_numbers(a) == tier2_numbers(b)


# ================================================================================ F8 cutoff comparison
def test_cutoff_compare_versions_and_consistency():
    j = client.get("/api/cutoff-compare").json()
    by = {r["cutoff"]: r for r in j["rows"]}
    assert list(by) == ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00"]
    assert by["06:00"]["versions_utc"] == ["04:30"] and by["09:00"]["versions_utc"] == ["07:30"]
    assert "11:30" in by["12:00"]["versions_utc"]
    acc = client.get("/api/accuracy").json()["summary"]
    assert by["09:00"]["mae"] == pytest.approx(acc["mae"], abs=1e-3) and by["09:00"]["n"] == acc["n"]
    assert all(r["n"] == 744 for r in j["rows"])


# ============================================================================================ validation
@pytest.mark.parametrize("params", [{"ramp_mw": 50}, {"ramp_mw": 30000}, {"ramp_mw": "big"}, {"ramp_mw": "nan"},
                                    ])
def test_decision_rejects_bad_tier2_inputs(params):
    assert client.get("/api/decision", params={"day": "2026-01-15", **params}).status_code == 422


def test_recent_bias_rejects_bad_cutoff():
    assert client.get("/api/recent-bias", params={"cutoff": "25:00"}).status_code == 422
