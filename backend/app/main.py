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
            "band_coverage": config.DEFAULT_BAND_COVERAGE,
            "forecast_rows": len(fc), "actual_rows": len(act)}


@app.get("/api/decision")
def decision(day: date, cutoff: str = CutoffQ,
             coverage: float = Query(config.DEFAULT_BAND_COVERAGE, ge=0.5, le=0.99),
             band_basis: str = Query("all", pattern="^(all|prior)$")):
    _check_day(day)
    fc, act = _data()
    return service.decision(fc, act, day, cutoff, coverage, band_basis)


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
