"""Pre-computed static JSON (served from the CDN) must equal what the live API returns for the default queries."""
import json
import re
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app

ROOT = Path(__file__).resolve().parents[2]
PRE = ROOT / "frontend" / "public" / "precomputed"
client = TestClient(app)
HINT = "run `python scripts/export_precomputed.py` and commit the result"


def load(rel):
    return json.loads((PRE / rel).read_text())


def test_meta_and_accuracy_match_api():
    assert load("meta.json") == client.get("/api/meta").json(), HINT
    assert load("accuracy.json") == client.get("/api/accuracy").json(), HINT
    assert load("margin_check.json") == client.get("/api/margin-check").json(), HINT
    assert load("recent_bias.json") == client.get("/api/recent-bias").json(), HINT
    assert load("cutoff_compare.json") == client.get("/api/cutoff-compare").json(), HINT
    assert load("baseline.json") == client.get("/api/baseline").json(), HINT
    assert load("replay.json") == client.get("/api/replay").json(), HINT
    assert load("tradeoff.json") == client.get("/api/tradeoff").json(), HINT


def test_one_decision_file_per_window_day_and_each_matches_api():
    first, last = date.fromisoformat(config.DATA_FIRST_DAY), date.fromisoformat(config.DATA_LAST_DAY)
    days = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]
    assert sorted(p.stem for p in (PRE / "decision").glob("*.json")) == days, HINT
    for d in days:
        assert load(f"decision/{d}.json") == client.get("/api/decision", params={"day": d}).json(), f"{d}: {HINT}"


def test_frontend_default_constants_match_backend_defaults():
    """api.js only uses a precomputed file when the request equals the backend defaults; keep them in sync."""
    js = (ROOT / "frontend" / "src" / "api.js").read_text()
    assert float(re.search(r"DEFAULT_COVERAGE\s*=\s*([\d.]+)", js).group(1)) == config.DEFAULT_BAND_COVERAGE
    assert re.search(r'DEFAULT_BAND_BASIS\s*=\s*"%s"' % config.DEFAULT_BAND_BASIS, js)
    assert re.search(r'DEFAULT_BASIS\s*=\s*"decision"', js)
    assert float(re.search(r"DEFAULT_COST_RATIO\s*=\s*([\d.]+)", js).group(1)) == config.DEFAULT_COST_RATIO
    assert re.search(r'DEFAULT_MARGIN_BY\s*=\s*"%s"' % config.DEFAULT_MARGIN_BY, js)
