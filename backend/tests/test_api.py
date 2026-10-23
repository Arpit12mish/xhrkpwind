"""API tests against the bundled SQLite snapshot (window: delivery days 2 Jan - 1 Feb 2026)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def get(path, **params):
    return client.get(path, params=params)


def test_meta_reports_window():
    j = get("/api/meta").json()
    assert (j["first_day"], j["last_day"]) == ("2026-01-02", "2026-02-01")
    assert j["timezone"] == "Europe/London" and j["default_cutoff"] == "09:00"


def test_decision_uses_only_pre_cutoff_forecast():
    j = get("/api/decision", day="2026-01-15").json()
    assert len(j["rows"]) == 24
    assert j["latest_publish_time"] <= j["cutoff_utc"]
    assert all(r["publish_time"] <= j["cutoff_utc"] for r in j["rows"])


def test_first_and_last_days_are_served():
    first = get("/api/decision", day="2026-01-02").json()
    last = get("/api/decision", day="2026-02-01").json()
    assert len(first["rows"]) == 24 and len(last["rows"]) == 24
    assert first["cutoff_utc"] == "2026-01-01T09:00:00Z"   # decision made in January
    assert last["cutoff_utc"] == "2026-01-31T09:00:00Z"
    assert last["realised"]["n"] == 24                      # Feb-1 actuals are present


@pytest.mark.parametrize("day", ["2026-01-01", "2026-02-02", "2025-12-15", "2026-02-20"])
def test_decision_rejects_days_outside_window(day):
    r = get("/api/decision", day=day)
    assert r.status_code == 422 and "outside the data window" in r.json()["detail"]


def test_decision_other_bad_inputs():
    assert get("/api/decision").status_code == 422
    assert get("/api/decision", day="nonsense").status_code == 422
    assert get("/api/decision", day="2026-01-15", cutoff="25:00").status_code == 422
    assert get("/api/decision", day="2026-01-15", coverage="0.2").status_code == 422
    assert get("/api/decision", day="2026-01-15", band_basis="x").status_code == 422


def test_accuracy_defaults_cover_whole_window():
    j = get("/api/accuracy").json()
    assert (j["filters"]["start"], j["filters"]["end"]) == ("2026-01-02", "2026-02-01")
    assert j["summary"]["n"] == 31 * 24


def test_accuracy_horizon_filter():
    j = get("/api/accuracy", basis="all", min_h=24, max_h=36).json()
    assert j["summary"]["n"] > 0 and all(24 <= p["horizon_h"] <= 36 for p in j["points"])


@pytest.mark.parametrize("params,needle", [
    ({"start": "2026-01-20", "end": "2026-01-10"}, "must not be after"),
    ({"start": "2025-12-15", "end": "2025-12-20"}, "outside the data window"),
    ({"start": "2026-02-10", "end": "2026-02-20"}, "outside the data window"),
    ({"start": "2026-01-01"}, "outside the data window"),          # one day before the window
    ({"end": "2026-02-02"}, "outside the data window"),            # one day after
    ({"min_h": 40, "max_h": 10}, "must not exceed"),
])
def test_accuracy_rejects_bad_ranges(params, needle):
    r = get("/api/accuracy", **params)
    assert r.status_code == 422 and needle in r.json()["detail"]


@pytest.mark.parametrize("params", [{"start": "bad"}, {"end": "2026-13-45"}, {"basis": "x"},
                                    {"min_h": -1}, {"cutoff": "99:99"}, {"coverage": 1.5}])
def test_accuracy_rejects_malformed_values(params):
    assert get("/api/accuracy", **params).status_code == 422


def test_accuracy_single_day_edges_ok():
    assert get("/api/accuracy", start="2026-01-02", end="2026-01-02").json()["summary"]["n"] == 24
    assert get("/api/accuracy", start="2026-02-01", end="2026-02-01").json()["summary"]["n"] == 24


def test_decision_band_uses_only_window_days_and_matches_accuracy_band():
    d = get("/api/decision", day="2026-01-15").json()["band"]
    a = get("/api/accuracy").json()["summary"]
    assert d["n"] == a["n"] == 31 * 24          # no slack days (1 Jan, 2 Feb) leak into the band
    assert (d["lo"], d["hi"]) == (a["band_lo"], a["band_hi"])
