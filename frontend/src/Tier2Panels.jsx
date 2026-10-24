import React from "react";
import { Callout, Panel, Pill } from "./components.jsx";
import { SeriesCaveat } from "./PlanPanels.jsx";
import { mw, num, pct0, r2, smw, stampUK } from "./format.js";

/** "about 6 times in 100" - plain wording for a permutation p-value. */
const chance = (p) => (p == null ? "" : p < 0.01 ? "less than 1 time in 100" : `about ${Math.round(p * 100)} times in 100`);
const clearLink = (t) => t && t.r != null && t.p != null && t.p < 0.05;

/** Feature 5: ramp hours on the chosen day and how big the miss was in past ramp hours. */
export function RampPanel({ ramps, rampInput, setRampInput, rampValid }) {
  const h = ramps.history;
  return (
    <Panel icon="activity" term="ramp" title="Ramp watch: hours when the forecast changes fast"
      headline={ramps.threshold == null ? "No ramp size yet: there are no earlier days to learn it from."
        : `${ramps.hours_today} ramp hour${ramps.hours_today === 1 ? "" : "s"} on this day (a change of at least ${mw(ramps.threshold)} within 3 hours).`}
      pills={h && !h.enough ? <Pill kind="small" text="Small sample" why={`Only ${h.ramp.n} past ramp hours are known; at least ${h.min_n} are needed before the app compares them with other hours.`} /> : null}
      sub="A ramp hour is one where the forecast rises or falls by at least the amount below within up to 3 hours."
      how="Dots on the day chart mark the ramp hours. The table compares how big the miss was in past ramp hours with all other past hours.">
      <div className="controls narrow">
        <label className="field">
          <span className="lbl">Count as a ramp from (MW)</span>
          <input type="text" inputMode="numeric" value={rampInput} placeholder={ramps.auto_threshold ? `automatic: ${num(ramps.auto_threshold)}` : "automatic"}
            onChange={(e) => setRampInput(e.target.value.replace(/[,\s]/g, ""))} aria-invalid={!rampValid} />
          {rampValid
            ? <small>Leave empty for the automatic value: a change only 1 hour in 10 reached in past results{ramps.auto_threshold ? ` (${mw(ramps.auto_threshold)})` : ""}.</small>
            : <small className="warn-text" role="alert">Enter a number of MW from 100 to 20,000.</small>}
        </label>
      </div>
      {ramps.threshold == null ? (
        <Callout title="No past results to set a ramp size yet">Type a ramp size above, or choose a later day.</Callout>
      ) : (
        <>
          <p className="lead">
            On this day, <b>{ramps.hours_today} hour{ramps.hours_today === 1 ? " is a ramp hour" : "s are ramp hours"}</b> (a change of at least {mw(ramps.threshold)}).
            {ramps.hours_today ? " They are marked with dots on the chart above." : ""}
          </p>
          {h && (
            <>
              <table className="rt">
                <thead><tr><th>Past hours</th><th>How many</th><th>Typical miss</th><th>Bad-hour miss</th></tr></thead>
                <tbody>
                  <tr><td data-label="Past hours"><b>Ramp hours</b></td><td data-label="How many">{num(h.ramp.n)}{h.ramp.n < h.min_n && <small className="warn-text">fewer than {h.min_n}</small>}</td>
                    <td data-label="Typical miss">{mw(h.ramp.typical_miss)}</td><td data-label="Bad-hour miss">{mw(h.ramp.bad_hour)}</td></tr>
                  <tr><td data-label="Past hours"><b>Other hours</b></td><td data-label="How many">{num(h.other.n)}</td>
                    <td data-label="Typical miss">{mw(h.other.typical_miss)}</td><td data-label="Bad-hour miss">{mw(h.other.bad_hour)}</td></tr>
                </tbody>
              </table>
              <p className="note top-gap">
                {h.enough
                  ? h.ratio >= 1.1
                    ? `In past results the forecast missed by about ${h.ratio.toFixed(1)} times as much in ramp hours. Ramp hours may deserve a little extra reserve.`
                    : h.ratio <= 0.9 ? "In past results the forecast missed by less in ramp hours." : "In past results the miss was about the same in ramp hours as in other hours."
                  : `Too few ramp hours in the past results (fewer than ${h.min_n}) to compare them fairly.`}
                {" "}This compares the size of the miss only; it does not show whether ramps arrive early or late. Ramp hours bunch together on a few
                days, so with one month of data treat the comparison as a rough guide.
              </p>
              <SeriesCaveat />
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/** Feature 6: the forecast versions published before the deadline, and whether big changes mean big misses. */
export function StabilityPanel({ stability }) {
  const s = stability, v = s.versions, t = s.history;
  return (
    <Panel icon="history" term="stability" title="Did the forecast change before your deadline?"
      headline={s.revision == null ? "Only one version covered the whole day before your deadline."
        : Math.abs(s.revision) < 1 ? "The forecast did not change between versions (less than 1 MW)."
        : `From the first to the last version, the day average moved by ${smw(s.revision)}.`}
      pills={<>
        <Pill kind="info" text="Information only" why="No clear link was found between how much the forecast changed and how big the miss was, so this list is not used in any calculation." />
        {t.enough && t.r != null && !clearLink(t) && <Pill kind="nolink" text="No clear link" why={`Link strength ${r2(t.r)} over ${t.n} days; a link this strong turns up by chance ${chance(t.p)}.`} />}
        {(!t.enough || t.r == null) && <Pill kind="small" text="Small sample" why={`Only ${t.n} past days can be used here; at least ${t.min_n} are needed to judge a link.`} />}
      </>}
      sub="Every version of this day’s forecast published in the 24 hours before your decide-by time that covers the whole day."
      how="If the day average jumped around between versions, the forecast was unsettled. The note below says whether that has mattered in the past.">
      {v.length ? (
        <table className="rt">
          <thead><tr><th>Published (UK time)</th><th>Day average</th><th>Change from the version before</th></tr></thead>
          <tbody>
            {v.map((x, i) => (
              <tr key={x.publish_time}>
                <td data-label="Published">{stampUK(x.publish_time)}</td>
                <td data-label="Day average"><b>{mw(x.day_avg)}</b></td>
                <td data-label="Change">{i === 0 ? "first version" : smw(x.day_avg - v[i - 1].day_avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="note">No version covered the whole day.</p>}
      <p className="note">
        {!t.enough || t.r == null
          ? `Too few past days (${t.n}, fewer than ${t.min_n}) to judge whether big changes go with bigger misses.`
          : clearLink(t)
            ? `In past results, days with bigger changes had ${t.r > 0 ? "bigger" : "smaller"} misses (link strength ${r2(t.r)} over ${t.n} days; a link this strong turns up by chance ${chance(t.p)}).`
            : `In past results, days with bigger changes did not have clearly bigger misses (link strength ${r2(t.r)} over ${t.n} days; a link this strong turns up by chance ${chance(t.p)}). Treat this list as information only.`}
        {" "}Versions published two days ahead stop at 21:00 the evening before delivery, so only versions from the day before cover the whole day.
      </p>
    </Panel>
  );
}

/** Feature 7 (Accuracy page): does a recent miss carry over, and does adjusting for it help? */
export function RecentBiasPanel({ rb }) {
  if (!rb) return null;
  const p = rb.primary, all = rb.all_known_days, l2 = rb.lag_2, l1 = rb.lag_1;
  const gain = p.mae_raw && p.mae_corrected ? (p.mae_raw - p.mae_corrected) / p.mae_raw : null;
  return (
    <Panel icon="repeat" term="recent-bias" title="Does a recent miss carry over to the next day?"
      headline={clearLink(l2) ? "A day’s miss was linked to the miss two days later." : "No clear carry-over: a day’s miss did not reliably predict later days."}
      pills={!clearLink(l2) ? <Pill kind="nolink" text="No clear link" why={`Link strength ${r2(l2.r)} over ${l2.n} days; this turns up by chance ${chance(l2.p)}.`} /> : null}
      sub="If the forecast was too high on recent days, will it be too high tomorrow? Tested only with days known at your deadline."
      how="The first paragraph asks whether one day’s average miss predicts a later day’s. The table tests a simple fix: subtract the average miss of recent known days.">
      <p className="lead">
        {clearLink(l2)
          ? `A day’s average miss was linked to the miss two days later (link strength ${r2(l2.r)} over ${l2.n} days).`
          : `Day to day there is no clear pattern: the average miss of a day known at your deadline (two days earlier) did not reliably predict the next one (link strength ${r2(l2.r)} over ${l2.n} days; this turns up by chance ${chance(l2.p)}).`}
        {!clearLink(l1) && " Even the day just before, which is not complete at your deadline, shows no clear link."}
      </p>
      <table className="rt">
        <thead><tr><th>Adjustment</th><th>Days tested</th><th>Typical miss without</th><th>Typical miss with</th></tr></thead>
        <tbody>
          <tr><td data-label="Adjustment"><b>Last 3 known days</b><small>decided in advance as the main test</small></td><td data-label="Days tested">{p.n_days}</td>
            <td data-label="Without">{mw(p.mae_raw)}</td><td data-label="With"><b>{mw(p.mae_corrected)}</b></td></tr>
          <tr><td data-label="Adjustment"><b>Every known day</b><small>for comparison only</small></td><td data-label="Days tested">{all.n_days}</td>
            <td data-label="Without">{mw(all.mae_raw)}</td><td data-label="With">{mw(all.mae_corrected)}</td></tr>
        </tbody>
      </table>
      <Callout tone="warn" title="Why the adjustment helps here, and why that is not good news">
        Subtracting the recent average miss lowers the typical miss{gain != null ? ` by about ${pct0(gain * 100)}` : ""}. But there is no clear day-to-day pattern,
        so the gain comes from the forecast sitting above this wind record almost every day: the record-keeping gap between Elexon’s FUELHH record and its other
        record of wind. In a separate check against that other record, the same adjustment made the forecast worse (typical miss up from about 1.4 GW to 2.5 GW).
        {" "}So the app does not offer an adjusted forecast.
      </Callout>
    </Panel>
  );
}

/** Feature 8 (Accuracy page): what waiting longer before deciding buys. */
export function CutoffPanel({ cc }) {
  if (!cc) return null;
  const rows = cc.rows, base = rows.find((r) => r.cutoff === cc.default_cutoff) || rows[0], late = rows[rows.length - 1], early = rows[0];
  const d = base.mae - late.mae;
  return (
    <Panel icon="hourglass" term="cutoff-compare" title="What does waiting buy me?"
      headline={d > 0 ? `Waiting from ${base.cutoff} to ${late.cutoff} cuts the typical miss by about ${pct0((d / base.mae) * 100)}.` : `Waiting until ${late.cutoff} does not lower the typical miss.`}
      sub="The same month judged with different decide-by times. A later time can use a newer forecast."
      how="Each row is one decide-by time. Rows that use the same forecast version give the same result. Compare the typical miss with your current time.">
      <p className="lead">
        Waiting from {base.cutoff} to {late.cutoff} uses the forecast published at {late.versions_utc[late.versions_utc.length - 1]} and
        {d > 0 ? ` cuts the typical miss from ${mw(base.mae)} to ${mw(late.mae)} (about ${pct0((d / base.mae) * 100)} better).` : ` does not lower the typical miss (${mw(base.mae)} vs ${mw(late.mae)}).`}
        {" "}Deciding at {early.cutoff} is {Math.abs(early.mae - base.mae) / base.mae < 0.02 ? "about as good as" : early.mae < base.mae ? "slightly better than" : "worse than"} {base.cutoff} in this month.
      </p>
      <table className="rt">
        <thead><tr><th>Decide by (UK time)</th><th>Forecast used (published)</th><th>Hours ahead</th><th>Typical miss</th><th>Bad-hour miss</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cutoff} className={r.cutoff === base.cutoff ? "total" : ""}>
              <td data-label="Decide by"><b>{r.cutoff}</b>{r.cutoff === base.cutoff && <small>current setting</small>}</td>
              <td data-label="Forecast used">{r.versions_utc.join(" and ")}</td>
              <td data-label="Hours ahead">{Math.round(r.horizon_min)} to {Math.round(r.horizon_max)}</td>
              <td data-label="Typical miss"><b>{mw(r.mae)}</b></td>
              <td data-label="Bad-hour miss">{mw(r.bad_hour)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note top-gap">
        UK time equals UTC in January. GB day-ahead auctions close at about 09:20 and 09:50, so deciding later than that only helps if your market
        closes later. With one month of data, differences of a few percent are within normal variation.
      </p>
      <SeriesCaveat />
    </Panel>
  );
}
