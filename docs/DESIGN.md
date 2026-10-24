# Design

## Architecture
```
Elexon BMRS ──► ingestion.py ──► SQLite snapshot (backend/data/wind.db, committed, opened read-only/immutable)
 WINDFOR        chunked fetch,        │
 FUELHH (WIND)  clean, dedupe, upsert ▼
                               db.py loaders (pandas, loaded once per process)
                                      │
            selection.py ─────────────┼──────────── metrics.py
   (D-1 cutoff in UK time, newest     │      (error = forecast − actual; MAE, RMSE,
    vintage ≤ cutoff, UTC join)       │       MAPE, bias, quantiles, histogram)
                                      ▼
                              planning.py (pure functions)
                 cost quantile · wind-level margins · net buy · walk-forward check
                                      │
                         service.py (builds payloads) ──► main.py (FastAPI, /api/*, 422 validation,
                                                                  edge-cache headers)
                                      │
             scripts/export_precomputed.py ──► frontend/public/precomputed/*.json (default views, CDN)
                                      │
                 React + Vite + Recharts: Plan tomorrow · Forecast accuracy · Help
```
Vercel serves the static build and runs `api/index.py` (the same FastAPI app) as a Python function. Docker is for
local review only. No queue, cache server or database server: one month of data does not need them.

## Data rules
* Only Elexon WINDFOR (forecasts) and FUELHH, fuelType WIND (actuals). The single exception is the demand figure on the
  Plan page, which is **user input, not data**, and is labelled that way.
* Decision for delivery day D is made at the cutoff (default 09:00 UK) on D-1, using the newest WINDFOR vintage with
  `publishTime ≤ cutoff`. Window: delivery days 2 Jan – 1 Feb 2026 (decisions made in January).
* WINDFOR is hourly and FUELHH half-hourly: only exact `:00` matches are scored; nothing is interpolated.
* FUELHH wind reads about 19% below Elexon's B1630 wind series (see BIAS_FINDINGS.md). Every margin and bias shown
  carries that reminder.

## No look-ahead
`planning.history_for(eval_frame, day, band_basis, first, last)` is the only place that decides which past hours a
decision for day D may learn from:

| `band_basis` | History used for day D | Note |
|---|---|---|
| `prior` (default) | days ≤ D-2 | their actuals were complete before the D-1 cutoff; labelled "Only days already known" |
| `all` | every window day | in-sample, slightly optimistic; labelled "Every day in the data (uses the day being planned)" |

Default margin method: one flat margin (`margin_by=flat`); the wind-level split is selectable. Both defaults live in
`config.py` (`DEFAULT_MARGIN_BY`, `DEFAULT_BAND_BASIS`) and are exposed by `/api/meta`.

The margin check always uses `prior`. Tests corrupt every actual from D-1 onwards (×10) and require all planning numbers
for D to be unchanged, and corrupt D-2 to show the test is not vacuous; another test inflates forecasts published after
the cutoff and requires no change.

## Planning maths (`backend/app/planning.py`)
Error e = forecast − actual (positive = wind came in short). A margin m means "plan for forecast − m"; an hour is
**covered** when actual ≥ forecast − m, i.e. e ≤ m.

**Cost-aware margin.** If a shortfall costs `r` times a surplus (surplus cost 1), the expected cost of planning for wind w
is minimised where P(actual < w) = 1 / (r + 1) (the newsvendor result). With actual = forecast − e this gives
m = q-quantile of e with **q = r / (r + 1)**, and m covers about q of hours. r is limited to 1–10 (q 0.5 to 0.909);
default r = 3, q = 0.75. Presets: Even 1, Usual 3, Careful 9.

**Margin by wind level.** Cut points t1, t2 are the 1/3 and 2/3 quantiles of the forecasts *in the history the decision
may use*. Each history hour and each hour of day D is labelled low (≤ t1), mid (≤ t2) or high. Each level's margin is the
q-quantile of its own errors; a level with fewer than 30 hours uses the all-hours margin (flagged `fallback`). If the
whole history has fewer than 30 hours, no margin is quoted at all (`available: false`). The shaded "usual range" on the
chart uses the same groups (central 80% of errors).

**Power to buy beyond wind.** Per hour: net = demand − forecast, buy = max(0, net); with cover, the same against
plan = max(0, forecast − m). Day figures: average of the hourly values, and their sum in MWh (one hour per value).
Hours where wind alone exceeds demand are counted.

**Margin check (walk-forward).** For each window day D: learn the margin from days ≤ D-2, apply it to D, record covered
hours. Days with fewer than 30 known hours are skipped and listed. Reports achieved vs target overall, by day and by
wind level, plus the same check with the other margin method on the same hours.

## Tier 2 maths
**Ramp watch.** For an hour t forecast by version v, ramp size = max over k = 1..3 of |f_v(t) − f_v(t − k h)|, read from
version v only (a jump between two versions is not a ramp; NaN if v has none of the earlier hours). Default threshold R =
90th percentile of ramp sizes over the history the decision may use (so it respects `band_basis`); the user may set
100–20,000 MW. History error is summarised for ramp vs other hours (n, typical miss, 90th percentile); a ratio is quoted
only if both groups have n ≥ 30. No claim is made about timing (early/late) errors.

**Forecast stability.** Versions with publish time in (cutoff − 24 h, cutoff] that contain every hour of day D; WINDFOR
versions from D-2 end at 21:00 D-1, so in practice the three D-1 versions (02:30, 04:30, 07:30 UTC before 09:00).
Revision = last − first day average. Backtest over the history days: |revision| vs that day's MAE, Pearson r with a
two-sided permutation p-value (2,000 shuffles, fixed seed). Fewer than 30 days: no conclusion is drawn.

**Recent bias.** Daily mean error e_d. Lag tests: r(e_d, e_{d−1}) and r(e_d, e_{d−2}); only lag 2 is usable at the D-1
cutoff. Correction for day D: c = mean of e over the last 3 days ≤ D-2 (primary rule, fixed before looking); "every known
day" is reported for comparison only. Walk-forward MAE with and without c; `lowers_mae` reports the result. No adjusted forecast is
offered in the app (the gain is only the FUELHH level gap), so the Plan page has no correction code path.

**Cutoff comparison.** The decision-time selection is re-run for 06:00, 07:00 … 12:00 over the same window; each row
reports the versions used, hours ahead, MAE and 90th-percentile absolute error.

## Tier 3
**Simple-guess baseline.** guess_k(t) = recorded wind at the same UK wall-clock time k calendar days earlier (wall time
minus k days, re-localised; non-existent or repeated clock-change times get no guess). k = 2 is the latest full day known at
the D-1 cutoff; k = 1 is shown but flagged as not known at the cutoff. Forecast and both guesses are scored on the same
hours; skill = 1 − MAE_forecast / MAE_guess (also reported for RMSE).

**Weekday / weekend.** UK delivery day's weekday. Per group: days, hours, MAE, bias, 90th-percentile absolute error. Day-level
permutation test on daily MAE vs a weekend indicator. "Enough" requires ≥ 30 days per group (hours inside a day are not
independent).

**Small samples elsewhere.** Hour-of-day and horizon bars with n < 30 are faded, named in a note, and the overall typical
miss is offered instead; tooltips state n.

## When the forecast is wrong
**How wrong can the forecast be?** For day D, from the known hours (days ≤ D-2, regardless of `band_basis`): for each step
s in 500, 1,000, 2,000, 3,000, 4,000 MW, share of hours with error > s (wind ended more than s below the forecast) and
error < −s (above it), overall and per forecast tercile of those hours. A tercile with fewer than 30 hours is flagged
`too_few` and the page shows the all-hours shares. The day's level is the tercile of its mean forecast.

**Replay ("If you had followed this plan").** For each window day D: reserve = max(0, margin learned from days ≤ D-2),
needed = max(0, forecast − actual), short = max(0, needed − reserve), unused = max(0, reserve − needed), covered =
needed ≤ reserve; summed per day in MWh (one hour per hourly value). Days with fewer than 30 known hours are returned with
`margin_known: false` and no figures. Optional prices (both or neither, 0–10,000 £/MWh) give cost = short × price_short +
unused × price_unused. The covered share equals the margin check's achieved share by construction (tested).

**What if (scenario, not a prediction).** For day D: what-if wind = max(0, forecast × (1 − s)) for s = 10/20/30%, or
max(0, forecast − B) where B is the bad-hour miss (90th percentile of |error| over known hours, needs n ≥ 30). drop =
forecast − what-if wind; covered = min(drop, reserve); left = drop − covered. The reserve is always the one learned from
days ≤ D-2 with the current cost ratio and margin method. With a typed demand: extra = max(0, demand − what-if wind) −
max(0, demand − forecast). All four scenarios ship in the decision payload, so switching is instant.

**Backup trade-off.** `/api/tradeoff` runs the replay for ratios 1, 2, 3, 5, 9 and the current one; per setting it
reports the hour-weighted average reserve, covered share, and average unused reserve and remaining shortfall per hour.

## What the data showed (January 2026, 744 hours; 672 hours / 28 days in the margin check)
* Cost ratio: margins rise with the ratio as expected (15 Jan, defaults: 1,403 / 3,051 / 4,594 MW for r = 1 / 3 / 9).
* Margin check (default one margin): 74% vs 75% at r = 3 (average margin 2,704 MW); 88% vs 90% at r = 9. By wind level:
  70% and 86%.
* Wind-level split: no overall gain (70% vs 74% for one flat margin at r = 3, with a 6% smaller average margin). It
  redistributes cover: high-wind hours 43% → 77%, medium 74% → 44%, low 95% → 79%. One month is too little to say
  whether this pattern holds.
* Ramps: typical miss 1.2× larger in ramp hours (2,398 vs 1,980 MW; 75 vs 669 hours). Size only.
* Stability: no clear link between revision size and the day's miss (r = −0.34, p = 0.06, 31 days). Information only.
* Recent bias: no day-to-day persistence (lag 2 r = −0.30, p = 0.12). The 3-day correction lowers MAE against FUELHH
  (2,042 → 1,763 MW) only by removing the constant FUELHH level gap; against B1630 it raises MAE (1,373 → 2,518 MW).
* Cutoff: 09:00 → 12:00 lowers MAE by 7% (2,022 → 1,884 MW); 06:00 is no worse than 09:00.
* Baseline: forecast MAE 54% below the "two days earlier" guess (1,988 vs 4,360 MW, 720 hours).
* Weekday vs weekend: 2,062 vs 1,940 MW, p = 0.81; too few days (21 / 10) to conclude anything.
* How wrong (15 Jan, known days): wind ended more than 2,000 MW below the forecast in 39% of hours overall; 13% for
  medium-wind forecasts, 84% for high-wind forecasts (partly the record gap growing with wind).
* Replay (default reserve): 275,138 MWh short, 840,862 MWh unused, 74% of 672 hours covered over 28 days.
* What if (15 Jan, Usual): 20% less wind leaves 160 MWh to buy; 30% less leaves 13,674 MWh; a bad hour leaves 37,033 MWh.
* Trade-off: 1× → 9× moves covered hours 46% → 88% and unused reserve 455 → 2,350 MW per hour.
* All of the above is measured against FUELHH; against B1630 the margins would be smaller.

## Testing
`backend/tests/test_planning.py`: cost quantile and range errors, monotonic margins, quantile coverage, tercile cuts,
level margins and the n < 30 fallback, flat method, net-buy arithmetic (including zero demand and wind above demand), a
hand-built walk-forward example, no-look-ahead tests per feature, and 422 validation for every new parameter.
`backend/tests/test_tier2.py`: ramp sizes within one version, no cross-version ramps, threshold and n < 30 handling,
version coverage and cutoff, permutation test, hand-built correction backtest, lag test, toggle rule, cutoff table, no
look-ahead (actuals from D-1 corrupted, forecasts after the cutoff inflated) and 422 validation.
`backend/tests/test_tier3.py`: same-clock-hour guess across the March clock change (including a non-existent wall time),
skill maths with excluded hours and negative skill, no look-ahead for the fair guess (and proof the unfair one does look
ahead), endpoint validation, and the day-type counts and 30-day flag.
`scripts/verify_tier1.py` recomputes one number per tool from the raw SQLite file without the app's code.

## User interface
* Pages: Plan tomorrow (`#decision`), Forecast accuracy (`#accuracy`), Help (`#guide`, with `#guide/<term>` anchors).
* One visual system in `styles.css`: 8 px spacing scale, one card radius (12 px), one type scale, max width 1,100 px, light
  and dark themes. Icons are a small inline Lucide-style set (`icons.jsx`); no icon library is installed.
* Every term is defined once in `glossary.js`; info buttons show its short meaning and link to the Help entry.
* Accessibility: axe-core reports no WCAG 2.2 AA violations; tooltips are disclosure buttons (Enter / Space / tap);
  charts are labelled images whose meaning is also given in words; touch targets are at least 44 px; reduced motion is respected.
