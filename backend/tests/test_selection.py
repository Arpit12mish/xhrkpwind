from datetime import date, time

import pandas as pd
import pytest

from app import selection


def ts(s):
    return pd.Timestamp(s, tz="UTC")


def fc(rows):
    return pd.DataFrame(rows, columns=["start_time", "publish_time", "forecast"]).assign(
        start_time=lambda d: pd.to_datetime(d.start_time, utc=True),
        publish_time=lambda d: pd.to_datetime(d.publish_time, utc=True))


def test_cutoff_winter_is_utc():
    assert selection.cutoff_utc(date(2026, 1, 15), time(9, 0)) == ts("2026-01-14 09:00")


def test_cutoff_summer_is_bst_offset():
    # 09:00 BST == 08:00 UTC
    assert selection.cutoff_utc(date(2026, 7, 15), time(9, 0)) == ts("2026-07-14 08:00")


def test_cutoff_day_before_spring_forward():
    # Clocks go forward 2026-03-29 01:00 UTC. D=Mar 30, cutoff Mar 29 09:00 BST = 08:00 UTC.
    assert selection.cutoff_utc(date(2026, 3, 30), time(9, 0)) == ts("2026-03-29 08:00")


def test_picks_latest_vintage_not_after_cutoff():
    t = "2026-01-15 12:00"
    df = fc([(t, "2026-01-14 04:30", 100), (t, "2026-01-14 07:30", 200),
             (t, "2026-01-14 09:00", 300),   # exactly at cutoff: allowed
             (t, "2026-01-14 09:30", 400)])  # after cutoff: must be ignored
    out = selection.select_latest_forecasts(df, "09:00")
    assert len(out) == 1
    assert out.loc[0, "forecast"] == 300
    assert out.loc[0, "publish_time"] == ts("2026-01-14 09:00")
    assert out.loc[0, "horizon_h"] == pytest.approx(27.0)


def test_never_uses_forecast_published_after_cutoff_even_if_only_one():
    df = fc([("2026-01-15 12:00", "2026-01-14 09:30", 400)])
    assert selection.select_latest_forecasts(df, "09:00").empty


def test_each_target_selected_independently():
    df = fc([("2026-01-15 00:00", "2026-01-14 07:30", 1), ("2026-01-15 01:00", "2026-01-14 07:30", 2),
             ("2026-01-15 01:00", "2026-01-14 08:30", 3)])
    out = selection.select_latest_forecasts(df, "09:00").set_index("start_time")["forecast"]
    assert out[ts("2026-01-15 00:00")] == 1 and out[ts("2026-01-15 01:00")] == 3


def test_cutoff_is_configurable():
    t = "2026-01-15 12:00"
    df = fc([(t, "2026-01-14 07:30", 1), (t, "2026-01-14 09:30", 2)])
    assert selection.select_latest_forecasts(df, "09:00").loc[0, "forecast"] == 1
    assert selection.select_latest_forecasts(df, "10:00").loc[0, "forecast"] == 2


def test_delivery_day_uses_uk_local_date_in_summer():
    # 23:30 UTC on Jul 14 is 00:30 BST on Jul 15 -> belongs to delivery day Jul 15.
    s = pd.Series(pd.to_datetime(["2026-07-14 23:30"], utc=True))
    assert selection.delivery_day_of(s)[0] == date(2026, 7, 15)


def test_join_actuals_aligns_on_start_time():
    f = fc([("2026-01-15 00:00", "2026-01-14 07:30", 10), ("2026-01-15 01:00", "2026-01-14 07:30", 20)])
    a = pd.DataFrame({"start_time": pd.to_datetime(["2026-01-15 01:00"], utc=True), "actual": [25.0]})
    out = selection.join_actuals(f, a)
    assert out["actual"].isna().tolist() == [True, False]
