import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ANIM, Callout, Chart, Panel, Pill } from "./components.jsx";
import { longDate, mw, num, pct0 } from "./format.js";

const LEVEL_NAME = { low: "Low wind", mid: "Medium wind", high: "High wind" };

/** One-line reminder wherever a margin or bias is shown. */
export function SeriesCaveat() {
  return (
    <p className="caveat">
      Margins are measured against Elexon’s FUELHH record of wind, which reads about 19% lower than Elexon’s other record (B1630).
      Measured against that other record, these margins would be smaller.
    </p>
  );
}

const rangeText = (l) =>
  l.forecast_from == null ? `forecast up to ${mw(l.forecast_to)}`
  : l.forecast_to == null ? `forecast above ${mw(l.forecast_from)}`
  : `forecast ${mw(l.forecast_from)} to ${mw(l.forecast_to)}`;

const diffText = (d) => (Math.abs(d) < 1 ? "the same" : d > 0 ? `${mw(d)} wider` : `${mw(-d)} tighter`);

/** Feature 2: margin by wind level, compared with one margin for every hour. */
export function LevelTable({ margin, ratio }) {
  const m = margin;
  if (!m.available) {
    return (
      <Panel icon="layers" term="margin-by-level" title="Margin by wind level" headline="Not enough earlier days to split the margin by wind level."
        pills={<Pill kind="small" text="Small sample" why={`Needs at least ${m.min_n} past hours; only ${m.n} are known before this day.`} />}>
        <Callout title="Not enough past results yet">
          This needs at least {m.min_n} past hours, and only {m.n} are available for this day with your setting.
        </Callout>
      </Panel>
    );
  }
  const flat = m.flat;
  const tighter = m.levels.filter((l) => !l.fallback && l.used.margin < flat.margin - 1);
  const wider = m.levels.filter((l) => !l.fallback && l.used.margin > flat.margin + 1);
  const anyFallback = m.levels.some((l) => l.own.n < m.min_n);
  const L = Object.fromEntries(m.levels.map((l) => [l.level, l]));
  const trio = `${mw(L.low.used.margin)} (low), ${mw(L.mid.used.margin)} (medium) and ${mw(L.high.used.margin)} (high)`;
  const headline = m.method === "flat"
    ? `One margin for every hour: ${mw(flat.margin)}. Split by wind level it would be ${trio}.`
    : `By wind level: ${trio}. One margin for every hour would be ${mw(flat.margin)}.`;
  return (
    <Panel icon="layers" term="margin-by-level" title="Margin by wind level" headline={headline}
      pills={<>
        {m.method === "flat" && <Pill kind="info" text="Information only" why="You are using one margin for every hour. This table only shows what the wind-level split would give; in the fair check it did not cover more hours overall." />}
        {anyFallback && <Pill kind="small" text="Small sample" why={`At least one group has fewer than ${m.min_n} past hours, so it uses the all-hours margin.`} />}
      </>}
      sub={`Past hours are split into three equal groups by how much wind was forecast. Each group gets its own margin (shortfall costs ${ratio}× a surplus).`}
      how="Read across a row: when the forecast is in that range, this is how much extra to keep. The last column compares it with using one margin for every hour.">
      <table className="rt">
        <thead>
          <tr><th>Wind level</th><th>Past hours</th><th>Typical miss</th><th>Extra to keep</th><th>Compared with one margin for all hours</th></tr>
        </thead>
        <tbody>
          {m.levels.map((l) => (
            <tr key={l.level}>
              <td data-label="Wind level"><b>{LEVEL_NAME[l.level]}</b><small>{rangeText(l)}</small></td>
              <td data-label="Past hours">{num(l.own.n)}{l.own.n < m.min_n && <small className="warn-text">fewer than {m.min_n}</small>}</td>
              <td data-label="Typical miss">{mw(l.own.typical_miss)}</td>
              <td data-label="Extra to keep">
                <b>{mw(l.used.margin)}</b>
                {l.fallback && m.method === "level" && <small className="warn-text">Too few hours, so the all-hours value is used</small>}
              </td>
              <td data-label="Compared with one margin">{l.fallback ? "the same (all-hours value)" : diffText(l.used.margin - flat.margin)}</td>
            </tr>
          ))}
          <tr className="total">
            <td data-label="Wind level"><b>All hours</b><small>one margin for every hour</small></td>
            <td data-label="Past hours">{num(flat.n)}</td>
            <td data-label="Typical miss">{mw(flat.typical_miss)}</td>
            <td data-label="Extra to keep"><b>{mw(flat.margin)}</b></td>
            <td data-label="Compared with one margin">–</td>
          </tr>
        </tbody>
      </table>
      <p className="note top-gap">
        {m.method === "flat"
          ? "You chose one margin for every hour, so the chart uses the “All hours” row. The other rows show what the wind-level split would use."
          : tighter.length || wider.length
            ? `Compared with one margin for every hour, ${[
                tighter.length ? `${tighter.map((l) => LEVEL_NAME[l.level].toLowerCase()).join(" and ")} hours get a tighter margin` : null,
                wider.length ? `${wider.map((l) => LEVEL_NAME[l.level].toLowerCase()).join(" and ")} hours get a wider one` : null,
              ].filter(Boolean).join(", while ")}.`
            : "Splitting by wind level does not change the margin much here."}
        {anyFallback && ` Groups with fewer than ${m.min_n} past hours are too small to trust, so they use the all-hours value.`}
        {" "}With one month of data, each group holds only about a third of the hours: treat the differences as a guide, not a rule.
      </p>
      <SeriesCaveat />
    </Panel>
  );
}

/** Feature 4: walk-forward check of the margin on past days (no hindsight). */
export function MarginCheck({ check, ratio }) {
  if (!check) return null;
  const c = check;
  if (c.achieved == null) {
    return <Panel icon="target" term="margin-check" title="Did the margin work on past days?"><Callout title="Not enough past results to check">There are too few days with known results.</Callout></Panel>;
  }
  const t = c.target * 100, a = c.achieved * 100, gap = a - t;
  const verdict = Math.abs(gap) <= 3
    ? "That is close to the aim."
    : gap < 0
      ? `The margin was too small more often than planned: wind fell below the planned level in ${pct0(100 - a)} of hours instead of about ${pct0(100 - t)}. Treat the margin as a little on the small side.`
      : `The margin was more generous than needed: you would have kept more reserve than the aim requires.`;
  const other = c.compare;
  const otherName = other.method === "flat" ? "one margin for every hour" : "a margin by wind level";
  const myName = c.method === "flat" ? "one margin for every hour" : "the margin by wind level";
  const oa = other.achieved * 100;
  const better = Math.abs(a - t) < Math.abs(oa - t) - 1 ? "closer to the aim" : Math.abs(oa - t) < Math.abs(a - t) - 1 ? "further from the aim" : "about as close to the aim";
  const otherByLevel = Object.fromEntries((other.by_level || []).map((l) => [l.level, l.achieved]));
  const data = c.by_day.map((d) => ({ ...d, pct: d.achieved * 100 }));
  return (
    <Panel icon="target" term="margin-check" title="Did the margin work on past days?"
      headline={`Aimed at ${pct0(t)} of hours, the margin covered ${pct0(a)}.`}
      pills={<Pill kind="fair" text="No hindsight" why="Each day’s margin is worked out only from days already known before that day’s decision, then checked against what happened." />}
      sub="A fair test: for each past day, the margin is worked out only from days already known at that day’s decision, then checked against what happened."
      how="Each bar is one day: the share of its hours in which the wind did not fall below the planned level. The dashed line is the aim. Bars well below the line are days when the margin was too small.">
      <p className="lead">
        Aim: cover <b>{pct0(t)}</b> of hours (shortfall costs {ratio}× a surplus). Achieved: <b>{pct0(a)}</b> over {num(c.n_hours)} hours on {c.n_days} days,
        with an average margin of {mw(c.margin_avg)}. {verdict}
      </p>
      <p className="lead">
        For comparison, {otherName} would have covered <b>{pct0(oa)}</b> of the same hours with an average margin of {mw(other.margin_avg)}, so {myName} is {better}.
        The split by wind level mainly moves cover between hours: see the table below.
      </p>
      <Chart h={240} caption="Across: delivery day. Up: share of hours covered (%). Dashed line: the aim.">
        <BarChart data={data} margin={{ left: 0, right: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="day" tickFormatter={(d) => d.slice(8)} stroke="var(--muted)" />
          <YAxis domain={[0, 100]} unit="%" width={52} stroke="var(--muted)" />
          <Tooltip labelFormatter={(d) => longDate(d)} formatter={(v, name, p) => [`${pct0(v)} of ${p.payload.n} hours (margin ${mw(p.payload.margin_avg)})`, "Covered"]} />
          <ReferenceLine y={t} stroke="var(--text)" strokeDasharray="5 4" />
          <Bar dataKey="pct" fill="var(--forecast)" {...ANIM} />
        </BarChart>
      </Chart>
      <table className="rt top-gap">
        <thead><tr><th>Wind level</th><th>Hours checked</th><th>Covered (your choice)</th><th>Covered with {otherName}</th><th>Aim</th></tr></thead>
        <tbody>
          {c.by_level.map((l) => (
            <tr key={l.level}>
              <td data-label="Wind level"><b>{LEVEL_NAME[l.level]}</b></td>
              <td data-label="Hours checked">{num(l.n)}{l.n < 30 && <small className="warn-text">fewer than 30: not reliable</small>}</td>
              <td data-label="Covered (your choice)"><b>{pct0(l.achieved * 100)}</b></td>
              <td data-label={`With ${otherName}`}>{otherByLevel[l.level] == null ? "–" : pct0(otherByLevel[l.level] * 100)}</td>
              <td data-label="Aim">{pct0(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note top-gap">
        Skipped: {c.skipped_days.length} day{c.skipped_days.length === 1 ? "" : "s"} at the start ({c.skipped_days.map((d) => longDate(d)).join(", ")}), because fewer than 30 hours of past results were known.
        Hours in the same day tend to move together, so with one month of data a gap of a few percentage points is not meaningful.
      </p>
      <SeriesCaveat />
    </Panel>
  );
}

/** Honest limits, shown on the Plan page. */
export function CannotTell() {
  return (
    <Callout tone="warn" title="What this cannot tell you" id="cannot-tell">
      <ul className="tight">
        <li>It has no weather data: the forecast is its only view of tomorrow, so it cannot warn you about a storm the forecast missed.</li>
        <li>It learns from one month of history (January 2026). Margins from so few days can shift as more data comes in.</li>
        <li>The wind record it checks against (FUELHH) reads about 19% below Elexon’s other record, so margins and “leans high” figures are partly a record-keeping difference.</li>
        <li>It has no demand data. Any demand figure is the number you typed in.</li>
      </ul>
    </Callout>
  );
}
