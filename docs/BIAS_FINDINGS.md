# Is the +1.7 GW forecast bias real?

**Conclusion.** The bias is *arithmetically real* (against FUELHH wind the decision-time WINDFOR forecast is on average
**+1,746 MW** above actual, 744 hourly pairs, delivery days 2 Jan – 1 Feb 2026) but it is **not mainly forecast error**.
It is overwhelmingly a **coverage gap in the actuals series**: FUELHH WIND reads about 19 % (≈2.2 GW) lower than
Elexon's other official actual-wind series (B1630/AGWS). Against AGWS the same forecast has a bias of **−420 MW** and
an MAE of **1,325 MW** (12.5 % MAPE) instead of 2,022 MW (21.9 %). It is **not** a timestamp-alignment bug.

The app keeps FUELHH as its actuals because that is what the assignment specifies. It does not hide the finding: the
Accuracy and Guide pages say so, and this note and the README carry the evidence. All numbers below are
reproducible with `python scripts/bias_analysis.py` (raw tables: `docs/bias_analysis_results.md`).

## a) Timestamp shift test
Actual used for target *t* = actual at *t* + shift (decision-time forecasts, hourly targets, n = 744 each).

| shift | FUELHH bias | FUELHH MAE | AGWS bias | AGWS MAE |
|---|---|---|---|---|
| −120 min | 1,717 | 1,966 | −455 | 1,395 |
| −90 min | 1,722 | 1,961 | −451 | 1,366 |
| −60 min | 1,732 | 1,970 | −437 | 1,325 |
| −30 min | 1,736 | 1,990 | −433 | 1,325 |
| **0 min (app)** | **1,746** | **2,022** | **−420** | **1,324** |
| +30 min | 1,750 | 2,061 | −416 | 1,344 |
| +60 min | 1,759 | 2,098 | −403 | 1,383 |
| +120 min | 1,772 | 2,184 | −387 | 1,495 |

* **Bias barely moves** (1,717–1,772 MW across ±2 h): a misalignment cannot create or remove it.
* Against AGWS, MAE is flat from −60 to 0 min and rises on both sides, so zero shift is right.
* Against FUELHH, MAE is lowest at −90 min (1,961 vs 2,022, **3 % lower**). That is not a "clearly lower" MAE and does not
  change the bias, so no code change was made. A possible small lag in FUELHH is noted but unexplained.
* Hourly-average definitions of the actual (mean of t and t+30, or t−30 and t) give bias 1,748 / 1,741 and MAE 2,039 / 2,004,
  i.e. the same picture.

## b) Level test
Mean forecast 13,031 MW; mean FUELHH actual 11,286 MW; difference 1,746 MW; ratio 1.155. 27 of 31 days have a positive mean error.

| hours (UK = UTC in Jan) | bias (MW) | forecast/actual |
|---|---|---|
| 00–03 | 2,125 | 1.19 |
| 04–07 | 2,283 | 1.21 |
| 08–11 | 1,787 | 1.16 |
| 12–15 | 1,332 | 1.12 |
| 16–19 | 1,379 | 1.12 |
| 20–23 | 1,570 | 1.13 |

| wind level (actual quintile) | mean actual | bias | forecast/actual |
|---|---|---|---|
| Q1 low | 5,128 | 1,818 | 1.35 |
| Q2 | 8,554 | 1,058 | 1.12 |
| Q3 | 11,595 | 1,066 | 1.09 |
| Q4 | 14,688 | 2,708 | 1.18 |
| Q5 high | 16,464 | 2,075 | 1.13 |

The offset is **neither a clean constant nor a clean proportion** (ratio 1.09–1.35, strongest overnight and at low wind).
OLS gives forecast = 931 + 1.072 × actual with correlation 0.93: the forecast tracks the shape well but sits above FUELHH
by a roughly +1–2.7 GW level shift. That pattern is what a *definitional gap plus noise* looks like, not a random error.

## c) What the Elexon documentation says
Source: the BMRS Insights API specification, `https://data.elexon.co.uk/swagger/v1/swagger.json` (read 23 Oct 2026).
The field schemas carry **no descriptions or units**; the dataset text is quoted below.

* **FUELHH** – "provides the half-hourly generation outturn (Generation By Fuel type) to give our users an indication of
  the generation outturn for Great Britain. The data is aggregated by Fuel Type category and updated at 30-minute intervals
  with average MW values over 30 minutes for each category."
* **WINDFOR** – the stream endpoint says only "provides wind generation forecast data. Specific publish time filters may be
  supplied, otherwise this will retrieve the latest published forecast." The sibling endpoint `/forecast/generation/wind`
  says: "This provides wind generation forecast for wind farms which are visible to the ESO and have operational metering.
  Updated data is published by NGESO up to 8 times a day at 03:30, 05:30, 08:30, 10:30, 12:30, 16:30, 19:30 and 23:30."
* **B1630 / AGWS** – "provides actual or estimated wind and solar power generation per settlement period. It returns
  generation with Power System Resource type Solar, Wind Onshore or Wind Offshore."

What this does and does not tell us:
* The **unit of WINDFOR `generation` is not stated** in the specification; we treat it as MW (magnitudes agree with FUELHH,
  which is stated to be MW).
* **What "wind" covers in FUELHH is not defined** in the API text. Elexon's glossary page for FUELHH could not be fetched
  (HTTP 403); a secondary summary describes it as generation connected to the high-voltage transmission system, which
  would be narrower than "actual or estimated" total wind in AGWS. **We did not verify this**, so it is a hypothesis.
* The documented WINDFOR publish times are exactly one hour later than the `publishTime` values in the data
  (02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30, 22:30 UTC). We rely on the data (UTC `Z` timestamps); the
  documented times look like CET.

## d) Cross-check with B1630/AGWS (onshore + offshore), n = 744

| actuals used | mean actual | bias | MAE | RMSE | MAPE | P90 abs |
|---|---|---|---|---|---|---|
| FUELHH WIND (assignment) | 11,286 | +1,746 | 2,022 | 2,497 | 21.9 % | 4,154 |
| B1630/AGWS wind | 13,451 | −420 | 1,325 | 1,711 | 12.5 % | 2,869 |

AGWS minus FUELHH: mean 2,166 MW (ratio 1.19), correlation 0.993, and 2,076–2,273 MW in every 4-hour block of the day.
Two actuals series that move together (r = 0.99) but differ by a near-constant ≈2.2 GW point to a **definition/coverage
difference between the series**, not a timing or forecast problem.

## What this means for a buyer
* Do **not** read "+1.7 GW bias" as "the forecast is 1.7 GW too optimistic". Against total actual wind it is slightly
  *low* (−0.4 GW).
* The safety band and "cover margin" in the Decision view are computed from FUELHH errors, so they inherit the gap. If the
  position being hedged is measured like FUELHH, they are right; if it is total wind, they overstate the shortfall risk.
* Which actuals series matches the buyer's real exposure is a **business decision** (README, "Assumptions and limits", item 7).
* Caveats: one month; B1630 is "actual *or estimated*"; the cause of the gap is a hypothesis; we have not inspected
  unit-level data.
