# GB Wind – Day-Ahead Decision Support

A small web app for a UK day-ahead power-buying team. It shows (1) the latest national wind forecast that was available
at the moment the D-1 buying decision had to be made, and (2) how accurate that forecast has been, as a safety margin in MW.
Data: Elexon BMRS only (national level): `WINDFOR` forecasts and `FUELHH` (fuelType `WIND`) actuals.

**Live app:** `<ADD DEPLOYED URL HERE>`  ·  **Video:** `<ADD UNLISTED YOUTUBE URL HERE>`

> **AI disclosure:** This project was built with AI assistance (Anthropic's Claude, via Claude Code) for architecture, code,
> tests, analysis and documentation. I reviewed it, ran it, and verified results independently (see "How it was verified").

## Headline results (decisions made in January 2026, 09:00 UK cutoff, 744 hourly pairs)
| Metric (forecast − actual) | vs FUELHH wind (assignment's actuals) | vs B1630 wind (cross-check) |
|---|---|---|
| MAE / RMSE | 2,022 / 2,497 MW | 1,325 / 1,711 MW |
| MAPE | 21.9 % | 12.5 % |
| Bias | **+1,746 MW** | **−420 MW** |
| P50 / P90 / P99 abs error | 1,655 / 4,154 / 6,139 MW | – / 2,869 / – MW |
| 80 % signed-error band (P10…P90) | −426 … +4,154 MW | – |

**Read the bias with care.** The +1.7 GW bias against FUELHH is mostly a *coverage gap in the actuals*: FUELHH wind reads
about 19 % (≈2.2 GW) below Elexon's other actual-wind series, B1630, while the two correlate at 0.99. It is not a timestamp
error (tested). Details, tests and Elexon's own wording: [docs/BIAS_FINDINGS.md](docs/BIAS_FINDINGS.md).

## Assumptions and limits
1. **Decision cutoff – an assumption, not a requirement.** The assignment does not give a cutoff. We use **09:00 UK time on
   D-1** as a working cutoff, configurable in the UI and with `DECISION_CUTOFF`. For reference, GB day-ahead auctions close at:
   * EPEX SPOT GB 60-minute day-ahead auction: **09:20 GMT** (moved from 11:00 GMT) – *EPEX SPOT "Trading at EPEX SPOT", July 2024,
     p. 5* (`epexspot.com/sites/default/files/2024-07/Trading brochure July 2024.pdf`; also stated on `epexspot.com/en/tradingproducts`).
     The same brochure lists a GB 30-minute day-ahead auction at 15:30 GMT.
   * Nord Pool N2EX day-ahead auction: **09:50 GMT / 10:50 CET**, results by 10:00 – *Nord Pool support, "About the N2EX Day Ahead
     Auction"* (`support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-n2ex-day-ahead-auction`).

   So there is **no single "GB day-ahead gate"** and I could not confirm which one a given utility uses, nor re-confirm the times
   for 2026 (the EPEX brochure is from July 2024). 09:00 deliberately precedes both. Sensitivity (FUELHH actuals): the 09:00 and
   09:20 cutoffs both select the 07:30 UTC vintage (MAE 2,022 MW); 09:50 selects the 09:30 vintage (MAE 1,996 MW);
   12:00 gives MAE 1,884 MW. Table: `docs/bias_analysis_results.md`.
2. **Scope window: delivery days 2 Jan – 1 Feb 2026.** A decision for delivery day D is made on D-1, so "decisions made in
   January 2026" are D-1 = 1…31 Jan, i.e. delivery days 2 Jan … 1 Feb (31 days, 744 hourly targets). The window is the config values
   `DATA_FIRST_DAY` / `DATA_LAST_DAY`. Forecast vintages are downloaded from 29 Dec so the first day has vintages before its cutoff.
   Dates outside the window are rejected by the API (HTTP 422).
3. **Hourly-only alignment, no interpolation.** WINDFOR is hourly (only `:00` start times) and FUELHH is half-hourly. Metrics join
   on exact UTC `startTime`, so only the `:00` half-hours are scored. No values are interpolated because that would invent
   forecasts the buyer never saw and make errors look smaller than they are. The `:30` actuals appear only in the Decision chart.
4. **Selection rule.** For each target hour the newest vintage with `publishTime <= cutoff` is used (inclusive). Targets with no such
   vintage are dropped, never back-filled with later forecasts. With the 09:00 cutoff the vintage is always the 07:30 UTC one
   (horizon 16.5–39.5 h).
5. **Timezone.** Everything is stored and joined in UTC. The cutoff and "delivery day" are UK local time converted with
   `zoneinfo`, so BST/GMT are handled (unit-tested). January is GMT, so UTC = UK time here.
6. **Safety band is in-sample by default.** The band is the central 80 % of the signed error over the whole window, so it is
   slightly optimistic. The "days known by cutoff" option uses only days ≤ D-2 (no look-ahead; empty for 2 Jan).
7. **The bias finding** (above): the forecast looks +1.7 GW high against FUELHH but −0.4 GW low against B1630. The "cover margin"
   in the Decision view inherits whichever actuals series is used. Which one matches the buyer's exposure is a business question.
8. **One month is a small sample.** Percentiles such as P99 rest on a handful of points; nothing here is a trading recommendation.
9. **Units.** The BMRS specification states FUELHH values are "average MW values over 30 minutes"; it does not state WINDFOR's
   unit. We treat both as MW (magnitudes agree).

## Next steps (not built)
* **Live ingestion**: scheduled fetch of new WINDFOR/FUELHH data instead of a frozen snapshot.
* **Longer history for backtesting**: multiple months and seasons to validate the band out of sample and by horizon/hour.
* **Monitoring of forecast bias**: track the rolling bias and the FUELHH-vs-B1630 gap and alert when they drift.

## Run it
**Docker (local use and review):** `docker compose up --build` → http://localhost:8080 (API docs at http://localhost:8000/docs).
Docker is **not** how the Vercel deployment runs: Vercel runs the app natively (static React build + a Python serverless function).

**Local, without Docker** (Python 3.9+ and Node 20+):
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements-dev.txt
(cd backend && pytest)                               # tests
(cd backend && uvicorn app.main:app --reload)        # API  :8000
(cd frontend && npm install && npm run dev)          # UI   :5173 (proxies /api to :8000)
```
Optional: `(cd backend && python -m app.ingestion)` re-downloads data from BMRS into `backend/data/wind.db` (network needed).
Smoke-test any running instance: `scripts/smoke.sh http://localhost:8080`.

## Deploy to Vercel
```bash
npm i -g vercel
vercel login
vercel --prod                                   # from the repo root
scripts/smoke.sh https://<your-deployment>.vercel.app
```
`vercel.json` builds the frontend (`frontend/dist`), routes `/api/*` to `api/index.py` (the FastAPI app) and bundles `backend/**`
(including `wind.db`) into the function. SQLite is opened read-only/immutable so it works on a read-only filesystem. Python
dependencies measured at ≈171 MB unzipped for Python 3.12 (limit 250 MB; pandas is 91 MB of it).

## Repository layout
```
backend/app/config.py      settings: window, cutoff (assumption), timezone, DB path - all overridable by env
backend/app/db.py          SQLite schema; read-only/immutable loaders
backend/app/ingestion.py   BMRS fetch (chunked), cleaning, dedupe, idempotent upsert; fetch_plan(); no-network store()
backend/app/selection.py   cutoff logic (UK time/DST), latest-vintage selection, horizon, alignment
backend/app/metrics.py     error, MAE, RMSE, MAPE, bias, P50/P90/P99, error band, histogram
backend/app/service.py     builds the decision and accuracy payloads
backend/app/main.py        FastAPI routes + input validation (/api/health, /meta, /decision, /accuracy)
backend/data/wind.db       committed SQLite snapshot (app runs with no network)
backend/tests/             pytest: selection, metrics, ingestion cleaning, API + validation, window consistency
frontend/src/              React (Vite, Recharts): DecisionView, AccuracyView, Guide
api/index.py               Vercel serverless entrypoint wrapping the FastAPI app
vercel.json, requirements.txt   Vercel config; Python deps for the function
docker-compose.yml, */Dockerfile   local/review containers (nginx serves the UI and proxies /api)
scripts/smoke.sh           curl smoke test for a base URL
scripts/bias_analysis.py   reproducible bias / alignment / cross-check / cutoff-sensitivity analysis
docs/                      BIAS_FINDINGS.md, bias_analysis_results.md, VIDEO_SCRIPT.md, SUBMISSION_CHECKLIST.md
```

## API
`GET /api/meta` · `GET /api/decision?day&cutoff&coverage&band_basis` · `GET /api/accuracy?start&end&cutoff&basis&min_h&max_h&coverage` ·
`GET /api/health`. Invalid input returns HTTP 422 with a message: dates outside the window, `start > end`, `min_h > max_h`,
malformed dates/cutoffs, out-of-range coverage.

## Data handling
`FUELHH` (`/datasets/FUELHH/stream`, `fuelType=WIND`) and `WINDFOR` (`/datasets/WINDFOR/stream`) are fetched in small date
chunks (the stream endpoints return flat arrays but cap the window). Nulls are dropped, duplicates removed (forecast key =
startTime + publishTime; actual key = startTime, newest publish wins), non-WIND rows filtered, and writes are upserts, so
re-running ingestion is idempotent (all covered by offline tests). `ingest()` returns raw/clean/dropped row counts.

## How it was verified
Backend tests (`pytest`, 57 tests, no network); selection and metrics recomputed independently from freshly downloaded raw BMRS
data (three random targets and several cutoffs matched, including a publish time equal to the cutoff); the bias investigated in
`docs/BIAS_FINDINGS.md`; both views exercised in a browser at desktop/tablet/mobile widths; clean Docker build.
Not verified: the live Vercel deployment (not yet deployed).
