import math

import numpy as np
import pandas as pd
import pytest

from app import metrics


def frame(forecast, actual):
    return metrics.add_errors(pd.DataFrame({"forecast": forecast, "actual": actual}))


def test_error_sign_forecast_minus_actual():
    assert frame([110], [100])["error"].iloc[0] == 10


def test_core_metrics_hand_computed():
    df = frame([110, 90, 130, 100], [100, 100, 100, 100])  # errors 10, -10, 30, 0
    s = metrics.summarize(df)
    assert s["mae"] == pytest.approx(12.5)
    assert s["rmse"] == pytest.approx(math.sqrt((100 + 100 + 900 + 0) / 4), abs=1e-3)
    assert s["bias"] == pytest.approx(7.5)
    assert s["mape"] == pytest.approx(12.5)
    assert s["n"] == 4


def test_abs_error_percentiles_match_numpy():
    err = np.arange(1, 101)
    s = metrics.summarize(frame(1000 + err, [1000] * 100))
    assert s["p50_abs_error"] == pytest.approx(np.percentile(err, 50))
    assert s["p90_abs_error"] == pytest.approx(np.percentile(err, 90))
    assert s["p99_abs_error"] == pytest.approx(np.percentile(err, 99))


def test_mape_ignores_zero_actuals():
    s = metrics.summarize(frame([10, 50], [0, 100]))
    assert s["mape"] == pytest.approx(50.0)


def test_empty_frame():
    assert metrics.summarize(frame([], [])) == {"n": 0}


def test_error_band_quantiles_and_asymmetry():
    e = pd.Series(np.arange(-10, 91))  # -10..90
    b = metrics.error_band(e, 0.8)
    assert b["lo"] == pytest.approx(np.quantile(e, 0.1))
    assert b["hi"] == pytest.approx(np.quantile(e, 0.9))
    assert b["hi"] > abs(b["lo"])  # skewed errors give an asymmetric band


def test_group_metrics_by_key():
    df = frame([110, 90, 105], [100, 100, 100]).assign(hour=[0, 0, 1])
    g = {r["hour"]: r for r in metrics.group_metrics(df, "hour")}
    assert g[0]["mae"] == 10 and g[0]["bias"] == 0 and g[1]["n"] == 1


def test_histogram_counts_sum_to_n():
    h = metrics.histogram(pd.Series([-600, -10, 0, 20, 700]), 500)
    assert sum(b["count"] for b in h) == 5
