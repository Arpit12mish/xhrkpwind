"""FastAPI routes. All paths live under /api so the same app works behind Vercel rewrites."""
from __future__ import annotations

from datetime import date
from functools import lru_cache
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from . import config, db, service
from .selection import parse_cutoff

app = FastAPI(title="UK Wind Day-Ahead Decision Support", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])
app.add_middleware(GZipMiddleware, minimum_size=1024)

# The data is a frozen snapshot that only changes with a new deployment (a new deployment gets a fresh CDN
# cache), so successful read responses can be cached at the edge. Health/warm-up must always reach the function.
CACHEABLE = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and request.url.path not in ("/api/health", "/api/warm"):
        response.headers["Cache-Control"] = CACHEABLE
    elif request.url.path in ("/api/health", "/api/warm"):
        response.headers["Cache-Control"] = "no-store"
    return response

CutoffQ = Query(config.DEFAULT_CUTOFF, pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
                description="Local UK time on D-1, HH:MM")


@lru_cache(maxsize=1)
def _data():
    # The DB is read-only at runtime, so loading once per process is safe.
    return db.load_forecasts(), db.load_actuals()


def _window():
    return date.fromisoformat(config.DATA_FIRST_DAY), date.fromisoformat(config.DATA_LAST_DAY)


def _check_day(d: date, name: str = "day") -> None:
    first, last = _window()
    if not first <= d <= last:
        raise HTTPException(422, f"{name} {d} is outside the data window {first} to {last}")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/warm")
def warm():
    """Wakes a cold serverless instance and loads the data, so the user's next request is fast."""
    fc, act = _data()
    return {"status": "warm", "forecast_rows": len(fc), "actual_rows": len(act)}


@app.get("/api/meta")
def meta():
    fc, act = _data()
    first, last = _window()
    return {"first_day": first.isoformat(), "last_day": last.isoformat(),
            "default_cutoff": config.DEFAULT_CUTOFF, "timezone": "Europe/London",
            "scope": "delivery days; decisions are made on the day before (D-1)",
            "band_coverage": config.DEFAULT_BAND_COVERAGE, "default_cost_ratio": config.DEFAULT_COST_RATIO,
            "default_margin_by": config.DEFAULT_MARGIN_BY, "default_band_basis": config.DEFAULT_BAND_BASIS,
            "forecast_rows": len(fc), "actual_rows": len(act)}


CostRatioQ = Query(config.DEFAULT_COST_RATIO, ge=1, le=10, allow_inf_nan=False,
                   description="A shortfall costs this many times a surplus (1 to 10)")
MarginByQ = Query(config.DEFAULT_MARGIN_BY, pattern="^(level|flat)$", description="One flat margin, or a margin per wind level")


@app.get("/api/decision")
def decision(day: date, cutoff: str = CutoffQ,
             coverage: float = Query(config.DEFAULT_BAND_COVERAGE, ge=0.5, le=0.99),
             band_basis: str = Query(config.DEFAULT_BAND_BASIS, pattern="^(all|prior)$",
                                     description="prior = only days known at the cutoff (default); all = every window day"),
             cost_ratio: float = CostRatioQ, margin_by: str = MarginByQ,
             demand: Optional[float] = Query(None, ge=0, le=100000, allow_inf_nan=False,
                                             description="User-entered expected demand in MW (not data)"),
             ramp_mw: Optional[float] = Query(None, ge=100, le=20000, allow_inf_nan=False,
                                              description="Ramp threshold in MW over 1-3 hours; empty = 90th percentile of history")):
    _check_day(day)
    fc, act = _data()
    return service.decision(fc, act, day, cutoff, coverage, band_basis, cost_ratio, margin_by, demand, ramp_mw)


def PriceQ(what: str):
    # A fresh Query per parameter: sharing one Query object between two parameters makes FastAPI fill both from one value.
    return Query(None, ge=0, le=10000, allow_inf_nan=False, description=f"User-typed {what} price in GBP/MWh (not data)")


@app.get("/api/replay")
def replay(cutoff: str = CutoffQ, cost_ratio: float = CostRatioQ, margin_by: str = MarginByQ,
           price_short: Optional[float] = PriceQ("shortfall"), price_unused: Optional[float] = PriceQ("unused reserve")):
    if (price_short is None) != (price_unused is None):
        raise HTTPException(422, "Give both prices (shortfall and unused reserve) or neither")
    fc, act = _data()
    return service.replay(fc, act, cutoff, cost_ratio, margin_by, price_short, price_unused)


@app.get("/api/tradeoff")
def tradeoff(cutoff: str = CutoffQ, margin_by: str = MarginByQ, cost_ratio: float = CostRatioQ):
    fc, act = _data()
    return service.tradeoff(fc, act, cutoff, margin_by, cost_ratio)


@app.get("/api/baseline")
def baseline(start: Optional[date] = None, end: Optional[date] = None, cutoff: str = CutoffQ):
    first, last = _window()
    start, end = start or first, end or last
    _check_day(start, "start")
    _check_day(end, "end")
    if start > end:
        raise HTTPException(422, f"start {start} must not be after end {end}")
    fc, act = _data()
    return service.baseline(fc, act, start, end, cutoff)


@app.get("/api/recent-bias")
def recent_bias(cutoff: str = CutoffQ):
    fc, act = _data()
    return service.recent_bias(fc, act, cutoff)


@app.get("/api/cutoff-compare")
def cutoff_compare():
    fc, act = _data()
    return service.cutoff_compare(fc, act)


@app.get("/api/margin-check")
def margin_check(cutoff: str = CutoffQ, cost_ratio: float = CostRatioQ, margin_by: str = MarginByQ):
    fc, act = _data()
    return service.margin_check(fc, act, cutoff, cost_ratio, margin_by)


@app.get("/api/accuracy")
def accuracy(start: Optional[date] = None, end: Optional[date] = None, cutoff: str = CutoffQ,
             basis: str = Query("decision", pattern="^(decision|all)$"),
             min_h: Optional[float] = Query(None, ge=0), max_h: Optional[float] = Query(None, ge=0),
             coverage: float = Query(config.DEFAULT_BAND_COVERAGE, ge=0.5, le=0.99)):
    first, last = _window()
    start, end = start or first, end or last
    _check_day(start, "start")
    _check_day(end, "end")
    if start > end:
        raise HTTPException(422, f"start {start} must not be after end {end}")
    if min_h is not None and max_h is not None and min_h > max_h:
        raise HTTPException(422, f"min_h {min_h} must not exceed max_h {max_h}")
    fc, act = _data()
    return service.accuracy(fc, act, start, end, cutoff, basis, min_h, max_h, coverage)
