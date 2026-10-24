import React, { useState } from "react";
import {
  BarChart, Bar, Cell, LineChart, Line, ComposedChart, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ZAxis,
} from "recharts";
import { api } from "./api.js";
import { ANIM, Callout, Card, Chart, CountUp, ErrorBox, Field, InfoTip, Panel, Pill, Skeleton, useAsync } from "./components.jsx";
import { CutoffPanel, RecentBiasPanel } from "./Tier2Panels.jsx";
import { BaselinePanel, DayTypePanel } from "./Tier3Panels.jsx";
import { LineLegend } from "./chartParts.jsx";
import { Icon } from "./icons.jsx";
import { dayUK, longDate, mw, num, pct, pct0, smw, stampUK } from "./format.js";

const AX = { stroke: "var(--muted)" };
const kfmt = (v) => `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}`;
const MIN_N = 30;
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

const BAR = { key: "bar", name: "Typical miss", swatch: "bar", color: "var(--forecast)" };
const FADED = { key: "faded", name: `Faded bar: fewer than ${MIN_N} hours, too few to trust`, swatch: "bar", color: "var(--forecast)", opacity: 0.3 };

/** Plain-language hover text for a forecast/actual pair. */
function PairTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const d = r.forecast - r.actual;
  return (
    <div className="ctip">
      <div className="ctip-h">{stampUK(r.start_time)}</div>
      <div><span>Forecast</span> <b>{mw(r.forecast)}</b></div>
      <div><span>What actually happened</span> <b>{mw(r.actual)}</b></div>
      <div className="ctip-v">{Math.abs(d) < 1 ? "The forecast was right." : `The forecast was ${mw(Math.abs(d))} too ${d > 0 ? "high" : "low"}.`}</div>
    </div>
  );
}

/** Plain-language hover text for a bar that summarises several hours. */
function BarTip({ active, payload, label, title }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="ctip">
      <div className="ctip-h">{title(label, r)}</div>
      {r.mae != null && <div><span>Typical miss</span> <b>{mw(r.mae)}</b></div>}
      {r.p90_abs_error != null && <div><span>Bad-hour miss</span> <b>{mw(r.p90_abs_error)}</b></div>}
      {r.bias != null && <div><span>Leans</span> <b>{smw(r.bias)}</b> <span>({r.bias > 0 ? "too high" : "too low"} on average)</span></div>}
      {r.n != null && <div className="ctip-n">From {num(r.n)} hours{r.n < MIN_N ? ": too few to trust." : "."}</div>}
    </div>
  );
}

export default function AccuracyView({ meta }) {
  const [f, setF] = useState({ start: "", end: "", basis: "decision", min_h: "", max_h: "", cutoff: "" }); // "" = backend default
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data, loading, error, retry } = useAsync(() => api("accuracy", f), [JSON.stringify(f)]);
  const s = data?.summary;
  const rb = useAsync(() => api("recent-bias", {}), []);
  const cc = useAsync(() => api("cutoff-compare", {}), []);
  const bl = useAsync(() => api("baseline", { start: f.start, end: f.end, cutoff: f.cutoff }), [f.start, f.end, f.cutoff]);
  const thin = (rows) => (rows || []).filter((r) => r.n < MIN_N);
  const solid = (rows) => (rows || []).filter((r) => r.n >= MIN_N);
  const start = f.start || meta?.first_day, end = f.end || meta?.last_day;

  // Headline sentences, worked out from the data shown in each chart.
  let H = {};
  if (data && s?.n > 0) {
    const hz = solid(data.by_horizon);
    H.horizon = hz.length >= 2
      ? `Issued ${hz[0].horizon_bin} to ${hz[0].horizon_bin + 3} hours ahead: typical miss ${mw(hz[0].mae)}. Issued ${hz[hz.length - 1].horizon_bin} to ${hz[hz.length - 1].horizon_bin + 3} hours ahead: ${mw(hz[hz.length - 1].mae)}.`
      : "Too few hours in each group to compare how far ahead forecasts were issued.";
    const hr = solid(data.by_hour);
    if (hr.length >= 2) {
      const worst = hr.reduce((a, b) => (b.mae > a.mae ? b : a)), best = hr.reduce((a, b) => (b.mae < a.mae ? b : a));
      H.hour = `Hardest hour: ${hh(worst.hour)} (typical miss ${mw(worst.mae)}). Easiest: ${hh(best.hour)} (${mw(best.mae)}).`;
    } else H.hour = "Too few hours per bar in this range to compare hours of the day.";
    const tot = data.histogram.reduce((a, b) => a + b.count, 0), high = data.histogram.filter((b) => b.bin_start >= 0).reduce((a, b) => a + b.count, 0);
    H.hist = `The forecast was too high (less wind than promised) in ${pct0((high / tot) * 100)} of hours.`;
    const above = data.points.filter((p) => p.forecast > p.actual).length;
    H.scatter = `${pct0((above / data.points.length) * 100)} of the dots sit below the diagonal: in those hours the forecast was too high.`;
    H.time = `The forecast sat above what actually happened in ${num(above)} of the ${num(data.points.length)} hours shown.`;
    const days = data.by_day;
    if (days.length >= 2) {
      const w = days.reduce((a, b) => (b.mae > a.mae ? b : a)), bst = days.reduce((a, b) => (b.mae < a.mae ? b : a));
      H.day = `Worst day: ${longDate(w.day)} (typical miss ${mw(w.mae)}). Best: ${longDate(bst.day)} (${mw(bst.mae)}).`;
    } else H.day = days.length ? `${longDate(days[0].day)}: typical miss ${mw(days[0].mae)}.` : "";
  }

  return (
    <>
      <section className="ctrl-card wide-card" aria-labelledby="acc-c">
        <h2 id="acc-c" className="ctrl-h"><Icon name="sliders" size={18} />Choose what to check</h2>
        <div className="controls">
          <Field label="From day"><input type="date" value={f.start || meta?.first_day || ""} min={meta?.first_day} max={meta?.last_day} onChange={set("start")} /></Field>
          <Field label="To day"><input type="date" value={f.end || meta?.last_day || ""} min={meta?.first_day} max={meta?.last_day} onChange={set("end")} /></Field>
          <Field label="Which forecasts to check" term="forecast" hint="Decision-time forecast is the one you would really have had. “Every forecast published” shows how timing matters.">
            <select value={f.basis} onChange={set("basis")}>
              <option value="decision">Decision-time forecast</option>
              <option value="all">Every forecast published</option>
            </select>
          </Field>
          <Field label="Issued at least this many hours ahead" term="hours-ahead" hint="Leave empty for no limit">
            <input type="number" min="0" step="1" inputMode="numeric" value={f.min_h} onChange={set("min_h")} placeholder="no limit" />
          </Field>
          <Field label="Issued at most this many hours ahead" term="hours-ahead" hint="Leave empty for no limit">
            <input type="number" min="0" step="1" inputMode="numeric" value={f.max_h} onChange={set("max_h")} placeholder="no limit" />
          </Field>
          <Field label="Decide by (UK time, the day before)" term="decide-by" hint="Only affects “Decision-time forecast”">
            <input type="time" value={f.cutoff || meta?.default_cutoff || ""} onChange={(e) => e.target.value && setF({ ...f, cutoff: e.target.value })} />
          </Field>
        </div>
      </section>

      <ErrorBox error={error} onRetry={retry} what="the accuracy figures" />
      {!data && !error && <Skeleton cards={6} panels={2} />}
      {data && s?.n === 0 && <Callout title="Nothing to show for these choices">No hours match. Try a wider range of days or clear the hours-ahead limits.</Callout>}
      {data && s?.n > 0 && (
        <div className="results" style={{ opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
          <section className="hero" aria-labelledby="acc-hero">
            <p className="eyebrow">How reliable is the forecast?</p>
            <h2 id="acc-hero" className="hero-main"><span className="hero-icon"><Icon name="target" size={28} /></span>
              <span>Typically off by <span className="big"><CountUp value={s.mae} format={mw} /></span><InfoTip term="typical-miss" /></span></h2>
            <p className="lead">
              We compared the forecast with what really happened for <b>{num(s.n)} hours</b> ({longDate(start)} to {longDate(end)}).
              On average the forecast was <b>{mw(s.mae)}</b> away from the recorded wind, about <b>{pct0(s.mape)}</b> of the wind that blew.
              In 9 hours out of 10 the miss was smaller than <b>{mw(s.p90_abs_error)}</b>; the worst misses reached about {mw(s.p99_abs_error)}.
            </p>
          </section>

          <div className="cards">
            <Card i={0} hl icon="ruler" term="typical-miss" k="Typical miss" n={s.mae} fmt={mw} s="Average size of the error, whichever way it went (MAE)" />
            <Card i={1} icon="barChart" term="miss-share" k="Miss as a share of wind" n={s.mape} fmt={pct} s="Typical miss compared with the wind that blew (MAPE)" />
            <Card i={2} icon="alert" term="bad-hour" k="Bad-hour miss" n={s.p90_abs_error} fmt={mw} s="9 hours in 10 were better than this" />
            <Card i={3} icon="zap" term="worst-case" k="Worst-case miss" n={s.p99_abs_error} fmt={mw} s="99 hours in 100 were better than this" />
            <Card i={4} hl icon="trendingUp" term="bias" k="Does it lean one way?" n={s.bias} fmt={smw}
              s={`${s.bias > 0 ? "Plus: forecast ran higher than the recorded wind" : "Minus: forecast ran lower than the recorded wind"}. Read the note below first.`} />
            <Card i={5} icon="clock" term="small-sample" k="Hours checked" n={s.n} fmt={num} s={`Average recorded wind: ${mw(s.mean_actual)}`} />
            <Card i={6} hl wide icon="layers" term="usual-range" k={`Usual range of misses (${Math.round(s.band_coverage * 100)} hours in 100)`}
              v={<span className="pair"><CountUp value={s.band_lo} format={smw} /><span className="to">to</span><CountUp value={s.band_hi} format={smw} /></span>}
              s="Forecast minus recorded wind. Minus means more wind than forecast; plus means less." />
          </div>

          <Callout tone="warn" title="Before you trust the “leans high” figure">
            The record of wind used here (Elexon’s FUELHH) reads about 19% (roughly 2.2 GW) lower than Elexon’s other official record (B1630).
            Against that other record, the forecast runs only about 0.4 GW low and is off by about 1.3 GW on average. So most of the “runs high”
            result is a gap between two records, not a poor forecast. <a href="#guide/record-gap">What is the record gap?</a>
          </Callout>

          <details className="advanced specialists">
            <summary><Icon name="sliders" size={18} /><span>Extra statistics for specialists</span><Icon name="chevronDown" size={18} className="chev" /></summary>
            <div className="cards">
              <Card icon="ruler" k="Typical miss, big errors counted extra" n={s.rmse} fmt={mw} s="Root-mean-square error (RMSE). Much larger than the typical miss means a few very bad hours." />
              <Card icon="ruler" k="Middle miss" n={s.p50_abs_error} fmt={mw} s="Half of all misses were smaller than this (the median)." />
            </div>
          </details>

          <BaselinePanel b={bl.data} />
          <ErrorBox error={bl.error} onRetry={bl.retry} what="the simple-guess comparison" />

          <div className="grid2">
            <Panel icon="hourglass" term="hours-ahead" title="Is the forecast better closer to the time?" headline={H.horizon}
              pills={thin(data.by_horizon).length ? <Pill kind="small" text="Small sample" why={`Some bars rest on fewer than ${MIN_N} hours; they are faded.`} /> : null}
              sub="How big the miss is, depending on how many hours ahead the forecast was issued."
              how="Bars on the left are forecasts issued shortly before the hour; bars on the right were issued long before. If the bars grow to the right, waiting for a fresher forecast pays off. With “Decision-time forecast” the range is narrow because your decide-by time fixes how far ahead the forecast is; choose “Every forecast published” to see the full picture.">
              <Chart caption="Across: hours ahead the forecast was issued. Up: size of the miss in GW (1 GW = 1,000 MW)."><ComposedChart data={data.by_horizon} margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="horizon_bin" {...AX} tickFormatter={(v) => `${v} h`} />
                <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
                <Tooltip content={<BarTip title={(l) => `Issued ${l} to ${l + 3} hours ahead`} />} />
                <Bar dataKey="mae" name="Typical miss" fill="var(--forecast)" {...ANIM}>
                  {data.by_horizon.map((r) => <Cell key={r.horizon_bin} fill="var(--forecast)" fillOpacity={r.n < MIN_N ? 0.3 : 1} />)}
                </Bar>
                <Line dataKey="p90_abs_error" name="Bad-hour miss" stroke="var(--actual)" strokeWidth={2} strokeDasharray="6 4" dot={false} {...ANIM} />
              </ComposedChart></Chart>
              <LineLegend items={[BAR, { key: "p90", name: "Bad-hour miss", color: "var(--actual)", width: 2, dash: "6 4" }, ...(thin(data.by_horizon).length ? [FADED] : [])]} />
              {thin(data.by_horizon).length > 0 && (
                <p className="note top-gap">Faded bars ({thin(data.by_horizon).map((r) => `${r.horizon_bin} h`).join(", ")}) rest on fewer than {MIN_N} hours: use the overall typical miss of {mw(s.mae)} for those.</p>
              )}
            </Panel>

            <Panel icon="clock" term="typical-miss" title="Which hours of the day are hardest?" headline={H.hour}
              pills={thin(data.by_hour).length ? <Pill kind="small" text="Small sample" why={`Some bars rest on fewer than ${MIN_N} hours; they are faded.`} /> : null}
              sub="Bars: the typical miss. Line: whether the forecast ran high (above zero) or low (below zero)."
              how="Tall bars are the hours when the forecast is least reliable. Where the line sits well above zero, the forecast promised more wind than was recorded in that hour.">
              <Chart caption="Across: hour of the day, UK time (0 is midnight). Up: size of the miss in GW."><ComposedChart data={data.by_hour} margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" {...AX} />
                <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
                <Tooltip content={<BarTip title={(l) => `${hh(l)} to ${hh((l + 1) % 24)} UK time`} />} />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <Bar dataKey="mae" name="Typical miss" fill="var(--forecast)" {...ANIM}>
                  {data.by_hour.map((r) => <Cell key={r.hour} fill="var(--forecast)" fillOpacity={r.n < MIN_N ? 0.3 : 1} />)}
                </Bar>
                <Line dataKey="bias" name="Ran high (+) or low (−)" stroke="var(--actual)" strokeWidth={2} strokeDasharray="6 4" dot={false} {...ANIM} />
              </ComposedChart></Chart>
              <LineLegend items={[BAR, { key: "bias", name: "Ran high (+) or low (−)", color: "var(--actual)", width: 2, dash: "6 4" }, ...(thin(data.by_hour).length ? [FADED] : [])]} />
              {thin(data.by_hour).length > 0 && (
                <p className="note top-gap">Faded bars ({thin(data.by_hour).map((r) => hh(r.hour)).join(", ")}) rest on fewer than {MIN_N} hours: use the overall typical miss of {mw(s.mae)} for those.</p>
              )}
            </Panel>

            <Panel icon="barChart" term="bias" title="How big are the misses?" headline={H.hist}
              sub="Number of hours (up) with each size of miss (across). Each bar is a 0.5 GW step."
              how="Bars right of the centre line are hours when the forecast was too high (less wind than promised, so you would be short). Bars left of it had more wind than forecast. A long tail on the right is the risk of a big shortfall.">
              <Chart caption="Across: forecast minus recorded wind (GW). Left of the centre line: more wind than forecast; right: less. Up: number of hours."><BarChart data={data.histogram} margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="bin_start" tickFormatter={kfmt} {...AX} />
                <YAxis {...AX} width={48} />
                <Tooltip content={({ active, payload }) => active && payload?.length ? (
                  <div className="ctip"><div className="ctip-h">Forecast {payload[0].payload.bin_start >= 0 ? "too high" : "too low"} by {mw(Math.abs(payload[0].payload.bin_start))} to {mw(Math.abs(payload[0].payload.bin_end))}</div>
                    <div><b>{num(payload[0].payload.count)}</b> <span>hours</span></div></div>) : null} />
                <ReferenceLine x={0} stroke="var(--muted)" />
                <Bar dataKey="count" fill="var(--forecast)" {...ANIM} />
              </BarChart></Chart>
            </Panel>

            <Panel icon="target" term="actual" title="Forecast against reality" headline={H.scatter}
              sub={`${num(data.points.length)} hours shown, one dot per hour`}
              how="Each dot is one hour. Across is what really happened; up is what was forecast. A dot on the dashed diagonal means the forecast was exactly right; below it, too high; above it, too low.">
              <Chart caption="Across: what actually happened (GW). Up: what was forecast (GW). 1 GW = 1,000 MW."><ScatterChart margin={{ left: 0, right: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="actual" name="What actually happened" tickFormatter={kfmt} {...AX} domain={[0, "dataMax"]} />
                <YAxis type="number" dataKey="forecast" name="Forecast" tickFormatter={kfmt} {...AX} unit=" GW" width={78} domain={[0, "dataMax"]} />
                <ZAxis range={[14, 14]} />
                <Tooltip content={<PairTip />} cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="var(--muted)" strokeDasharray="4 4" />
                <Scatter data={data.points} fill="var(--forecast)" fillOpacity={0.5} {...ANIM} />
              </ScatterChart></Chart>
            </Panel>
          </div>

          <Panel icon="lineChart" term="forecast" title="Forecast and reality over time" headline={H.time}
            sub="Hour by hour, in date order. Power in GW (1 GW = 1,000 MW)."
            how="Check whether the solid forecast line follows the dotted line of what really happened. Stretches where the forecast sits above are the costly shortfall periods.">
            <Chart h={300}><LineChart data={data.points} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="start_time" tickFormatter={(t) => dayUK(t)} minTickGap={50} {...AX} />
              <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
              <Tooltip content={<PairTip />} />
              <Line dataKey="forecast" name="Forecast" stroke="var(--forecast)" dot={false} strokeWidth={1.75} {...ANIM} />
              <Line dataKey="actual" name="What actually happened" stroke="var(--actual)" dot={false} strokeWidth={2} strokeDasharray="1 4" strokeLinecap="round" {...ANIM} />
            </LineChart></Chart>
            <LineLegend items={[{ key: "f", name: "Forecast", color: "var(--forecast)", width: 2 }, { key: "a", name: "What actually happened", color: "var(--actual)", width: 2.5, dash: "1 5" }]} />
          </Panel>

          <Panel icon="calendar" term="typical-miss" title="Day by day" headline={H.day}
            pills={<Pill kind="small" text="Small sample" why="Each day rests on only 24 hours, and hours within a day move together. Single days are noisy." />}
            sub="Bars: the typical miss each day. Line: whether the forecast ran high (above zero) or low (below zero)."
            how="Shows whether the period was steadily so-so or whether a few bad days caused most of the trouble.">
            <Chart h={260}><ComposedChart data={data.by_day} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="day" tickFormatter={(d) => d.slice(8)} {...AX} />
              <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={78} />
              <Tooltip content={<BarTip title={(l) => longDate(l)} />} /><ReferenceLine y={0} stroke="var(--muted)" />
              <Bar dataKey="mae" name="Typical miss" fill="var(--forecast)" {...ANIM} />
              <Line dataKey="bias" name="Ran high (+) or low (−)" stroke="var(--actual)" strokeWidth={2} strokeDasharray="6 4" dot={false} {...ANIM} />
            </ComposedChart></Chart>
            <LineLegend items={[BAR, { key: "bias", name: "Ran high (+) or low (−)", color: "var(--actual)", width: 2, dash: "6 4" }]} />
          </Panel>
          <CutoffPanel cc={cc.data} />
          <DayTypePanel p={data.by_daytype} />
          <RecentBiasPanel rb={rb.data} />
          <ErrorBox error={rb.error || cc.error} onRetry={() => { rb.retry(); cc.retry(); }} what="some of the checks" />
        </div>
      )}
    </>
  );
}
