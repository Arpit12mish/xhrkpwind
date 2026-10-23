"""Ingestion cleaning and storage. Small fixtures only - no network calls."""
import sqlite3

import pytest

from app import ingestion


def fc_row(start, publish, gen):
    return {"dataset": "WINDFOR", "startTime": start, "publishTime": publish, "generation": gen}


def act_row(start, gen, fuel="WIND", publish="2026-01-10T00:00:00Z"):
    return {"dataset": "FUELHH", "startTime": start, "publishTime": publish, "fuelType": fuel, "generation": gen}


def test_forecast_nulls_dropped():
    rows = [fc_row("2026-01-10T00:00:00Z", "2026-01-09T07:30:00Z", 100),
            fc_row("2026-01-10T01:00:00Z", "2026-01-09T07:30:00Z", None),
            fc_row(None, "2026-01-09T07:30:00Z", 5),
            fc_row("2026-01-10T02:00:00Z", None, 5),
            fc_row("2026-01-10T03:00:00Z", "2026-01-09T07:30:00Z", "n/a")]
    out = ingestion.clean_forecasts(rows)
    assert out["startTime"].tolist() == ["2026-01-10T00:00:00Z"]


def test_forecast_duplicates_resolved_keep_last():
    rows = [fc_row("2026-01-10T00:00:00Z", "2026-01-09T07:30:00Z", 100),
            fc_row("2026-01-10T00:00:00Z", "2026-01-09T07:30:00Z", 110),  # same vintage re-sent
            fc_row("2026-01-10T00:00:00Z", "2026-01-09T09:30:00Z", 120)]  # a different vintage is kept
    out = ingestion.clean_forecasts(rows).set_index("publishTime")["generation"]
    assert len(out) == 2 and out["2026-01-09T07:30:00Z"] == 110


def test_actuals_non_wind_filtered_out():
    rows = [act_row("2026-01-10T00:00:00Z", 100), act_row("2026-01-10T00:00:00Z", 999, fuel="CCGT"),
            act_row("2026-01-10T00:00:00Z", 888, fuel="NUCLEAR")]
    out = ingestion.clean_actuals(rows)
    assert out["generation"].tolist() == [100]


def test_actuals_nulls_dropped_and_duplicate_keeps_latest_publish():
    rows = [act_row("2026-01-10T00:00:00Z", 100, publish="2026-01-10T00:30:00Z"),
            act_row("2026-01-10T00:00:00Z", 105, publish="2026-01-10T06:00:00Z"),  # later revision wins
            act_row("2026-01-10T00:30:00Z", None)]
    out = ingestion.clean_actuals(rows)
    assert out["startTime"].tolist() == ["2026-01-10T00:00:00Z"] and out["generation"].tolist() == [105]


def test_empty_input_is_handled():
    assert ingestion.clean_forecasts([]).empty and ingestion.clean_actuals([]).empty


def test_store_reports_dropped_counts(tmp_path):
    fc = [fc_row("2026-01-10T00:00:00Z", "2026-01-09T07:30:00Z", 1), fc_row("2026-01-10T01:00:00Z", "2026-01-09T07:30:00Z", None)]
    act = [act_row("2026-01-10T00:00:00Z", 5), act_row("2026-01-10T00:00:00Z", 9, fuel="CCGT")]
    stats = ingestion.store(fc, act, tmp_path / "t.db")
    assert stats["dropped_forecast_rows"] == 1 and stats["dropped_actual_rows"] == 1


def test_store_is_idempotent(tmp_path):
    path = tmp_path / "t.db"
    fc = [fc_row("2026-01-10T00:00:00Z", "2026-01-09T07:30:00Z", 1),
          fc_row("2026-01-10T00:00:00Z", "2026-01-09T09:30:00Z", 2)]
    act = [act_row("2026-01-10T00:00:00Z", 5), act_row("2026-01-10T00:30:00Z", 6)]
    ingestion.store(fc, act, path)
    ingestion.store(fc, act, path)  # re-run with identical data
    ingestion.store(fc + [fc_row("2026-01-10T01:00:00Z", "2026-01-09T07:30:00Z", 3)], act, path)  # overlapping re-fetch
    con = sqlite3.connect(path)
    assert con.execute("select count(*) from wind_forecast").fetchone()[0] == 3
    assert con.execute("select count(*) from wind_actual").fetchone()[0] == 2
    assert con.execute("select generation from wind_forecast where start_time='2026-01-10T00:00:00Z' "
                       "and publish_time='2026-01-09T07:30:00Z'").fetchone()[0] == 1


def test_fetch_plan_covers_cutoff_of_first_day_and_last_day():
    p = ingestion.fetch_plan("2026-01-02", "2026-02-01")
    # D-1 cutoff for the first delivery day is on 1 Jan: forecasts must be fetched from before then.
    assert str(p.forecast_publish_from) <= "2026-01-01"
    assert str(p.forecast_publish_to) == "2026-02-01" and str(p.actual_to) >= "2026-02-01"


def test_readonly_connection_cannot_write(tmp_path):
    from app import db
    path = tmp_path / "ro.db"
    ingestion.store([], [], path)
    with pytest.raises(sqlite3.OperationalError):
        with db.connect(path, readonly=True) as con:
            con.execute("INSERT INTO wind_actual VALUES ('x', 1)")
