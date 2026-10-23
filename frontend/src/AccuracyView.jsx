import React, { useState } from "react";
import {
  BarChart, Bar, LineChart, Line, ComposedChart, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ZAxis,
} from "recharts";
import { api } from "./api.js";
import { ANIM, Card, Chart, CountUp, Panel, Skeleton, useAsync } from "./components.jsx";
import { mw, num, pct, stampUK, dayUK, timeUK } from "./format.js";

const AX = { stroke: "var(--muted)" };
const kfmt = (v) => `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}`;

export default function AccuracyView({ meta }) {
  const [f, setF] = useState({ start: "", end: "", basis: "decision", min_h: "", max_h: "", cutoff: "" }) // "" = backend default;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data, loading, error } = useAsync(() => api("accuracy", f), [JSON.stringify(f)]);
  const s = data?.summary;

  return (
    <>
      <div className="controls">
        <label>From<input type="date" value={f.start || meta?.first_day || ""} min={meta?.first_day} max={meta?.last_day} onChange={set("start")} /></label>
        <label>To<input type="date" value={f.end || meta?.last_day || ""} min={meta?.first_day} max={meta?.last_day} onChange={set("end")} /></label>
        <label>Forecasts compared
          <select value={f.basis} onChange={set("basis")}>
            <option value="decision">Decision-time forecast only</option>
            <option value="all">Every published forecast</option>
          </select>
        </label>
        <label>Horizon ≥ (h)<input type="number" min="0" step="1" style={{ width: 80 }} value={f.min_h} onChange={set("min_h")} placeholder="any" /></label>
        <label>Horizon ≤ (h)<input type="number" min="0" step="1" style={{ width: 80 }} value={f.max_h} onChange={set("max_h")} placeholder="any" /></label>
        <label>Cutoff (UK, D-1)<input type="time" value={f.cutoff || meta?.default_cutoff || ""} onChange={(e) => e.target.value && setF({ ...f, cutoff: e.target.value })} /></label>
      </div>
      {error && <div className="err">{String(error.message)}</div>}
      {!data && !error && <Skeleton cards={9} panels={2} />}
      {data && s?.n > 0 && (
        <>
          <div className="cards" style={{ opacity: loading ? 0.6 : 1 }}>
            <Card i={0} k="Pairs compared" n={s.n} fmt={num} s={`avg wind ${mw(s.mean_actual)}`} />
            <Card i={1} hl k="MAE" n={s.mae} fmt={mw} s="typical miss" />
            <Card i={2} k="RMSE" n={s.rmse} fmt={mw} s="penalises big misses" />
            <Card i={3} k="MAPE" n={s.mape} fmt={pct} s="miss vs actual" />
            <Card i={4} hl k="Bias" n={s.bias} fmt={mw} s={s.bias > 0 ? "forecast above FUELHH on average" : "forecast below FUELHH on average"} />
            <Card i={5} k="P50 abs error" n={s.p50_abs_error} fmt={mw} />
            <Card i={6} k="P90 abs error" n={s.p90_abs_error} fmt={mw} s="bad-day miss" />
            <Card i={7} k="P99 abs error" n={s.p99_abs_error} fmt={mw} s="extreme miss" />
            <Card i={8} hl k={`${Math.round(s.band_coverage * 100)}% error band`} v={<><CountUp value={s.band_lo} format={num} /> … <CountUp value={s.band_hi} format={num} /></>} s="MW, forecast − actual" />
          </div>

          <p className="note">
            <b>Reading the bias:</b> actuals here are Elexon FUELHH wind, as specified. FUELHH reads about 19% (≈2.2 GW) lower than
            Elexon's other actual-wind series (B1630), so most of the positive bias is a coverage gap in the actuals, not forecast skill.
            Against B1630 the forecast bias is about −0.4 GW and MAE about 1.3 GW. See docs/BIAS_FINDINGS.md.
          </p>

          <div className="grid2">
            <Panel title="Error vs forecast horizon" sub="Miss size by how many hours ahead the forecast was published."
              how="Left = forecasts made close to delivery, right = made long before. If the bars rise to the right, fresher forecasts are worth waiting for. With 'decision-time only' the range is narrow (≈16–40 h) because the cutoff fixes the horizon; switch to 'every published forecast' to see the full picture.">
              <Chart><ComposedChart data={data.by_horizon} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="horizon_bin" {...AX} unit="h" /><YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={60} />
                <Tooltip formatter={(v, n) => [num(v) + " MW", n]} labelFormatter={(l) => `${l}–${l + 3} h ahead`} /><Legend />
                <Bar dataKey="mae" name="MAE" fill="var(--forecast)" {...ANIM} />
                <Line dataKey="p90_abs_error" name="P90 abs error" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} />
              </ComposedChart></Chart>
            </Panel>

            <Panel title="Error by hour of day (UK time)" sub="Bars: typical miss. Line: bias (positive = over-forecast)."
              how="Spot the hours when the forecast is least reliable (tall bars) or consistently leans one way (line far from zero). Those hours deserve a bigger safety margin.">
              <Chart><ComposedChart data={data.by_hour} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" {...AX} /><YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={60} />
                <Tooltip formatter={(v, n) => [num(v) + " MW", n]} labelFormatter={(l) => `${String(l).padStart(2, "0")}:00`} /><Legend />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <Bar dataKey="mae" name="MAE" fill="var(--forecast)" {...ANIM} />
                <Line dataKey="bias" name="Bias" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} />
              </ComposedChart></Chart>
            </Panel>

            <Panel title="Error distribution" sub="How often each size of miss happens (forecast − actual, 500 MW buckets)."
              how="Bars right of zero = forecast too high (you'd be short of wind). A peak that sits right of zero is bias. A long right tail is the risk of a big shortfall – the band in the cards above trims this to a planning range.">
              <Chart><BarChart data={data.histogram} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="bin_start" tickFormatter={kfmt} {...AX} unit=" GW" />
                <YAxis {...AX} width={40} />
                <Tooltip labelFormatter={(l) => `${num(l)} to ${num(l + 500)} MW`} formatter={(v) => [v, "periods"]} />
                <ReferenceLine x={0} stroke="var(--muted)" />
                <Bar dataKey="count" fill="var(--forecast)" {...ANIM} />
              </BarChart></Chart>
            </Panel>

            <Panel title="Forecast vs actual" sub={`${num(data.points.length)} points shown`}
              how="Each dot is one hour. Dots on the diagonal are perfect forecasts; dots below it mean the forecast was too high; above it, too low.">
              <Chart><ScatterChart margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="actual" name="Actual" tickFormatter={kfmt} {...AX} unit=" GW" domain={[0, "dataMax"]} />
                <YAxis type="number" dataKey="forecast" name="Forecast" tickFormatter={kfmt} {...AX} unit=" GW" width={60} domain={[0, "dataMax"]} />
                <ZAxis range={[14, 14]} />
                <Tooltip formatter={(v) => num(v) + " MW"} cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 22000, y: 22000 }]} stroke="var(--muted)" strokeDasharray="4 4" />
                <Scatter data={data.points} fill="var(--forecast)" fillOpacity={0.5} {...ANIM} />
              </ScatterChart></Chart>
            </Panel>
          </div>

          <Panel title="Forecast vs actual over time" sub="Hourly, in chronological order."
            how="Check whether the blue forecast follows the orange actual. Long stretches where blue sits above orange are the costly shortfall periods.">
            <Chart h={300}><LineChart data={data.points} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="start_time" tickFormatter={(t) => dayUK(t)} minTickGap={50} {...AX} />
              <YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={60} />
              <Tooltip labelFormatter={stampUK} formatter={(v, n) => [num(v) + " MW", n]} /><Legend />
              <Line dataKey="forecast" name="Forecast" stroke="var(--forecast)" dot={false} strokeWidth={1.5} {...ANIM} />
              <Line dataKey="actual" name="Actual" stroke="var(--actual)" dot={false} strokeWidth={1.5} {...ANIM} />
            </LineChart></Chart>
          </Panel>

          <Panel title="Error by day" sub="Daily MAE and bias."
            how="Shows whether the month was uniformly mediocre or dominated by a few bad days.">
            <Chart h={240}><ComposedChart data={data.by_day} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="day" tickFormatter={(d) => d.slice(8)} {...AX} /><YAxis tickFormatter={kfmt} {...AX} unit=" GW" width={60} />
              <Tooltip formatter={(v, n) => [num(v) + " MW", n]} /><Legend /><ReferenceLine y={0} stroke="var(--muted)" />
              <Bar dataKey="mae" name="MAE" fill="var(--forecast)" {...ANIM} />
              <Line dataKey="bias" name="Bias" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} />
            </ComposedChart></Chart>
          </Panel>
        </>
      )}
      {data && s?.n === 0 && <div className="err">No data for these filters.</div>}
    </>
  );
}
