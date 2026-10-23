import React, { useState } from "react";
import {
  BarChart, Bar, LineChart, Line, ComposedChart, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ZAxis,
} from "recharts";
import { api } from "./api.js";
import { ANIM, Callout, Card, Chart, CountUp, Field, Panel, Skeleton, useAsync } from "./components.jsx";
import { dayUK, longDate, mw, num, oneIn, pct, pct0, smw, stampUK } from "./format.js";

const AX = { stroke: "var(--muted)" };
const kfmt = (v) => `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}`;
const axisLabel = (value, extra = {}) => ({ value, fill: "var(--muted)", ...extra });

export default function AccuracyView({ meta }) {
  const [f, setF] = useState({ start: "", end: "", basis: "decision", min_h: "", max_h: "", cutoff: "" }); // "" = backend default
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data, loading, error } = useAsync(() => api("accuracy", f), [JSON.stringify(f)]);
  const s = data?.summary;
  const start = f.start || meta?.first_day, end = f.end || meta?.last_day;
  const n = s?.band_coverage ? oneIn(s.band_coverage) : 10;

  return (
    <>
      <section className="panel controls-panel">
        <h2 className="sec">Choose what to check</h2>
        <div className="controls">
          <Field label="From day"><input type="date" value={f.start || meta?.first_day || ""} min={meta?.first_day} max={meta?.last_day} onChange={set("start")} /></Field>
          <Field label="To day"><input type="date" value={f.end || meta?.last_day || ""} min={meta?.first_day} max={meta?.last_day} onChange={set("end")} /></Field>
          <Field label="Which forecasts to check" hint="Decision-time forecast is the one you would really have had. “Every forecast published” shows how timing matters.">
            <select value={f.basis} onChange={set("basis")}>
              <option value="decision">Decision-time forecast</option>
              <option value="all">Every forecast published</option>
            </select>
          </Field>
          <Field label="Issued at least this many hours ahead" hint="Leave empty for no limit">
            <input type="number" min="0" step="1" inputMode="numeric" value={f.min_h} onChange={set("min_h")} placeholder="no limit" />
          </Field>
          <Field label="Issued at most this many hours ahead" hint="Leave empty for no limit">
            <input type="number" min="0" step="1" inputMode="numeric" value={f.max_h} onChange={set("max_h")} placeholder="no limit" />
          </Field>
          <Field label="Decide by (UK time, the day before)" hint="Only affects “Decision-time forecast”">
            <input type="time" value={f.cutoff || meta?.default_cutoff || ""} onChange={(e) => e.target.value && setF({ ...f, cutoff: e.target.value })} />
          </Field>
        </div>
      </section>

      {error && <div className="err" role="alert">Something went wrong: {String(error.message)}</div>}
      {!data && !error && <Skeleton cards={6} panels={2} />}
      {data && s?.n === 0 && <Callout title="Nothing to show for these choices">No hours match. Try a wider range of days or clear the hours-ahead limits.</Callout>}
      {data && s?.n > 0 && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
          <section className="panel hero">
            <p className="eyebrow">How reliable is the forecast?</p>
            <h2>Typically off by <span className="big"><CountUp value={s.mae} format={mw} /></span></h2>
            <p className="lead">
              We compared the forecast with what really happened for <b>{num(s.n)} hours</b> ({longDate(start)} to {longDate(end)}).
              On average the forecast was <b>{mw(s.mae)}</b> away from the real wind, which is about <b>{pct0(s.mape)}</b> of the wind that blew.
            </p>
            <p className="lead">
              In 9 hours out of 10 the miss was smaller than <b>{mw(s.p90_abs_error)}</b>. The worst misses reached about {mw(s.p99_abs_error)}.
              Use the first figure as a “bad hour” allowance when you plan how much cushion to keep.
            </p>
          </section>

          <div className="cards" style={{ opacity: loading ? 0.6 : 1 }}>
            <Card i={0} hl k="Typical miss" n={s.mae} fmt={mw} s="The average size of the error, whichever way it went (statisticians call this MAE)" />
            <Card i={1} k="Miss as a share of wind" n={s.mape} fmt={pct} s="Typical miss compared with the wind that actually blew (MAPE)" />
            <Card i={2} k="Bad-hour miss" n={s.p90_abs_error} fmt={mw} s="9 hours in 10 were better than this (the 90th percentile)" />
            <Card i={3} k="Worst-case miss" n={s.p99_abs_error} fmt={mw} s="99 hours in 100 were better than this (the 99th percentile)" />
            <Card i={4} hl k="Does it lean one way?" n={s.bias} fmt={smw} s={`${s.bias > 0 ? "Plus: forecast ran higher than the recorded wind" : "Minus: forecast ran lower than the recorded wind"} (the “bias”). Read the note below first.`} />
            <Card i={5} k="Hours checked" n={s.n} fmt={num} s={`Average real wind in these hours: ${mw(s.mean_actual)}`} />
            <Card i={6} hl k={`Usual range of misses (${Math.round(s.band_coverage * 100)} hours in 100)`}
              v={<span className="pair"><CountUp value={s.band_lo} format={smw} /><span className="to">to</span><CountUp value={s.band_hi} format={smw} /></span>}
              s="Forecast minus real wind. A minus sign means there was more wind than forecast; a plus sign means less." />
          </div>

          <Callout tone="warn" title="Heads-up before you trust the “leans high” figure">
            The record of real wind used here (Elexon’s FUELHH series) reads about 19% (roughly 2.2 GW) lower than Elexon’s other record of real wind (B1630).
            Compared with that other record, the forecast runs only about 0.4 GW low and is off by about 1.3 GW on average. So most of the “runs high” result is a
            difference between two records, not a poor forecast. Details are in docs/BIAS_FINDINGS.md in the project.
          </Callout>

          <details className="specialists">
            <summary>Extra statistics for specialists</summary>
            <div className="cards">
              <Card k="Typical miss, big errors counted extra" n={s.rmse} fmt={mw} s="Root-mean-square error (RMSE). If this is much larger than the typical miss, a few days were very bad." />
              <Card k="Middle miss" n={s.p50_abs_error} fmt={mw} s="Half of all misses were smaller than this (the median)." />
            </div>
          </details>

          <div className="grid2">
            <Panel title="Is the forecast better closer to the time?" sub="How big the miss is, depending on how many hours ahead the forecast was issued."
              how="Bars on the left are forecasts issued shortly before the hour; bars on the right were issued long before. If the bars grow to the right, waiting for a fresher forecast pays off. The line shows the bad-hour miss. With “Decision-time forecast” the range is narrow, because your decide-by time fixes how far ahead the forecast is. Choose “Every forecast published” to see the full picture.">
              <Chart caption="Across: how many hours ahead the forecast was issued. Up: size of the miss."><ComposedChart data={data.by_horizon} margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="horizon_bin" {...AX} tickFormatter={(v) => `${v} h`} />
                <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
                <Tooltip formatter={(v, name) => [`${num(v)} MW`, name]} labelFormatter={(l) => `Issued ${l} to ${l + 3} hours ahead`} /><Legend />
                <Bar dataKey="mae" name="Typical miss" fill="var(--forecast)" {...ANIM} />
                <Line dataKey="p90_abs_error" name="Bad-hour miss" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} />
              </ComposedChart></Chart>
            </Panel>

            <Panel title="Which hours of the day are hardest?" sub="Bars: the typical miss. Line: whether the forecast ran high (above zero) or low (below zero)."
              how="Tall bars are the hours when the forecast is least reliable. Where the line sits well above zero, the forecast promised more wind than was recorded in that hour. Plan a bigger cushion for the tall-bar hours.">
              <Chart caption="Across: hour of the day, UK time (0 is midnight). Up: size of the miss."><ComposedChart data={data.by_hour} margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" {...AX} />
                <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
                <Tooltip formatter={(v, name) => [`${num(v)} MW`, name]} labelFormatter={(l) => `${String(l).padStart(2, "0")}:00`} /><Legend />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <Bar dataKey="mae" name="Typical miss" fill="var(--forecast)" {...ANIM} />
                <Line dataKey="bias" name="Ran high (+) or low (−)" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} />
              </ComposedChart></Chart>
            </Panel>

            <Panel title="How big are the misses?" sub="Number of hours (up) with each size of miss (across). Each bar is a 0.5 GW step."
              how="Left of the centre line means more wind than forecast; right of it means less. Bars to the right of the centre line are hours when the forecast was too high (less wind than promised, so you would be short). Bars to the left are hours with more wind than forecast. A tall bar away from the centre means the forecast leans that way. A long tail on the right is the risk of a big shortfall.">
              <Chart caption="Across: forecast minus real wind (GW). Left of the centre line means more wind than forecast; right of it means less. Up: number of hours."><BarChart data={data.histogram} margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="bin_start" tickFormatter={kfmt} {...AX} />
                <YAxis {...AX} width={48} />
                <Tooltip labelFormatter={(l) => `${smw(l)} to ${smw(l + 500)}`} formatter={(v) => [v, "hours"]} />
                <ReferenceLine x={0} stroke="var(--muted)" />
                <Bar dataKey="count" fill="var(--forecast)" {...ANIM} />
              </BarChart></Chart>
            </Panel>

            <Panel title="Forecast against reality" sub={`${num(data.points.length)} hours shown, one dot per hour`}
              how="Each dot is one hour. Across is what really happened; up is what was forecast. A dot on the dashed diagonal means the forecast was exactly right. Dots below the line mean the forecast was too high; dots above it mean too low. The tighter the dots hug the line, the better the forecast.">
              <Chart caption="Across: what actually happened (GW). Up: what was forecast (GW)."><ScatterChart margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="actual" name="What actually happened" tickFormatter={kfmt} {...AX} domain={[0, "dataMax"]} />
                <YAxis type="number" dataKey="forecast" name="Forecast" tickFormatter={kfmt} {...AX} unit=" GW" width={78} domain={[0, "dataMax"]} />
                <ZAxis range={[14, 14]} />
                <Tooltip formatter={(v) => `${num(v)} MW`} cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="var(--muted)" strokeDasharray="4 4" />
                <Scatter data={data.points} fill="var(--forecast)" fillOpacity={0.5} {...ANIM} />
              </ScatterChart></Chart>
            </Panel>
          </div>

          <Panel title="Forecast and reality over time" sub="Hour by hour, in date order."
            how="Check whether the blue forecast line follows the orange line of what really happened. Stretches where blue sits above orange are the costly shortfall periods.">
            <Chart h={300}><LineChart data={data.points} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="start_time" tickFormatter={(t) => dayUK(t)} minTickGap={50} {...AX} />
              <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
              <Tooltip labelFormatter={stampUK} formatter={(v, name) => [`${num(v)} MW`, name]} /><Legend />
              <Line dataKey="forecast" name="Forecast" stroke="var(--forecast)" dot={false} strokeWidth={1.5} {...ANIM} />
              <Line dataKey="actual" name="What actually happened" stroke="var(--actual)" dot={false} strokeWidth={1.5} {...ANIM} />
            </LineChart></Chart>
          </Panel>

          <Panel title="Day by day" sub="Bars: the typical miss each day. Line: whether the forecast ran high (above zero) or low (below zero)."
            how="This shows whether the period was steadily so-so or whether a few bad days caused most of the trouble.">
            <Chart h={260}><ComposedChart data={data.by_day} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="day" tickFormatter={(d) => d.slice(8)} {...AX} />
              <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
              <Tooltip formatter={(v, name) => [`${num(v)} MW`, name]} labelFormatter={(d) => longDate(d)} /><Legend /><ReferenceLine y={0} stroke="var(--muted)" />
              <Bar dataKey="mae" name="Typical miss" fill="var(--forecast)" {...ANIM} />
              <Line dataKey="bias" name="Ran high (+) or low (−)" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} />
            </ComposedChart></Chart>
          </Panel>
        </div>
      )}
    </>
  );
}
