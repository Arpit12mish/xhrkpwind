# Video script (≈10 min). Record screen + voice; keep the live URL open.
Numbers: decisions made in Jan 2026 (delivery 2 Jan – 1 Feb), 09:00 cutoff, FUELHH actuals, 744 hourly pairs.

## Part 1 – Customer pitch (≤ 5:00)
**0:00 – The problem (0:40)**
"Every morning you commit to buying power for tomorrow. Wind is the swing factor, and forecasts are never exactly right. Two questions: *what is the latest forecast I could trust at my deadline*, and *how wrong is it likely to be*? This tool answers both on one screen, from public Elexon data only."

**0:40 – Plan tomorrow (3:00)** *("Plan tomorrow" tab, 15 Jan)*
- "Pick the delivery day. The app uses the newest forecast published *before* your cutoff, here 09:00 yesterday: 'Forecast used: 14 Jan 07:30'. Nothing published later leaks in."
- "Blue is the forecast; the shaded band is where wind has landed 80 % of the time. The big answer says keep about 3,051 MW in reserve: learned only from days already known, and set because a shortfall costs about three times a surplus, so it covers about 3 hours in 4. Switch to Careful and it rises to about 4,594 MW: how far below forecast a bad-but-plausible day went. Type a demand of 25,000 MW: the page shows the power to buy beyond wind, with and without that cover. Demand is your own number; the app has no demand data. Scroll down: the margin check tests this on past days with no hindsight. It covered 74% of hours against an aim of 75%: close to the aim. Every term has an info button that explains it in a sentence."
- (+30 s) "How wrong can it be? When the forecast was as high as today's, wind ended more than 2,000 MW below it in about 13 hours out of 100. And if you had followed this plan all month: 74% of hours covered, 275,138 MWh short and 840,862 MWh of reserve unused. Type your own prices to see the cost; the app has no price data."
- (+10 s) "What if wind is 30% lower? About 13,700 MWh left to buy. And the trade-off chart shows the choice: more backup covers more hours but leaves more unused."
- "Tick "Show what actually happened": on 15 Jan wind came in about 1 GW under forecast and the band caught it."
- "Change the cutoff to 09:50 or 12:00 and the forecast and horizon update. The cutoff is an assumption you control."

**3:40 – Accuracy insights (0:55)** *("Forecast accuracy" tab)*
- "Typical miss is 2.0 GW (22 %); in a bad hour, the "Bad-hour miss", it is 4.2 GW. Plan for that."
- "The headline bias against this actuals series is +1.7 GW. I checked it before showing you: shifting timestamps does not change it, and against Elexon's other actual-wind series the same forecast is slightly *low* (−0.4 GW) with an MAE of 1.3 GW. So most of that bias is a data-definition gap, not a bad forecast. The decision for you is which series matches your exposure."
- "Is it better than a simple guess? Yes: its typical miss is 54% smaller than guessing the same hour two days ago."
- "What does waiting buy? Deciding at 12:00 instead of 09:00 cuts the typical miss by 7%, but the auctions close at about 09:20 and 09:50."
- "Fresher forecasts are better: typical miss 1.7 GW for forecasts under 3 h ahead versus 2.4 GW at two days. Worst hours are 03:00–05:00; worst days were 11–12 and 28 Jan."

**4:35 – Business value (0:25)**
"One number plus a defensible margin. Size the position to the lower edge of the band when imbalance is expensive, trim it when it is cheap. Every figure traces to a published forecast and an official actual, and the assumptions are visible and changeable."

## Part 2 – Tech-lead walkthrough (≤ 5:00)
**5:00 – Architecture & data flow (0:50)**
"BMRS → ingestion (chunked, cleaned, deduped, idempotent) → SQLite snapshot → pandas selection and metrics → FastAPI → React. The snapshot is committed so deploys need no network or secrets, and SQLite opens read-only/immutable so it works on a read-only serverless filesystem. Deliberately no queue, cache or database server: one month of data does not need them. Because the data is frozen, the default views are pre-computed static JSON from the CDN, so there is no serverless cold start on first load."

**5:50 – Analysis method (1:40)**
- Selection: newest `publishTime <= cutoff`, cutoff built in UK local time and converted to UTC (DST tested). No back-fill. A band option that uses only days ≤ D-2 removes look-ahead; say that out loud.
- Alignment: exact UTC join. WINDFOR is hourly, FUELHH half-hourly; I score only `:00` periods and do not interpolate, because that would invent forecasts.
- Scope: a decision for day D is made on D-1, so January decisions are delivery days 2 Jan – 1 Feb; a test fails if config, delivery-day logic and the data disagree.
- Bias validation: shift test (bias flat, within 2 %), level test, cross-check with B1630 (bias −0.4 GW); documented in `docs/BIAS_FINDINGS.md`, reproducible via `scripts/bias_analysis.py`.
- Cutoff: assumption; EPEX GB auction 09:20 and N2EX 09:50 cited; sensitivity table in docs.
- Negative results are shown, not hidden: forecast revisions did not predict bigger misses (r −0.34, p 0.06), and the recent-bias correction only helps because it learns FUELHH's lower level, so it is a comparison line, off by default.
- Planning tools (`planning.py`): margin = q-quantile of past errors with q = ratio/(ratio+1); one function decides which history a day may use, and a test corrupts everything from D-1 on to prove nothing leaks. The fair walk-forward check showed the wind-level split gives no overall gain, and the page says so.

**7:30 – Code structure & choices (0:50)**
Walk `selection.py`, `metrics.py`, `service.py`, `main.py`. Pure functions on DataFrames, thin routes, config via env, validation returns 422 with clear messages.

**8:20 – Testing & practice (1:00)**
Run `pytest`: 171 tests, no network: cutoff edge cases (equal to cutoff included), BST/GMT, hand-computed metrics, ingestion cleaning (nulls, duplicates, non-WIND, idempotent re-run), API validation, window consistency. `scripts/smoke.sh` for a deployed URL. Docker for local review; Vercel runs the app natively. AI-assisted development with independent verification against raw API data.

**9:20 – Limits & next steps (0:40)**
One month; in-sample band default; cutoff is an assumption; the actuals-series choice matters. Next: live ingestion, longer history for backtesting, bias monitoring. Thank you.
