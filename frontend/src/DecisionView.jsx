import React, { useEffect, useMemo, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Customized } from "recharts";
import { api } from "./api.js";
import { ANIM, Callout, Card, Chart, CountUp, ErrorBox, Field, InfoTip, Panel, Pill, RangeBar, Skeleton, useAsync } from "./components.jsx";
import { CannotTell, LevelTable, MarginCheck, SeriesCaveat } from "./PlanPanels.jsx";
import { RampPanel, StabilityPanel } from "./Tier2Panels.jsx";
import { HowWrongPanel, ReplayPanel, TradeoffPanel, WhatIfPanel } from "./WhenWrong.jsx";
import { Icon } from "./icons.jsx";
import { gw, longDate, mw, num, oneIn, pct, pct0, stampUK, timeUK } from "./format.js";
import { LineLegend, LINES } from "./chartParts.jsx";

const DEFAULT_DAY = "2026-01-15"; // also hard-coded in index.html for the early preload
const PRESETS = [
  { ratio: 1, label: "Even", hint: "Shortfall and surplus cost the same" },
  { ratio: 3, label: "Usual", hint: "Shortfall costs 3 times a surplus" },
  { ratio: 9, label: "Careful", hint: "Shortfall costs 9 times a surplus" },
];
const coverOf = (r) => r / (r + 1);
const HOW_KEY = "wind-plan-how-open";
const readHow = () => { try { const v = localStorage.getItem(HOW_KEY); return v == null ? true : v === "1"; } catch { return true; } };
const saveHow = (open) => { try { localStorage.setItem(HOW_KEY, open ? "1" : "0"); } catch { /* storage unavailable: fine */ } };

function HowItWorks() {
  const [open, setOpen] = useState(readHow);
  const toggle = () => { setOpen((o) => { saveHow(!o); return !o; }); };
  const steps = [
    ["calendar", "Pick the day", "Choose the delivery day you are buying for."],
    ["clock", "See the latest forecast you could have seen", "Only forecasts published before your decide-by time are used."],
    ["sliders", "Choose how careful to be", "How much worse is running short than having a surplus?"],
    ["shield", "Read how much to keep in reserve", "The big number below is your answer."],
  ];
  return (
    <section className={`how-strip${open ? " open" : ""}`} aria-label="How this works">
      <button type="button" className="how-toggle" aria-expanded={open} aria-controls="how-steps" onClick={toggle}>
        <Icon name="listChecks" size={18} /><span>How this works</span><Icon name="chevronDown" size={18} className="chev" />
      </button>
      {open && (
        <ol id="how-steps" className="steps">
          {steps.map(([ic, t, d], i) => (
            <li key={t}><span className="step-n" aria-hidden="true">{i + 1}</span><span className="step-i"><Icon name={ic} size={18} /></span>
              <span><b>{t}</b><small>{d}</small></span></li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Plain-language hover text for one hour of the day chart. */
function PlainTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const line = (label, v) => (v == null ? null : <div><span>{label}</span> <b>{mw(v)}</b></div>);
  let verdict = null;
  if (r.forecast != null && r.actual != null) {
    const d = r.forecast - r.actual;
    verdict = Math.abs(d) < 1 ? "The forecast was right." : `The forecast was ${mw(Math.abs(d))} too ${d > 0 ? "high" : "low"}.`;
  }
  return (
    <div className="ctip">
      <div className="ctip-h">{stampUK(r.t)}</div>
      {line("Forecast", r.forecast)}
      {line("What actually happened", r.actual)}
      {verdict && <div className="ctip-v">{verdict}</div>}
      {line("Plan for", r.plan)}
      {r.lower != null && r.upper != null && <div><span>Usual range</span> <b>{mw(r.lower)} to {mw(r.upper)}</b></div>}
      {line("Your demand", r.demand)}
      {line("To buy, with cover", r.buyCover)}
      {r.forecast == null && r.actual != null && <div className="ctip-n">The forecast is hourly; this half hour shows the record only.</div>}
      {r.ramp && <div className="ctip-n">Ramp hour: the forecast changes fast here.</div>}
    </div>
  );
}

/** Direct labels at the right end of each line, pushed apart so they never overlap. */
function EndLabels({ xAxisMap, yAxisMap, data, keys }) {
  const xa = xAxisMap && Object.values(xAxisMap)[0], ya = yAxisMap && Object.values(yAxisMap)[0];
  if (!xa || !ya || !data?.length) return null;
  const items = [];
  for (const k of keys) {
    let i = data.length - 1;
    while (i >= 0 && data[i][k.key] == null) i--;
    if (i < 0) continue;
    const x = xa.scale(data[i].t) + (xa.scale.bandwidth ? xa.scale.bandwidth() / 2 : 0);
    items.push({ ...k, x: x + 6, y: ya.scale(data[i][k.key]) });
  }
  items.sort((a, b) => a.y - b.y);
  for (let j = 1; j < items.length; j++) if (items[j].y - items[j - 1].y < 14) items[j].y = items[j - 1].y + 14;
  return (
    <g className="end-labels">
      {items.map((it) => <text key={it.key} x={it.x} y={it.y} dy="0.35em" fill={it.color} fontSize="12" fontWeight="700">{it.short}</text>)}
    </g>
  );
}

export default function DecisionView({ meta }) {
  const [day, setDay] = useState(DEFAULT_DAY);
  const [cutoff, setCutoff] = useState(""); // "" = backend default (lets the pre-computed file be used)
  const [bandBasis, setBandBasis] = useState("prior");
  const [marginBy, setMarginBy] = useState("flat");
  const [ratio, setRatio] = useState(3);
  const [ratioInput, setRatioInput] = useState("3");
  const [demandInput, setDemandInput] = useState("");
  const [demand, setDemand] = useState("");
  const [showActual, setShowActual] = useState(true);
  const [rampInput, setRampInput] = useState("");
  const [rampMw, setRampMw] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [priceShort, setPriceShort] = useState("");
  const [priceUnused, setPriceUnused] = useState("");
  const [prices, setPrices] = useState({ s: "", u: "" });
  const [scenario, setScenario] = useState("pct20");
  const wide = typeof window !== "undefined" ? window.matchMedia?.("(min-width: 600px)").matches : true;

  // Only send typed numbers once the user pauses, and only if they are valid.
  const demandValid = demandInput === "" || (/^\d+(\.\d+)?$/.test(demandInput) && +demandInput <= 100000);
  useEffect(() => { const t = setTimeout(() => demandValid && setDemand(demandInput), 450); return () => clearTimeout(t); }, [demandInput, demandValid]);
  const rampValid = rampInput === "" || (/^\d+(\.\d+)?$/.test(rampInput) && +rampInput >= 100 && +rampInput <= 20000);
  useEffect(() => { const t = setTimeout(() => rampValid && setRampMw(rampInput), 450); return () => clearTimeout(t); }, [rampInput, rampValid]);
  const okPrice = (v) => /^\d+(\.\d+)?$/.test(v) && +v <= 10000;
  const pricesValid = (priceShort === "" && priceUnused === "") || (okPrice(priceShort) && okPrice(priceUnused));
  useEffect(() => { const t = setTimeout(() => pricesValid && setPrices({ s: priceShort, u: priceUnused }), 450); return () => clearTimeout(t); }, [priceShort, priceUnused, pricesValid]);
  const ratioValid = /^\d+(\.\d+)?$/.test(ratioInput) && +ratioInput >= 1 && +ratioInput <= 10;
  const setRatioBoth = (r) => { setRatio(r); setRatioInput(String(r)); };

  const params = { day, cutoff, band_basis: bandBasis, cost_ratio: ratio, margin_by: marginBy, demand, ramp_mw: rampMw };
  const { data, loading, error, retry } = useAsync(() => api("decision", params), [JSON.stringify(params)]);
  const replay = useAsync(() => api("replay", { cutoff, cost_ratio: ratio, margin_by: marginBy, price_short: prices.s, price_unused: prices.u }),
    [cutoff, ratio, marginBy, prices.s, prices.u]);
  const trade = useAsync(() => api("tradeoff", { cutoff, cost_ratio: ratio, margin_by: marginBy }), [cutoff, ratio, marginBy]);
  const check = useAsync(() => api("margin-check", { cutoff, cost_ratio: ratio, margin_by: marginBy }), [cutoff, ratio, marginBy]);

  const series = useMemo(() => {
    if (!data) return [];
    const by = new Map();
    for (const a of data.actual_series) by.set(a.start_time, { t: a.start_time, actual: a.actual });
    for (const r of data.rows) {
      const row = by.get(r.start_time) || { t: r.start_time };
      Object.assign(row, {
        forecast: r.forecast, lower: r.lower, band: r.upper == null || r.lower == null ? null : r.upper - r.lower, upper: r.upper,
        plan: r.plan, demand: data.demand ? data.demand.demand : undefined, buyCover: r.buy_cover ?? undefined,
        rampMark: r.ramp ? r.forecast : undefined, ramp: r.ramp,
      });
      by.set(r.start_time, row);
    }
    return [...by.values()].sort((a, b) => a.t.localeCompare(b.t));
  }, [data]);
  const ticks = series.filter((r) => timeUK(r.t).endsWith(":00") && +timeUK(r.t).slice(0, 2) % 3 === 0).map((r) => r.t);

  const b = data?.band, m = data?.margin, dm = data?.demand, real = data?.realised;
  const q = m?.q ?? coverOf(ratio);
  const missOneIn = Math.round(1 / (1 - q));
  const surplus = b && b.lo != null ? Math.max(0, -b.lo) : null;
  const plans = data ? data.rows.map((r) => r.plan).filter((v) => v != null) : [];
  const uppers = data ? data.rows.map((r) => r.upper).filter((v) => v != null) : [];
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mean = data?.forecast_mean;
  const peeks = data && m.basis === "all";

  const shown = [
    { ...LINES.forecast, on: true },
    { ...LINES.plan, on: !!m?.available },
    { ...LINES.actual, on: showActual },
    { ...LINES.demand, on: !!dm },
    { ...LINES.buy, on: !!dm && dm.avg_buy_cover != null },
  ].filter((l) => l.on);

  return (
    <>
      <HowItWorks />

      <div className="ctrl-grid">
        <section className="ctrl-card" aria-labelledby="c-when">
          <h2 id="c-when" className="ctrl-h"><Icon name="calendar" size={18} />When</h2>
          <Field label="Day you are buying for" hint={meta ? `Any day from ${longDate(meta.first_day)} to ${longDate(meta.last_day)}` : ""}>
            <input type="date" value={day} min={meta?.first_day} max={meta?.last_day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </Field>
          <Field label="Decide by (UK time, the day before)" term="decide-by" hint="Forecasts published after this are ignored. 09:00 is an assumption; set your own.">
            <input type="time" value={cutoff || meta?.default_cutoff || ""} onChange={(e) => e.target.value && setCutoff(e.target.value)} />
          </Field>
        </section>

        <section className="ctrl-card" aria-labelledby="c-careful">
          <h2 id="c-careful" className="ctrl-h"><Icon name="scale" size={18} />How careful<InfoTip term="cost-ratio" /></h2>
          <div className="seg" role="group" aria-label="How costly is running short?">
            {PRESETS.map((p) => (
              <button key={p.ratio} type="button" className={ratio === p.ratio ? "on" : ""} aria-pressed={ratio === p.ratio}
                title={p.hint} onClick={() => setRatioBoth(p.ratio)}>{p.label}</button>
            ))}
          </div>
          <div className="ratio-row">
            <label htmlFor="ratio-in">A shortfall costs</label>
            <input id="ratio-in" type="number" min="1" max="10" step="0.5" value={ratioInput} aria-invalid={!ratioValid} aria-describedby="ratio-say"
              onChange={(e) => { setRatioInput(e.target.value); const v = +e.target.value; if (e.target.value !== "" && v >= 1 && v <= 10) setRatio(v); }} />
            <span>times a surplus</span>
          </div>
          <p id="ratio-say" className={`say${ratioValid ? "" : " warn-text"}`} role={ratioValid ? "status" : "alert"}>
            {ratioValid ? <>With this setting you cover about <b>{pct0(coverOf(ratio) * 100)}</b> of hours.</> : "Enter a number from 1 to 10."}
          </p>
        </section>

        <section className="ctrl-card" aria-labelledby="c-yours">
          <h2 id="c-yours" className="ctrl-h"><Icon name="user" size={18} />Your numbers</h2>
          <Field label="Expected demand for the day (MW), optional" term="power-to-buy" hint="Your own number; the app has no demand data.">
            <input type="text" inputMode="decimal" placeholder="for example 25000" value={demandInput}
              onChange={(e) => setDemandInput(e.target.value.replace(/[,\s]/g, ""))} aria-invalid={!demandValid} />
            {!demandValid && <small className="warn-text" role="alert">Enter a number of MW from 0 to 100,000.</small>}
          </Field>
          <label className="check">
            <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
            <span>Show what actually happened<small>Untick to see only what you could have known.</small></span>
          </label>
        </section>
      </div>

      <details className="advanced" open={advOpen} onToggle={(e) => setAdvOpen(e.currentTarget.open)}>
        <summary><Icon name="sliders" size={18} /><span>Advanced settings</span>
          <span className="adv-now">{marginBy === "flat" ? "One margin" : "By wind level"} · {bandBasis === "prior" ? "only days already known" : "every day in the data"}</span>
          <Icon name="chevronDown" size={18} className="chev" /></summary>
        <div className="controls">
          <Field label="Margin" term="margin-by-level" hint="One margin for every hour is the default; it did as well overall in the fair check.">
            <select value={marginBy} onChange={(e) => setMarginBy(e.target.value)}>
              <option value="flat">Same for every hour</option>
              <option value="level">By wind level</option>
            </select>
          </Field>
          <Field label="Learn the margin from" term="learn-from" hint="“Only days already known” never uses the day being planned.">
            <select value={bandBasis} onChange={(e) => setBandBasis(e.target.value)}>
              <option value="prior">Only days already known</option>
              <option value="all">Every day in the data (uses the day being planned)</option>
            </select>
          </Field>
        </div>
      </details>

      <ErrorBox error={error} onRetry={retry} what="the plan for this day" />
      {!data && !error && <Skeleton cards={4} panels={1} />}
      {data && (
        <div className="results" style={{ opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
          {m.available ? (
            <section className="hero" aria-labelledby="hero-h">
              <p className="eyebrow">Your plan for {longDate(data.day)}</p>
              <h2 id="hero-h" className="hero-main">
                <span className="hero-icon"><Icon name="shield" size={28} /></span>
                <span>Keep about <span className="big"><CountUp value={m.avg} format={mw} /></span> in reserve<InfoTip term="margin" /></span>
              </h2>
              <div className="pills">
                {peeks
                  ? <Pill kind="peeks" text="Uses the day being planned" why="The margin is learned from every day in the data, including this one. Results can look better than you could have known. Switch to “Only days already known” in Advanced settings for a fair figure." />
                  : <Pill kind="fair" text="Only days already known" why={`Learned from ${num(m.n)} past hours whose results were complete before your deadline. Nothing from the day being planned is used.`} />}
              </div>
              <p className="lead">
                The latest forecast you could see (issued <b>{stampUK(data.latest_publish_time)}</b>) expects <b>{mw(mean)}</b> of wind on average.
                With a shortfall costing {ratio}× a surplus, the reserve covers about <b>{pct0(q * 100)}</b> of hours: in past results, wind fell below
                “forecast minus reserve” in about 1 hour in {missOneIn}.
                {m.method === "level" && m.min !== m.max ? ` By wind level it ranges from ${mw(m.min)} to ${mw(m.max)} across the day.` : ""}
              </p>
              <RangeBar low={avg(plans)} mid={mean} high={uppers.length ? avg(uppers) : mean}
                labels={{ low: "Plan for (weak-wind case)", mid: "Expected", high: "Strong-wind case" }} />
              <SeriesCaveat />
            </section>
          ) : (
            <section className="hero empty" aria-labelledby="hero-empty">
              <p className="eyebrow">Your plan for {longDate(data.day)}</p>
              <h2 id="hero-empty" className="hero-main"><span className="hero-icon"><Icon name="calendar" size={28} /></span>Not enough earlier days yet</h2>
              <p className="lead">
                A reserve is worked out from how wrong the forecast was on earlier days. For {longDate(data.day)}, only {num(m.n)} hours of results
                were complete before your deadline, and at least {m.min_n} are needed. This happens for the first days of January (2 to 4 January).
              </p>
              <button type="button" className="btn primary" onClick={() => { setBandBasis("all"); setAdvOpen(true); }}>
                <Icon name="refresh" size={18} />Use every day in the data instead
              </button>
              <p className="note top-gap">That option uses the day being planned, so the result is less fair. The forecast itself is still shown below.</p>
            </section>
          )}

          <div className="cards">
            <Card i={0} icon="clock" term="forecast-issued" k="Forecast issued" v={stampUK(data.latest_publish_time)} s="The newest forecast before your decide-by time" />
            <Card i={1} icon="wind" term="expected-wind" k="Expected wind (day average)" n={mean} fmt={mw} s={`That is about ${gw(mean)}`} />
            <Card i={2} hl icon="shield" term="margin" k="Extra to keep in reserve" n={m.available ? m.avg : null} v="–" fmt={mw}
              s={m.available ? `Covers about ${pct0(q * 100)} of hours` : "Not enough earlier days yet"} />
            <Card i={3} icon="trendingUp" term="strong-wind" k="If wind is stronger than forecast" n={surplus} v="–" fmt={mw}
              s={b?.coverage ? `Could be this much above forecast (1 hour in ${oneIn(b.coverage)})` : "Not enough earlier days yet"} />
            {dm && (
              <>
                <Card i={4} hl icon="zap" term="power-to-buy" k="Power to buy beyond wind (day average)" n={dm.avg_buy} fmt={mw}
                  s={`${num(dm.buy_mwh)} MWh over the day: your ${mw(dm.demand)} minus forecast wind`} />
                <Card i={5} hl icon="shield" term="power-to-buy" k="To buy, with weak-wind cover" n={dm.avg_buy_cover} v="–" fmt={mw}
                  s={dm.avg_buy_cover == null ? "No reserve yet for this day and setting" : `${num(dm.buy_cover_mwh)} MWh over the day, covering about ${pct0(q * 100)} of hours`} />
              </>
            )}
            {showActual && real && (
              <Card i={6} wide icon="checkCircle" term="actual" k="What actually happened" n={real.mean_actual} fmt={mw}
                s={`Forecast was off by ${mw(real.mae)} on average (${pct(real.mape)} of wind) and ${real.bias > 0 ? "too high" : "too low"} overall`} />
            )}
          </div>
          {dm && (
            <Callout title="Demand is your own number; the app has no demand data.">
              Power to buy = your demand minus forecast wind, hour by hour. Hours where forecast wind alone is above your demand count as zero
              {dm.spare_hours ? ` (${dm.spare_hours} hour${dm.spare_hours === 1 ? "" : "s"} on this day)` : " (none on this day)"}.
            </Callout>
          )}

          <Panel icon="lineChart" title="Wind through the day" term="forecast"
            headline={m.available
              ? `The forecast averages ${mw(mean)}; the plan-for line sits ${mw(m.avg)} lower on average.`
              : `The forecast averages ${mw(mean)}. No plan-for line yet: there are not enough earlier days.`}
            sub="Hour by hour, UK time. Power in GW (1 GW = 1,000 MW)."
            how="Each line has its own style, so you can tell them apart without colour. Hover or tap an hour to read the values in words. Dots mark ramp hours.">
            <Chart h={400} label={m.available ? `Day chart: forecast averaging ${mw(mean)}, plan-for line ${mw(m.avg)} lower on average.` : `Day chart: forecast averaging ${mw(mean)}.`}>
              <ComposedChart data={series} margin={{ top: 8, right: wide ? 92 : 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="t" ticks={ticks} tickFormatter={timeUK} tickMargin={10} stroke="var(--muted)" />
                <YAxis tickFormatter={(v) => `${v / 1000}`} unit=" GW" stroke="var(--muted)" width={78} />
                <Tooltip content={<PlainTip />} />
                <Area dataKey="lower" stackId="b" stroke="none" fill="transparent" {...ANIM} name="range floor" />
                <Area dataKey="band" stackId="b" stroke="none" fill="var(--band)" {...ANIM} name="Usual range" connectNulls />
                {shown.map((l) => (
                  <Line key={l.key} dataKey={l.key} stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash} strokeLinecap="round"
                    dot={false} {...ANIM} name={l.name} connectNulls={l.key !== "actual"} />
                ))}
                {data.ramps?.hours_today > 0 && <Line dataKey="rampMark" stroke="none" isAnimationActive={false}
                  dot={{ r: 5, fill: "var(--ramp)", stroke: "var(--panel)", strokeWidth: 2 }} activeDot={false} name="Ramp hour" />}
                {wide && <Customized component={(p) => <EndLabels {...p} data={series} keys={shown} />} />}
              </ComposedChart>
            </Chart>
            <LineLegend items={[...shown, { key: "band", name: "Usual range (8 hours in 10)", swatch: "band" },
              ...(data.ramps?.hours_today > 0 ? [{ key: "ramp", name: "Ramp hour", swatch: "dot" }] : [])]} />
          </Panel>

          <HowWrongPanel hw={data.how_wrong} />
          <WhatIfPanel wi={data.what_if} scenario={scenario} setScenario={setScenario} hasDemand={!!dm} dayRows={data.rows} />
          <LevelTable margin={m} ratio={ratio} />
          <RampPanel ramps={data.ramps} rampInput={rampInput} setRampInput={setRampInput} rampValid={rampValid} />
          <StabilityPanel stability={data.stability} />
          <MarginCheck check={check.data} ratio={ratio} />
          <ErrorBox error={check.error} onRetry={check.retry} what="the margin check" />
          <ReplayPanel rp={replay.data} ratio={ratio} priceShort={priceShort} setPriceShort={setPriceShort}
            priceUnused={priceUnused} setPriceUnused={setPriceUnused} pricesValid={pricesValid} />
          <ErrorBox error={replay.error} onRetry={replay.retry} what="the replay of your plan" />
          <TradeoffPanel tr={trade.data} />
          <ErrorBox error={trade.error} onRetry={trade.retry} what="the backup trade-off" />
          <CannotTell />
        </div>
      )}
    </>
  );
}
