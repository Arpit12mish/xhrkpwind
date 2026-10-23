import React, { useMemo, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { api } from "./api.js";
import { ANIM, Callout, Card, Chart, Field, Panel, RangeBar, Skeleton, useAsync } from "./components.jsx";
import { gw, longDate, mw, num, oneIn, pct, smw, stampUK, timeUK } from "./format.js";

const DEFAULT_DAY = "2026-01-15"; // also hard-coded in index.html for the early preload

export default function DecisionView({ meta }) {
  const [day, setDay] = useState(DEFAULT_DAY);
  const [cutoff, setCutoff] = useState(""); // "" = backend default (lets the pre-computed file be used)
  const [coverage, setCoverage] = useState(0.8);
  const [bandBasis, setBandBasis] = useState("all");
  const [showActual, setShowActual] = useState(true);

  const { data, loading, error } = useAsync(
    () => api("decision", { day, cutoff, coverage, band_basis: bandBasis }),
    [day, cutoff, coverage, bandBasis]
  );

  // One row per half hour; forecast and range exist only on the hour (the forecast is hourly).
  const series = useMemo(() => {
    if (!data) return [];
    const by = new Map();
    for (const a of data.actual_series) by.set(a.start_time, { t: a.start_time, actual: a.actual });
    for (const r of data.rows) {
      const row = by.get(r.start_time) || { t: r.start_time };
      Object.assign(row, { forecast: r.forecast, lower: r.lower, band: r.upper - r.lower, upper: r.upper });
      by.set(r.start_time, row);
    }
    return [...by.values()].sort((a, b) => a.t.localeCompare(b.t));
  }, [data]);
  const ticks = series.filter((r) => timeUK(r.t).endsWith(":00") && +timeUK(r.t).slice(0, 2) % 3 === 0).map((r) => r.t);

  const b = data?.band;
  const real = data?.realised;
  const hasRange = b && b.hi != null && b.lo != null;
  const cov = b?.coverage ?? coverage;
  const n = oneIn(cov);
  const mean = data?.forecast_mean;
  const weakCase = hasRange ? Math.max(0, mean - b.hi) : null;
  const strongCase = hasRange ? mean - b.lo : null;
  const reserve = hasRange ? Math.max(0, b.hi) : null;
  const surplus = hasRange ? Math.max(0, -b.lo) : null;

  return (
    <>
      <section className="panel controls-panel">
        <h2 className="sec">Choose what you are planning</h2>
        <div className="controls">
          <Field label="Day you are buying for" hint={meta ? `Any day from ${longDate(meta.first_day)} to ${longDate(meta.last_day)}` : ""}>
            <input type="date" value={day} min={meta?.first_day} max={meta?.last_day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </Field>
          <Field label="Decide by (UK time, the day before)" hint="Forecasts published after this time are ignored, as they would not have been available to you.">
            <input type="time" value={cutoff || meta?.default_cutoff || ""} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
          </Field>
          <Field label="How careful to be" hint="Usual covers 8 hours in 10. A more careful setting covers more bad hours, but means keeping more in reserve.">
            <select value={coverage} onChange={(e) => setCoverage(+e.target.value)}>
              <option value={0.8}>Usual (8 in 10 hours)</option>
              <option value={0.9}>Careful (9 in 10 hours)</option>
              <option value={0.98}>Very careful (98 in 100)</option>
            </select>
          </Field>
          <Field label="Work out the safety range from" hint="“Only days already known” is the stricter choice: it ignores any day that had not happened yet when you decide.">
            <select value={bandBasis} onChange={(e) => setBandBasis(e.target.value)}>
              <option value="all">Every day in the data</option>
              <option value="prior">Only days already known</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
            <span>Show what actually happened<small>Hidden, you see only what you could have known.</small></span>
          </label>
        </div>
      </section>

      {error && <div className="err" role="alert">Something went wrong: {String(error.message)}</div>}
      {!data && !error && <Skeleton cards={4} panels={1} />}
      {data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
          <section className="panel hero">
            <p className="eyebrow">Your plan for</p>
            <h2>{longDate(data.day)}</h2>
            <p className="lead">
              The latest forecast you could see (issued <b>{stampUK(data.latest_publish_time)}</b>) says wind will average{" "}
              <b>{mw(mean)}</b> over the day, from a low of {mw(data.forecast_min)} to a peak of {mw(data.forecast_peak)}.
            </p>
            {hasRange ? (
              <>
                <RangeBar low={weakCase} mid={mean} high={strongCase}
                  labels={{ low: "Weak-wind case", mid: "Expected", high: "Strong-wind case" }} />
                <p className="lead">
                  Wind is never forecast perfectly. In past results, wind ended up more than <b>{mw(reserve)} below</b> the forecast
                  only about 1 hour in {n}. So to stay covered on a weak-wind day, <b>keep about {mw(reserve)} of extra supply in reserve.</b>{" "}
                  It ended up more than {mw(surplus)} above the forecast about 1 hour in {n}.
                </p>
              </>
            ) : (
              <Callout title="No safety range for this setting yet">
                The stricter setting needs earlier days with known results, and there are none before this day. Choose
                “Every day in the data” above to see a safety range.
              </Callout>
            )}
          </section>

          <div className="cards">
            <Card i={0} k="Forecast issued" v={stampUK(data.latest_publish_time)} s="The newest forecast available before your decide-by time" />
            <Card i={1} k="Expected wind (day average)" n={mean} fmt={mw} s={`That is about ${gw(mean)}`} />
            <Card i={2} hl k="Extra to keep in reserve" n={reserve} v="–" fmt={mw} s={`Covers a weak-wind day (all but 1 hour in ${n})`} />
            <Card i={3} k="If wind is stronger than forecast" n={surplus} v="–" fmt={mw} s={`Could be this much above forecast (1 hour in ${n})`} />
            {showActual && real && (
              <Card i={4} wide k="What actually happened" n={real.mean_actual} fmt={mw}
                s={`Forecast was off by ${mw(real.mae)} on average (${pct(real.mape)} of wind), and ${real.bias > 0 ? "too high" : "too low"} overall`} />
            )}
          </div>

          <Panel
            title="Wind through the day"
            sub="Hour by hour, UK time. 1 GW is 1,000 MW."
            how="The blue line is the forecast you had to work with. The shaded stretch is where wind usually ends up. The orange line is what really happened. It is there only so you can check how the forecast did."
          >
            <Chart h={380}>
              <ComposedChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="t" ticks={ticks} tickFormatter={timeUK} tickMargin={10} stroke="var(--muted)" />
                <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" stroke="var(--muted)" width={78} />
                <Tooltip labelFormatter={stampUK} formatter={(v, name) => [`${num(v)} MW`, name]} />
                <Legend />
                <Area dataKey="lower" stackId="b" stroke="none" fill="transparent" legendType="none" {...ANIM} name="range floor" />
                <Area dataKey="band" stackId="b" stroke="none" fill="var(--band)" {...ANIM} name={`Usual range (${Math.round(cov * 100)}% of hours)`} connectNulls />
                <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={2.5} dot={false} {...ANIM} name="Forecast" connectNulls />
                {showActual && <Line dataKey="actual" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} name="What actually happened" />}
              </ComposedChart>
            </Chart>
          </Panel>

          {hasRange && (
            <p className="note foot">
              The safety range comes from {num(b.n)} past hours in which the forecast was compared with what happened
              ({b.basis === "prior" ? "only days already known when you decide, so nothing from the future is used" : "every day in the data, which is slightly optimistic because it includes the days being judged"}).
              In those hours, forecast minus actual ran from {smw(b.lo)} to {smw(b.hi)} in {Math.round(cov * 100)} cases out of 100
              (a minus sign means there was more wind than forecast).
            </p>
          )}
        </div>
      )}
    </>
  );
}
