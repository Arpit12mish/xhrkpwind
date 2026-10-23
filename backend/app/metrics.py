"""Accuracy metrics. Convention: error = forecast - actual (MW); positive = over-forecast."""
from __future__ import annotations

import math
from typing import Dict, List, Optional

import numpy as np
import pandas as pd


def add_errors(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["error"] = df["forecast"] - df["actual"]
    df["abs_error"] = df["error"].abs()
    return df


def _num(x) -> Optional[float]:
    """JSON-safe float (NaN/inf -> None)."""
    if x is None:
        return None
    x = float(x)
    return None if math.isnan(x) or math.isinf(x) else round(x, 3)


def error_band(errors: pd.Series, coverage: float = 0.8) -> Dict[str, Optional[float]]:
    """Central `coverage` interval of the signed error, e.g. 0.8 -> (P10, P90).

    Because error = forecast - actual, the plausible range for actual is
    [forecast - hi, forecast - lo].
    """
    e = errors.dropna()
    if e.empty:
        return {"lo": None, "hi": None, "coverage": coverage}
    tail = (1 - coverage) / 2
    return {"lo": _num(np.quantile(e, tail)), "hi": _num(np.quantile(e, 1 - tail)),
            "coverage": coverage}


def summarize(df: pd.DataFrame, coverage: float = 0.8) -> Dict[str, Optional[float]]:
    """Headline metrics for a frame with `error`, `abs_error`, `actual`, `forecast`."""
    d = df.dropna(subset=["error"])
    if d.empty:
        return {"n": 0}
    nz = d[d["actual"] > 0]  # MAPE undefined for actual == 0
    band = error_band(d["error"], coverage)
    return {
        "n": int(len(d)),
        "mae": _num(d["abs_error"].mean()),
        "rmse": _num(math.sqrt((d["error"] ** 2).mean())),
        "mape": _num((nz["abs_error"] / nz["actual"]).mean() * 100) if len(nz) else None,
        "bias": _num(d["error"].mean()),
        "p50_abs_error": _num(np.percentile(d["abs_error"], 50)),
        "p90_abs_error": _num(np.percentile(d["abs_error"], 90)),
        "p99_abs_error": _num(np.percentile(d["abs_error"], 99)),
        "mean_actual": _num(d["actual"].mean()),
        "band_lo": band["lo"], "band_hi": band["hi"], "band_coverage": coverage,
    }


def group_metrics(df: pd.DataFrame, key: str) -> List[Dict]:
    """Per-group MAE/RMSE/bias/P90 (+ n). `key` is a column name."""
    out = []
    for k, g in df.dropna(subset=["error"]).groupby(key, sort=True):
        out.append({
            key: k if isinstance(k, (int, float, str)) else str(k),
            "n": int(len(g)),
            "mae": _num(g["abs_error"].mean()),
            "rmse": _num(math.sqrt((g["error"] ** 2).mean())),
            "bias": _num(g["error"].mean()),
            "p90_abs_error": _num(np.percentile(g["abs_error"], 90)),
        })
    return out


def histogram(errors: pd.Series, bin_width: float = 500.0) -> List[Dict]:
    e = errors.dropna()
    if e.empty:
        return []
    lo = math.floor(e.min() / bin_width) * bin_width
    hi = math.ceil((e.max() + 1e-9) / bin_width) * bin_width
    edges = np.arange(lo, hi + bin_width, bin_width)
    counts, edges = np.histogram(e, bins=edges)
    return [{"bin_start": float(edges[i]), "bin_end": float(edges[i + 1]), "count": int(c)}
            for i, c in enumerate(counts)]
