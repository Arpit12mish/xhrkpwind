"""Pre-compute the default API responses as static JSON, served straight from the CDN.

The data is a frozen snapshot, so the responses the app asks for on first load never change. Serving them as static
files means the default Decision/Accuracy views need no Python function (no cold start). Anything else (other
cutoffs, filters, ...) still goes to the live API.

Run from the repo root after (re-)ingesting data or changing the API:
    python scripts/export_precomputed.py
Output: frontend/public/precomputed/{meta, accuracy, margin_check, recent_bias, cutoff_compare, baseline, replay, tradeoff, decision/<day>}.json
A test (backend/tests/test_precomputed.py) fails if these files differ from the live API output.
"""
import json
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402
from app.main import app  # noqa: E402

OUT = ROOT / "frontend" / "public" / "precomputed"


def write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


def main() -> None:
    client = TestClient(app)
    if OUT.exists():
        shutil.rmtree(OUT)
    first, last = date.fromisoformat(config.DATA_FIRST_DAY), date.fromisoformat(config.DATA_LAST_DAY)
    write(OUT / "meta.json", client.get("/api/meta").json())
    write(OUT / "accuracy.json", client.get("/api/accuracy").json())
    write(OUT / "margin_check.json", client.get("/api/margin-check").json())
    write(OUT / "recent_bias.json", client.get("/api/recent-bias").json())
    write(OUT / "cutoff_compare.json", client.get("/api/cutoff-compare").json())
    write(OUT / "baseline.json", client.get("/api/baseline").json())
    write(OUT / "replay.json", client.get("/api/replay").json())
    write(OUT / "tradeoff.json", client.get("/api/tradeoff").json())
    d = first
    while d <= last:
        r = client.get("/api/decision", params={"day": d.isoformat()})
        r.raise_for_status()
        write(OUT / "decision" / f"{d.isoformat()}.json", r.json())
        d += timedelta(days=1)
    n = sum(1 for _ in OUT.rglob("*.json"))
    size = sum(p.stat().st_size for p in OUT.rglob("*.json"))
    print(f"wrote {n} files, {size / 1024:.0f} KB to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
