import React, { useMemo, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { api } from "./api.js";
import { ANIM, Card, Chart, Panel, Skeleton, useAsync } from "./components.jsx";
import { gw, mw, num, pct, stampUK, timeUK } from "./format.js";

export default function DecisionView({ meta }) {
  const [day, setDay] = useState("2026-01-15");
  const [cutoff, setCutoff] = useState(""); // "" = backend default (lets the pre-computed file be used)
  const [coverage, setCoverage] = useState(0.8);
  const [bandBasis, setBandBasis] = useState("all");
  const [showActual, setShowActual] = useState(true);

  const { data, loading, error } = useAsync(
    () => api("decision", { day, cutoff, coverage, band_basis: bandBasis }),
    [day, cutoff, coverage, bandBasis]
  );

  // One row per half hour; forecast + band exist only on the hour (WINDFOR is hourly).
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

  // Tick every 3 hours on the hour (UK local).
  const ticks = series.filter((r) => timeUK(r.t).endsWith(":00") && +timeUK(r.t).slice(0, 2) % 3 === 0).map((r) => r.t);

  const b = data?.band;
  const real = data?.realised;
  return (
    <>
      <div className="controls">
        <label>Delivery day (D)
          <input type="date" value={day} min={meta?.first_day} max={meta?.last_day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
        <label>Decision cutoff (UK, D-1)
          <input type="time" value={cutoff || meta?.default_cutoff || ""} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
        </label>
        <label>Safety band
          <select value={coverage} onChange={(e) => setCoverage(+e.target.value)}>
            <option value={0.8}>80% (P10–P90)</option><option value={0.9}>90% (P5–P95)</option><option value={0.98}>98% (P1–P99)</option>
          </select>
        </label>
        <label>Band built from
          <select value={bandBasis} onChange={(e) => setBandBasis(e.target.value)}>
            <option value="all">All errors in window (in-sample)</option>
            <option value="prior">Only days known by cutoff (≤ D-2)</option>
          </select>
        </label>
        <label className="toggle"><input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />Show actuals</label>
      </div>

      {error && <div className="err">{String(error.message)}</div>}
      {!data && !error && <Skeleton cards={5} panels={1} />}
      {data && (
        <>
          <div className="cards">
            <Card i={0} hl k="Forecast used" v={stampUK(data.latest_publish_time)} s={`latest published ≤ ${data.cutoff_local} UK`} />
            <Card i={1} k="Average wind" n={data.forecast_mean} fmt={gw} s={`low ${gw(data.forecast_min)} · peak ${gw(data.forecast_peak)}`} />
            <Card i={2} hl k="Cover margin (shortfall)" n={b?.hi} fmt={mw} s={`${Math.round(b.coverage * 100)}%-band: actual may be this far below forecast`} />
            <Card i={3} k="Surplus risk" n={b?.lo == null ? null : Math.max(0, -b.lo)} v="–" fmt={mw} s="actual may be this far above forecast" />
            {showActual && real && <Card i={4} k="Realised MAE on this day" n={real.mae} fmt={mw} s={`bias ${mw(real.bias)} · MAPE ${pct(real.mape)}`} />}
          </div>

          <Panel
            title={`Wind forecast for ${data.day}`}
            sub="Latest forecast available at the cutoff, with the error band built from past forecast errors. All times UK local."
            how="The blue line is the forecast you could see when you had to decide. The shaded band is where wind has typically ended up (80% of the time by default). If you only buy up to the blue line you are exposed to the gap down to the bottom of the band; buying towards it costs more but covers a bad-wind day. The orange line (actuals) is only there to check afterwards how the forecast did."
          >
            <Chart h={380}>
                  <ComposedChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" ticks={ticks} tickFormatter={timeUK} stroke="var(--muted)" />
                    <YAxis tickFormatter={(v) => `${v / 1000}`} stroke="var(--muted)" label={{ value: "GW", angle: -90, position: "insideLeft", fill: "var(--muted)" }} />
                    <Tooltip labelFormatter={stampUK} formatter={(v, n) => [num(v) + " MW", n]} />
                    <Legend />
                    <Area dataKey="lower" stackId="b" stroke="none" fill="transparent" legendType="none" {...ANIM} name="band floor" />
                    <Area dataKey="band" stackId="b" stroke="none" fill="var(--band)" {...ANIM} name={`${Math.round((b?.coverage ?? 0.8) * 100)}% band`} connectNulls />
                    <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={2.5} dot={false} {...ANIM} name="Forecast" connectNulls />
                    {showActual && <Line dataKey="actual" stroke="var(--actual)" strokeWidth={2} dot={false} {...ANIM} name="Actual" />}
                  </ComposedChart>
                </Chart>
          </Panel>
          <p className="note">
            Band source: {b.n} historical forecast errors ({b.basis === "prior" ? "days up to D-2 only – no look-ahead" : "whole data window – in-sample, so slightly optimistic"}).
            Error band (forecast − actual): {mw(b.lo)} to {mw(b.hi)}.
          </p>
        </>
      )}
    </>
  );
}
