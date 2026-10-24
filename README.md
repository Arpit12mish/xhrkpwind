# GB Wind – Day-Ahead Decision Support

A web app for a UK day-ahead power-buying team. It answers two questions for every delivery day:
**what was the latest national wind forecast you could have seen when you had to decide**, and
**how much extra should you keep in reserve, given how wrong that forecast has been before**.
Data: Elexon BMRS only, national level: `WINDFOR` forecasts and `FUELHH` (fuelType `WIND`) actuals.

**Live app:** https://xhrkpwind.vercel.app/#decision  ·  **Video:** `<ADD UNLISTED YOUTUBE URL HERE>`

> **AI disclosure:** This project was built with AI assistance (Anthropic's Claude, via Claude Code) for architecture, code,
> tests, analysis and documentation. I reviewed it, ran it, and verified the results independently (see "How it was verified").

**Contents:** [The app](#the-app) · [Headline results](#headline-results) · [Features and what they showed](#features-and-what-they-showed) ·
[Assumptions and limits](#assumptions-and-limits) · [Run it](#run-it) · [Deploy to Vercel](#deploy-to-vercel) · [Performance](#performance) ·
[Repository layout](#repository-layout) · [API](#api) · [Data handling](#data-handling) · [How it was verified](#how-it-was-verified) · [Next steps](#next-steps-not-built)

## The app
Written for a buyer who is not a statistician: plain words, numbers written out in full, and the "what should I do" answer first.

| Page | What it answers |
|---|---|
| **Plan tomorrow** (`/#decision`) | Pick a delivery day and how costly running short is for you. The main answer is **"Keep about X MW in reserve"** (3,051 MW for 15 Jan with the defaults), with a weak-wind / expected / strong-wind gauge and an hour-by-hour chart. Below it: how wrong the forecast can be, a "what if wind is lower" scenario, power to buy beyond wind (if you type a demand), the margin by wind level, ramp hours, forecast changes before the deadline, a fair check of the margin on past days, a replay of the whole month, the backup trade-off, and "What this cannot tell you". |
| **Forecast accuracy** (`/#accuracy`) | "Typically off by 2,022 MW": typical, bad-hour and worst-case misses, whether the forecast leans high or low, a comparison with a simple guess, six charts (closer to the time, hours of the day, size of misses, forecast vs reality, over time, day by day), what waiting longer buys, weekdays vs weekends, and whether a recent miss carries over. |
| **Help** (`/#guide`) | "How the app works in 5 steps", then a searchable glossary of 36 terms in four groups, each with its own link (`/#guide/<term>`), a plain definition and a worked example with real January figures. |

* **Defaults:** decide by 09:00 UK time the day before; a shortfall costs 3 times a surplus (covers about 75% of hours); one margin for every hour; the margin is learned only from days already known at the deadline. "Margin by wind level" and "Every day in the data" stay selectable under Advanced settings.
* **Explained everywhere:** every term has an info button (hover, tap, or Enter) with a one-line definition and a link to its Help entry. Status pills such as "Only days already known", "Uses the day being planned", "Information only", "Small sample" and "No clear link" explain themselves the same way.
* **Honest about small samples:** any group with fewer than 30 hours (or 30 days, for day-level comparisons) says "too few to tell" and points to the overall figure. Every margin and shortfall carries the reminder that the FUELHH record reads about 19% low.
* **Design:** one visual system (8 px spacing, one card radius, one type scale, max width 1,100 px), light and dark themes, a small inline Lucide-style icon set (no icon library). Chart lines differ by dash pattern as well as colour, and hover text reads in words ("the forecast was 1,307 MW too high"). Layout is fluid from 320 px phones to wide desktops; nothing is cut off with an ellipsis.
* **Accessibility:** axe-core reports no WCAG 2.2 AA violations on any page in light or dark mode; keyboard path checked; touch targets at least 44 px; animations switch off for users who prefer reduced motion.
* **URLs:** `/#decision` is the single home URL. A bare `/` or an unknown hash rewrites to it, and back and forward move between pages.

## Headline results
Decisions made in January 2026, 09:00 UK cutoff, 744 hourly pairs.

| Metric (forecast − actual) | vs FUELHH wind (the assignment's actuals) | vs B1630 wind (cross-check) |
|---|---|---|
| Typical miss (MAE) / RMSE | 2,022 / 2,497 MW | 1,325 / 1,711 MW |
| Miss as a share of wind (MAPE) | 21.9% | 12.5% |
| Leans high or low (bias) | **+1,746 MW** | **−420 MW** |
| Median / bad-hour (P90) / worst-case (P99) miss | 1,655 / 4,154 / 6,139 MW | – / 2,869 / – MW |
| Usual range of misses (P10 to P90) | −426 to +4,154 MW | – |
| Better than "same hour two days earlier"? | **Yes, typical miss 54% smaller** (1,988 vs 4,360 MW, 720 hours) | – |

**Read the bias with care.** The +1.7 GW bias against FUELHH is mostly a coverage gap in the actuals: FUELHH wind reads about
19% (≈2.2 GW) below Elexon's other actual-wind series (B1630), while the two correlate at 0.99. It is not a timestamp error (tested).
Details, tests and Elexon's own wording: [docs/BIAS_FINDINGS.md](docs/BIAS_FINDINGS.md).

## Features and what they showed
Each line says what the feature does and what January showed, including where the answer was "no clear effect" or "too few to tell".
Every figure for a delivery day D uses only what was known at the D-1 cutoff unless stated otherwise, and tests prove it by corrupting
later data. Code: `backend/app/planning.py` (pure functions) wired in `service.py`; the maths is in [docs/DESIGN.md](docs/DESIGN.md).

### Plan tomorrow
| Feature | What it does | What it showed in January |
|---|---|---|
| **Reserve and cost setting** | Reserve = the q-quantile of past misses, q = ratio ÷ (ratio + 1); a shortfall costs `ratio` times a surplus (1 to 10; Even 1, Usual 3, Careful 9). Learned from days ≤ D-2 by default. | 15 Jan: 1,403 / 3,051 / 4,594 MW for ratios 1 / 3 / 9. 2 to 4 Jan have fewer than 30 known hours, so no reserve is shown; the page offers a one-click switch to every day in the data, labelled as using the day being planned. |
| **How wrong can the forecast be?** | Share of known hours in which wind ended more than 500 / 1,000 / 2,000 / 3,000 / 4,000 MW below the forecast, and above it, overall and by low / medium / high forecast, with hours and days per row. | 15 Jan (288 known hours, 12 days): more than 2,000 MW below in 39 of 100 hours overall; 21 (low), 13 (medium, that day's level), 84 (high). High-wind forecasts partly reflect the FUELHH record gap growing with wind. |
| **What if wind is lower than forecast?** | A what-if, not a prediction: wind 10%, 20% or 30% below the forecast, or by the bad-hour miss from known days. Shows the shortfall, what the reserve covers, what is left to buy at the last minute, and the extra buy need if a demand is typed. | 15 Jan, Usual reserve: 20% less wind leaves 160 MWh to buy (2 hours); 30% less leaves 13,674 MWh (14 hours); a bad hour (4,594 MW below all day) leaves 37,033 MWh. |
| **Power to buy beyond wind** | Your typed demand (one flat number; **your own number, the app has no demand data**) minus forecast wind, hour by hour, with and without the reserve. | Arithmetic only; matches an independent recompute. |
| **Margin by wind level** (option) | Separate margins for low / medium / high forecasts (terciles of the known history); a level with fewer than 30 hours uses the one-margin value. | **No overall gain**, which is why it is not the default: 70% of hours covered vs 74% for one margin (ratio 3). It moves cover from calm hours to windy ones (high-wind hours 43% → 77%, medium 74% → 44%, low 95% → 79%). |
| **Ramp watch** | Ramp hour = a forecast change of at least R MW within 1 to 3 hours, read from one forecast version. R defaults to the 90th percentile of past changes; user-adjustable. Ramp hours are dotted on the chart. | Over January, ramp hours (≥ 1,760 MW) missed about 1.2× as much (75 hours). For 15 Jan with known days only, 29 past ramp hours: too few to tell. Size only, no timing claim. |
| **Forecast changes before the deadline** | The versions of the day's forecast published in the 24 hours before the cutoff (only the day-before versions cover the whole day) and how much the day average moved. | **No clear link** between the size of changes and the size of the miss (r = −0.34, chance about 6 in 100, 31 days). Shown as information only. |
| **Did the margin work on past days?** | Walk-forward check: each day's margin learned from days ≤ D-2, then scored on that day. Aim vs achieved, overall, by day and by wind level. | Default one margin: 74% achieved vs 75% aimed (672 hours, 28 days); 88% vs 90% at ratio 9. |
| **If you had followed this plan** | Replays every day with the reserve it would really have had: short = max(0, forecast − actual − reserve), unused = max(0, reserve − that need), in MWh. Days without a known reserve say so, not zero. Optional £/MWh prices (**your own numbers, the app has no price data**) give a cost. | Default: 275,138 MWh short and 840,862 MWh of reserve unused over 28 days; 74% of hours covered (identical to the margin check). |
| **How much backup is worth it?** | The replay for cost settings 1, 2, 3, 5 and 9 (plus the current one): hours covered against unused reserve and remaining shortfall. No recommendation. | From 1× to 9×: hours covered 46% → 88%, unused reserve 455 → 2,350 MW per hour, remaining shortfall 863 → 174 MW per hour. A smooth trade-off with no obvious sweet spot. |

### Forecast accuracy
| Feature | What it does | What it showed in January |
|---|---|---|
| **Simple-guess comparison** | Forecast vs "same UK clock hour two days earlier" (known at the cutoff), and vs "same hour yesterday" (shown but marked unfair: not known at the cutoff). Same hours for both; clock changes handled. | Typical miss 54% smaller than the fair guess; 51% smaller than the unfair one. |
| **What does waiting buy?** | Decide-by times from 06:00 to 12:00: forecast version used, hours ahead, typical and bad-hour miss. | 09:00 → 12:00 cuts the typical miss by 7% (2,022 → 1,884 MW); 06:00 is no worse than 09:00. The auctions close at about 09:20 and 09:50, so waiting only helps if your market closes later. |
| **Weekdays and weekends** | Typical miss, bias and bad-hour miss for each, with days and hours, and a day-level test. | 2,062 vs 1,940 MW; only 21 and 10 days, so **too few days to tell** (the gap turns up by chance about 81 times in 100). |
| **Does a recent miss carry over?** | Whether one day's average miss predicts later days', and a pre-registered test of subtracting the last 3 known days' average miss. | **No clear carry-over** (two-day link −0.30, chance about 12 in 100). The adjustment lowers the miss against FUELHH (2,042 → 1,763 MW) only by removing the record gap; against B1630 it makes it worse (1,373 → 2,518 MW). So **no adjusted forecast is offered**. |
| **Small samples in charts** | Hour-of-day and horizon bars resting on fewer than 30 hours are faded, named in a note and explained in the legend. | Day-by-day bars rest on 24 hours each and are marked "Small sample". |

## Assumptions and limits
1. **Decision cutoff is an assumption.** The assignment gives none. We use **09:00 UK time on D-1**, changeable in the app and with
   `DECISION_CUTOFF`. GB day-ahead auctions close at about **09:20** (EPEX SPOT GB 60-minute auction; *EPEX SPOT, "Trading at EPEX SPOT",
   July 2024, p. 5*) and **09:50** (Nord Pool N2EX; *Nord Pool support, "About the N2EX Day Ahead Auction"*). There is no single GB gate,
   and the times could not be re-confirmed for 2026. 09:00 and 09:20 both use the 07:30 UTC forecast (typical miss 2,022 MW); 09:50 uses
   the 09:30 one (1,996 MW). Table: `docs/bias_analysis_results.md`.
2. **Scope: decisions made in January 2026,** so delivery days 2 January to 1 February (31 days, 744 hourly targets). Set by
   `DATA_FIRST_DAY` / `DATA_LAST_DAY`. Forecasts are downloaded from 29 December so the first day has versions before its cutoff.
   Dates outside the window get HTTP 422.
3. **Hourly-only alignment, no interpolation.** WINDFOR is hourly and FUELHH half-hourly; only exact `:00` matches are scored.
   Interpolating would invent forecasts the buyer never saw. The `:30` actuals appear only on the day chart.
4. **Selection rule.** For each hour, the newest forecast version with `publishTime ≤ cutoff`. Hours with none are dropped, never
   back-filled with later forecasts. At 09:00 this is always the 07:30 UTC version (16.5 to 39.5 hours ahead).
5. **Timezone.** Stored and joined in UTC; the cutoff and "delivery day" are UK local time via `zoneinfo`, so clock changes are handled
   (tested). January is GMT, so UTC = UK time here.
6. **No look-ahead by default.** Margins, bands and every "what if" figure learn only from days ≤ D-2, whose results were complete at the
   D-1 deadline. "Every day in the data" is available but in-sample and labelled as using the day being planned.
7. **The record gap.** The forecast looks 1.7 GW too high against FUELHH but 0.4 GW too low against B1630. Every reserve and shortfall
   inherits whichever record is used; which one matches the buyer's exposure is a business question.
8. **One month is a small sample.** Groups with fewer than 30 hours (or 30 days) are not quoted on their own; P99 rests on about
   seven hours. Nothing here is a trading recommendation.
9. **User-typed numbers are not data.** Demand and prices are the user's own figures; the app has no demand or price data.
10. **Units.** The BMRS specification states FUELHH values are "average MW values over 30 minutes"; it does not state WINDFOR's unit.
    Both are treated as MW (magnitudes agree). Energy is in MWh, one hour per hourly value.

## Run it
**Docker (local use and review):** `docker compose up --build` → http://localhost:8080/#decision (API docs at http://localhost:8000/docs).
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
dependencies measured at about 171 MB unzipped for Python 3.12 (limit 250 MB; pandas is 91 MB of it).

## Performance
The data is a frozen snapshot, so the responses for the **default** views never change. They are pre-computed to static JSON in
`frontend/public/precomputed/` (`meta`, `accuracy`, `margin_check`, `replay`, `tradeoff`, `recent_bias`, `cutoff_compare`, `baseline`,
and one `decision/<day>.json` per delivery day) and served from the CDN, so the first view needs **no Python function and no cold start**.
Anything non-default (another cutoff, cost setting, demand, filter) goes to the live API. The page also preloads its first JSON before the
JS runs, wakes the function in the background (`/api/warm`), uses edge-cache headers and gzip, and shows loading skeletons.
Measured with a simulated 3 s cold start: first numbers in about 0.2 s from static files, against about 3.4 s via the API.
After changing data or the API, regenerate and commit: `python scripts/export_precomputed.py` (a test fails if the static files differ
from the live API). Production bundle: about 192 KB of JavaScript and 5 KB of CSS, gzipped.

## Repository layout
```
backend/app/config.py      settings: window, cutoff (assumption), defaults, timezone, DB path - all overridable by env
backend/app/db.py          SQLite schema; read-only/immutable loaders
backend/app/ingestion.py   BMRS fetch (chunked), cleaning, dedupe, idempotent upsert; fetch_plan(); no-network store()
backend/app/selection.py   cutoff logic (UK time/DST), latest-version selection, horizon, alignment
backend/app/metrics.py     error, MAE, RMSE, MAPE, bias, percentiles, error band, histogram
backend/app/planning.py    planning maths: cost quantile, margins by level with n<30 fallback, net buy, walk-forward check,
                           ramps, stability, recent bias, baseline, exceedance, replay, what-if, trade-off
backend/app/service.py     builds every API payload
backend/app/main.py        FastAPI routes, input validation (422), cache headers
backend/data/wind.db       committed SQLite snapshot (the app runs with no network)
backend/tests/             pytest (171 tests, no network): selection, metrics, ingestion, API and validation, window, planning,
                           tier2, tier3, when_wrong, whatif_tradeoff, precomputed files
frontend/src/              React (Vite, Recharts)
  App.jsx                  tabs, hash routing (#decision, #accuracy, #guide/<term>), footer
  DecisionView.jsx         Plan tomorrow page
  AccuracyView.jsx         Forecast accuracy page
  Guide.jsx, glossary.js   Help page; every term defined once (also used by the info buttons)
  PlanPanels.jsx, Tier2Panels.jsx, Tier3Panels.jsx, WhenWrong.jsx   the section panels
  components.jsx           Card, Panel, Chart, CountUp, RangeBar, Callout, InfoTip, Pill, ErrorBox, Skeleton
  chartParts.jsx, icons.jsx, format.js, api.js, styles.css
frontend/public/precomputed/  static JSON for the default views (generated; see Performance)
frontend/index.html        page shell: favicon, early preload of the first data file
api/index.py               Vercel serverless entry point wrapping the FastAPI app
vercel.json, requirements.txt   Vercel config; Python dependencies for the function
docker-compose.yml, */Dockerfile   local/review containers (nginx serves the UI and proxies /api)
scripts/smoke.sh           curl smoke test for a base URL (pages, API, static data, 422 cases)
scripts/export_precomputed.py  regenerates the pre-computed static JSON from the API
scripts/verify_tier1.py    independent recompute (raw SQLite + pandas, not the app's code) of 23 figures, compared with the API
scripts/bias_analysis.py   reproducible bias / alignment / B1630 cross-check / cutoff-sensitivity analysis
docs/                      DESIGN.md, BIAS_FINDINGS.md, bias_analysis_results.md, VIDEO_SCRIPT.md, SUBMISSION_CHECKLIST.md
```

## API
All `GET`, all under `/api`. Defaults match the app's defaults.

| Route | Parameters |
|---|---|
| `/meta` | – |
| `/decision` | `day` (required), `cutoff`, `coverage`, `band_basis` (`prior` default, `all`), `cost_ratio` (1–10), `margin_by` (`flat` default, `level`), `demand` (MW, user input), `ramp_mw` |
| `/margin-check` | `cutoff`, `cost_ratio`, `margin_by` |
| `/replay` | `cutoff`, `cost_ratio`, `margin_by`, `price_short` and `price_unused` (£/MWh, user input, both or neither) |
| `/tradeoff` | `cutoff`, `margin_by`, `cost_ratio` |
| `/accuracy` | `start`, `end`, `cutoff`, `basis`, `min_h`, `max_h`, `coverage` |
| `/baseline` | `start`, `end`, `cutoff` |
| `/cutoff-compare`, `/recent-bias` (`cutoff`) | – |
| `/health`, `/warm` | – (`/warm` wakes a cold instance) |

Invalid input returns HTTP 422 with a message: dates outside the window, `start > end`, `min_h > max_h`, malformed dates or cutoffs,
coverage outside 0.5–0.99, cost ratio outside 1–10, unknown margin method or basis, demand outside 0–100,000 MW, ramp size outside
100–20,000 MW, prices outside 0–10,000 £/MWh, or only one price given.

## Data handling
`FUELHH` (`/datasets/FUELHH/stream`, `fuelType=WIND`) and `WINDFOR` (`/datasets/WINDFOR/stream`) are fetched in small date chunks (the
stream endpoints return flat arrays but cap the window). Nulls are dropped, duplicates removed (forecast key = startTime + publishTime;
actual key = startTime, newest publish wins), non-WIND rows filtered, and writes are upserts, so re-running ingestion is idempotent (all
covered by offline tests). `ingest()` returns raw, clean and dropped row counts.

## How it was verified
* **Tests:** `pytest`, 171 tests, no network. Every planning feature has a no-look-ahead test: actuals from D-1 onward are corrupted and
  the day-D figures must not change (and corrupting D-2 must change them, so the test can fail).
* **Independent recompute:** `scripts/verify_tier1.py` rebuilds 23 figures from the raw SQLite file with its own pandas code; all match
  the API. Selection and metrics were also recomputed from freshly downloaded raw BMRS data (three random hours and several cutoffs,
  including a publish time equal to the cutoff).
* **No silent changes:** API responses for three sample days and every window-wide endpoint were saved before UI work and diffed after;
  every existing number is unchanged.
* **Builds:** clean `docker compose up --build` with `scripts/smoke.sh` passing against it; production build checked.
* **Browser:** all three pages in Chrome at 1440, 768 and 390 px, light and dark, with no console errors. A layout audit at 320, 360,
  390, 768, 1024 and 1440 px finds no horizontal overflow, clipped text (including chart labels and closed dropdowns) or ellipsis.
  axe-core finds no WCAG 2.2 AA violations; the keyboard path and touch targets were checked.
* **Bias:** investigated in [docs/BIAS_FINDINGS.md](docs/BIAS_FINDINGS.md) (timestamp shifts, level tests, B1630 cross-check).
* **Not verified:** the current build on the live site. Run `scripts/smoke.sh https://xhrkpwind.vercel.app` after each deploy.

## Next steps (not built)
* **Live ingestion:** scheduled fetch of new WINDFOR and FUELHH data instead of a frozen snapshot.
* **Longer history for backtesting:** several months and seasons, to check the reserve and the wind-level split out of sample.
* **Monitoring:** track the rolling bias and the FUELHH vs B1630 gap, and alert when they drift.
* **Real costs:** with price data, turn MWh short and unused into money without relying on typed prices.
