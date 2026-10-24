import React from "react";
import { BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip } from "recharts";
import { ANIM, Callout, Card, Chart, Field, Panel, Pill } from "./components.jsx";
import { SeriesCaveat } from "./PlanPanels.jsx";
import { LineLegend } from "./chartParts.jsx";
import { longDate, mw, num, pct0 } from "./format.js";

const LEVEL_NAME = { low: "Low wind", mid: "Medium wind", high: "High wind" };
const in100 = (s) => (s == null ? "–" : `${Math.round(s * 100)} in 100`);
const mwh = (v) => (v == null ? "–" : `${num(v)} MWh`);
const gbp = (v) => (v == null ? "–" : `£${num(v)}`);
const range = (l) => (l.forecast_from == null ? `forecast up to ${mw(l.forecast_to)}` : l.forecast_to == null ? `forecast above ${mw(l.forecast_from)}` : `forecast ${mw(l.forecast_from)} to ${mw(l.forecast_to)}`);
const HEAD_STEP = 2000;

/** Feature 1: how often, in past known hours, wind ended far below (or above) the forecast. */
export function HowWrongPanel({ hw }) {
  if (!hw.available) {
    return (
      <Panel icon="trendingDown" term="shortfall" title="How wrong can the forecast be?"
        headline="Not enough earlier days yet to say."
        pills={<Pill kind="small" text="Small sample" why={`Needs at least ${hw.min_n} known hours; only ${hw.all.n_hours} were known before this day.`} />}>
        <p className="note">This table needs at least {hw.min_n} hours of results known before your deadline. Pick a day from 5 January onwards.</p>
      </Panel>
    );
  }
  const k = hw.steps.indexOf(HEAD_STEP);
  const dayRow = hw.levels.find((l) => l.level === hw.day_level);
  const use = dayRow && !dayRow.too_few ? dayRow : hw.all;
  const anyFew = hw.levels.some((l) => l.too_few);
  const headline = dayRow
    ? (dayRow.too_few
      ? `Too few known hours with a forecast like this day’s to tell. Across all known hours, wind ended more than ${mw(HEAD_STEP)} below the forecast in about ${Math.round(hw.all.below[k] * 100)} hours out of 100.`
      : `When the forecast was this high (${LEVEL_NAME[dayRow.level].toLowerCase()}, like this day’s average), wind ended more than ${mw(HEAD_STEP)} below it in about ${Math.round(use.below[k] * 100)} hours out of 100.`)
    : `Wind ended more than ${mw(HEAD_STEP)} below the forecast in about ${Math.round(hw.all.below[k] * 100)} hours out of 100.`;
  const table = (side, title) => (
    <>
      <h4 className="tbl-h">{title}</h4>
      <table className="rt">
        <thead><tr><th>Past hours</th>{hw.steps.map((s) => <th key={s}>more than {mw(s)}</th>)}</tr></thead>
        <tbody>
          {[{ ...hw.all, level: "all" }, ...hw.levels].map((r) => (
            <tr key={r.level} className={r.level === hw.day_level ? "total" : ""}>
              <td data-label="Past hours">
                <b>{r.level === "all" ? "All known hours" : LEVEL_NAME[r.level]}</b>
                <small>{r.level === "all" ? "every forecast level" : range(r)}</small>
                <small>{num(r.n_hours)} hours on {r.n_days} days{r.level === hw.day_level ? " · like this day" : ""}</small>
                {r.too_few && <small className="warn-text">too few to tell: all-hours figures shown</small>}
              </td>
              {hw.steps.map((s, i) => (
                <td key={s} data-label={`more than ${mw(s)}`}>{in100((r.too_few ? hw.all : r)[side][i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
  return (
    <Panel icon="trendingDown" term="shortfall" title="How wrong can the forecast be?" headline={headline}
      pills={<>
        <Pill kind="fair" text="Only days already known" why={`Counted from ${num(hw.all.n_hours)} hours on ${hw.all.n_days} days whose results were complete before your deadline.`} />
        {anyFew && <Pill kind="small" text="Small sample" why={`At least one forecast level has fewer than ${hw.min_n} known hours, so it shows the all-hours figures instead.`} />}
      </>}
      sub="How often, in past hours, the wind ended far from the forecast. Split by how much wind was forecast, using the same three groups as the margin."
      how="Read along a row: “30 in 100” under “more than 2,000 MW” means that in 30 of every 100 such hours, wind ended more than 2,000 MW below (or above) the forecast. The highlighted row is the forecast level of the day you picked.">
      {table("below", "Wind ended BELOW the forecast (you would be short) by")}
      {table("above", "Wind ended ABOVE the forecast (spare wind) by")}
      <p className="note top-gap">
        Hours within one day move together, so a level that rests on only a few days is a rough guide. These are past shares, not a promise for tomorrow.
      </p>
      <SeriesCaveat />
    </Panel>
  );
}

/** Feature 4: replay the plan over every past day, with the reserve each day would really have had. */
export function ReplayPanel({ rp, priceShort, setPriceShort, priceUnused, setPriceUnused, pricesValid, ratio }) {
  if (!rp) return null;
  const t = rp.totals;
  const data = rp.days.map((d) => ({ ...d, label: d.day.slice(8), short: d.margin_known ? d.short_mwh : null, unused: d.margin_known ? d.unused_mwh : null }));
  const none = rp.days.filter((d) => !d.margin_known);
  return (
    <Panel icon="history" term="unused-reserve" title="If you had followed this plan"
      headline={t.days_with_margin
        ? `Over ${t.days_with_margin} days, you would have been short by ${mwh(t.short_mwh)} in total and held ${mwh(t.unused_mwh)} of reserve you did not need; ${pct0(t.covered_share * 100)} of hours were covered.`
        : "No day had enough earlier results to work out a reserve."}
      pills={<Pill kind="fair" text="No hindsight" why="Each day uses only the reserve that could have been worked out at its own deadline, from days already known." />}
      sub={`Each past day replayed with the reserve it would really have had (shortfall costs ${ratio}× a surplus, your current setting). Every hour counts once, because the forecast is hourly.`}
      how="Short is wind you would have had to buy at the last minute because it fell below the forecast by more than your reserve. Unused reserve is reserve you held but did not need. A bigger reserve lowers the first and raises the second.">
      <div className="cards">
        <Card icon="trendingDown" term="shortfall" k="Short, not covered by the reserve" v={mwh(t.short_mwh)} s={`Total over ${t.days_with_margin} days`} />
        <Card icon="shield" term="unused-reserve" k="Unused reserve" v={mwh(t.unused_mwh)} s="Reserve held but not needed" />
        <Card icon="checkCircle" term="covered-share" k="Covered share of hours" v={t.covered_share == null ? "–" : `${pct0(t.covered_share * 100)}`} s={`${num(t.hours)} hours checked`} />
        {t.cost != null && <Card hl icon="scale" term="shortfall" k="Cost with your prices" v={gbp(t.cost)} s="Short × your shortfall price + unused × your unused-reserve price" />}
      </div>
      <div className="controls narrow2">
        <Field label="Your shortfall price (£ per MWh), optional" hint="Your own number; the app has no price data.">
          <input type="text" inputMode="decimal" placeholder="for example 200" value={priceShort} aria-invalid={!pricesValid}
            onChange={(e) => setPriceShort(e.target.value.replace(/[,\s£]/g, ""))} />
        </Field>
        <Field label="Your unused-reserve price (£ per MWh), optional" hint="Your own number; the app has no price data.">
          <input type="text" inputMode="decimal" placeholder="for example 20" value={priceUnused} aria-invalid={!pricesValid}
            onChange={(e) => setPriceUnused(e.target.value.replace(/[,\s£]/g, ""))} />
        </Field>
      </div>
      {!pricesValid && <p className="warn-text" role="alert">Enter both prices as numbers from 0 to 10,000, or leave both empty.</p>}
      {t.cost != null && (
        <Callout title="Prices are your own numbers; the app has no price data.">
          Cost = short × {gbp(rp.prices.short)} + unused reserve × {gbp(rp.prices.unused)} per MWh, for the {t.days_with_margin} days with a known reserve.
        </Callout>
      )}
      <Chart h={260} label={`Bar chart by day: short and unused reserve in MWh. ${none.length} days without a known reserve.`}
        caption="Across: delivery day. Up: energy in MWh. Days with no bars had no reserve known yet.">
        <BarChart data={data} margin={{ left: 0, right: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="var(--muted)" />
          <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} stroke="var(--muted)" width={52} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload;
            return (
              <div className="ctip">
                <div className="ctip-h">{longDate(r.day)}</div>
                {r.margin_known ? (
                  <>
                    <div><span>Reserve held</span> <b>{mw(r.reserve_avg)}</b></div>
                    <div><span>Short</span> <b>{mwh(r.short_mwh)}</b> <span>({r.short_hours} hours)</span></div>
                    <div><span>Unused reserve</span> <b>{mwh(r.unused_mwh)}</b></div>
                    <div className="ctip-v">{pct0(r.covered_share * 100)} of hours covered</div>
                    {r.cost != null && <div><span>Cost with your prices</span> <b>{gbp(r.cost)}</b></div>}
                  </>
                ) : <div className="ctip-n">No reserve known yet: too few earlier days.</div>}
              </div>
            );
          }} />
          <Bar dataKey="short" name="Short" fill="var(--actual)" {...ANIM} />
          <Bar dataKey="unused" name="Unused reserve" fill="var(--forecast)" fillOpacity={0.45} {...ANIM} />
        </BarChart>
      </Chart>
      <LineLegend items={[{ key: "s", name: "Short (not covered)", swatch: "bar", color: "var(--actual)" },
        { key: "u", name: "Unused reserve", swatch: "bar", color: "var(--forecast)", opacity: 0.45 }]} />
      <details className="advanced top-gap">
        <summary><span>Day-by-day table</span><span className="adv-now">{rp.days.length} days, {none.length} without a known reserve</span></summary>
        <div className="tbl-pad">
          <table className="rt">
            <thead><tr><th>Day</th><th>Reserve held</th><th>Short</th><th>Unused reserve</th><th>Covered</th>{t.cost != null && <th>Cost (your prices)</th>}</tr></thead>
            <tbody>
              {rp.days.map((d) => (
                <tr key={d.day}>
                  <td data-label="Day"><b>{longDate(d.day)}</b></td>
                  {d.margin_known ? (
                    <>
                      <td data-label="Reserve held">{mw(d.reserve_avg)}</td>
                      <td data-label="Short">{mwh(d.short_mwh)}</td>
                      <td data-label="Unused reserve">{mwh(d.unused_mwh)}</td>
                      <td data-label="Covered">{pct0(d.covered_share * 100)}</td>
                      {t.cost != null && <td data-label="Cost">{gbp(d.cost)}</td>}
                    </>
                  ) : (
                    <td data-label="Status" colSpan={t.cost != null ? 5 : 4}><span className="muted">No reserve known yet ({d.known_hours} earlier hours; 30 needed)</span></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <SeriesCaveat />
    </Panel>
  );
}

/** Feature 2: a what-if (not a prediction): wind comes in below the forecast by a set amount. */
export function WhatIfPanel({ wi, scenario, setScenario, hasDemand, dayRows }) {
  const chosen = wi.scenarios.find((s) => s.id === scenario);
  const fellBack = !chosen || !chosen.available;
  const sc = fellBack ? wi.scenarios.find((s) => s.id === "pct20") : chosen;   // e.g. "a bad hour" needs known days
  const opts = wi.scenarios.map((s) => ({ id: s.id, label: s.id === "bad_hour" ? "A bad hour" : `${s.id.slice(3)}% less`, ok: s.available }));
  const day = sc.available ? sc.day : null;
  const series = sc.available ? sc.per_hour.map((h, i) => ({ ...h, t: dayRows[i]?.start_time })) : [];
  const what = sc.id === "bad_hour"
    ? `If wind came in ${mw(wi.bad_hour.mw)} below the forecast every hour (a bad hour from past results)`
    : `If wind came in ${sc.id.slice(3)}% below the forecast all day`;
  return (
    <Panel icon="alert" term="what-if" title="What if wind is lower than forecast?"
      headline={day ? (wi.reserve_known
        ? `${what}, you would be short by ${mwh(day.drop_mwh)}; your reserve would cover ${mwh(day.covered_mwh)}, leaving ${mwh(day.left_mwh)} to buy at the last minute.`
        : `${what}, you would be short by ${mwh(day.drop_mwh)}. No reserve is known yet for this day, so all of it would be bought at the last minute.`)
        : "A bad hour cannot be worked out yet: too few earlier days."}
      pills={<>
        <Pill kind="info" text="What if, not a prediction" why="This shows what would happen if wind fell short by the chosen amount. It does not say that it will." />
        {!wi.bad_hour.available && <Pill kind="small" text="Small sample" why={`The bad hour needs at least ${wi.bad_hour.min_n} known hours; only ${wi.bad_hour.n_hours} are known before this day.`} />}
      </>}
      sub="Pick how far below the forecast the wind comes in. The reserve is the one worked out from days already known at your deadline."
      how="The orange part of each bar is what you would have to buy at the last minute; the blue part is what your reserve already covers. Hours with no orange are fully covered.">
      <div className="seg seg-wide" role="group" aria-label="How far below the forecast">
        {opts.map((o) => (
          <button key={o.id} type="button" className={sc.id === o.id ? "on" : ""} aria-pressed={sc.id === o.id} disabled={!o.ok}
            onClick={() => setScenario(o.id)}>{o.label}</button>
        ))}
      </div>
      {fellBack && scenario !== "pct20" && <p className="note top-gap warn-text">“A bad hour” needs at least {wi.bad_hour.min_n} known hours, and only {wi.bad_hour.n_hours} are known before this day, so the 20% what-if is shown.</p>}
      {wi.bad_hour.available && <p className="note top-gap">“A bad hour” is the bad-hour miss from {num(wi.bad_hour.n_hours)} known hours on {wi.bad_hour.n_days} days: {mw(wi.bad_hour.mw)}.</p>}
      {!wi.same_reserve_as_plan && wi.reserve_known && (
        <p className="note">Your plan above learns from every day in the data; this what-if uses the reserve from days already known ({mw(wi.reserve_avg)} on average), so nothing from the day being planned is used.</p>
      )}
      {day && (
        <>
          <div className="cards">
            <Card icon="trendingDown" term="shortfall" k="Wind below the forecast" v={mwh(day.drop_mwh)} s={`${mw(day.avg_drop)} per hour on average`} />
            <Card icon="shield" term="margin" k="Covered by your reserve" v={wi.reserve_known ? mwh(day.covered_mwh) : "–"}
              s={wi.reserve_known ? `${pct0((day.covered_share_of_drop ?? 0) * 100)} of the shortfall` : "No reserve known yet"} />
            <Card hl icon="zap" term="shortfall" k="Left to buy at the last minute" v={mwh(day.left_mwh)}
              s={day.hours_left ? `${day.hours_left} hour${day.hours_left === 1 ? "" : "s"} short, up to ${mw(day.max_left)} in one hour` : "Every hour covered"} />
            {hasDemand && sc.demand && (
              <Card icon="scale" term="power-to-buy" k="Extra to buy (your demand)" v={mwh(sc.demand.extra_mwh)}
                s={`Power to buy beyond wind rises from ${mw(sc.demand.buy_avg_forecast)} to ${mw(sc.demand.buy_avg_what_if)} on average`} />
            )}
          </div>
          <Chart h={240} label={`What-if chart: ${mwh(day.covered_mwh)} covered by the reserve, ${mwh(day.left_mwh)} left to buy.`}
            caption="Across: hour of the day (UK time). Up: MW below the forecast in this what-if.">
            <BarChart data={series} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tickFormatter={(t) => (t ? t.slice(11, 13) : "")} stroke="var(--muted)" interval={2} />
              <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(1)}`} unit=" GW" stroke="var(--muted)" width={66} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload;
                return (
                  <div className="ctip">
                    <div className="ctip-h">{r.t ? `${r.t.slice(11, 16)} UK time` : ""}</div>
                    <div><span>What-if wind</span> <b>{mw(r.wind)}</b></div>
                    <div><span>Below the forecast by</span> <b>{mw(r.drop)}</b></div>
                    <div><span>Covered by the reserve</span> <b>{mw(r.covered)}</b></div>
                    <div className="ctip-v">{r.left > 0 ? `${mw(r.left)} to buy at the last minute` : "Fully covered"}</div>
                  </div>
                );
              }} />
              <Bar dataKey="covered" stackId="w" fill="var(--forecast)" fillOpacity={0.55} {...ANIM} name="Covered by reserve" />
              <Bar dataKey="left" stackId="w" fill="var(--actual)" {...ANIM} name="Left to buy" />
            </BarChart>
          </Chart>
          <LineLegend items={[{ key: "c", name: "Covered by your reserve", swatch: "bar", color: "var(--forecast)", opacity: 0.55 },
            { key: "l", name: "Left to buy at the last minute", swatch: "bar", color: "var(--actual)" }]} />
        </>
      )}
      <SeriesCaveat />
    </Panel>
  );
}

/** Feature 3: the trade-off between covering more bad hours and holding more unused reserve. No recommendation. */
export function TradeoffPanel({ tr }) {
  if (!tr) return null;
  const rows = tr.rows;
  const cur = rows.find((r) => r.ratio === tr.current_ratio);
  const lo = rows[0], hi = rows[rows.length - 1];
  const pts = rows.map((r) => ({ ...r, x: r.avg_unused, y: r.covered_share * 100, current: r.ratio === tr.current_ratio }));
  const name = (r) => (r.ratio === 1 ? "Even (1×)" : r.ratio === 3 ? "Usual (3×)" : r.ratio === 9 ? "Careful (9×)" : `${num(r.ratio, 1)}×`);
  return (
    <Panel icon="scale" term="backup-tradeoff" title="How much backup is worth it?"
      headline="More backup covers more bad hours but leaves more reserve unused. The choice depends on your own costs."
      pills={<Pill kind="fair" text="No hindsight" why={`Each setting is replayed day by day with the reserve known at each deadline: ${num(cur?.hours ?? lo.hours)} hours on ${cur?.days ?? lo.days} days.`} />}
      sub={`Every past day replayed with each cost setting (${num(lo.hours)} hours on ${lo.days} days; the first days have no reserve known yet).`}
      how="Each point is one setting. Moving right means holding more reserve that turns out unused; moving up means more hours covered. The ringed point is your current setting. The app does not pick a point for you.">
      <p className="lead">
        From {name(lo)} to {name(hi)}, the share of hours covered rises from <b>{pct0(lo.covered_share * 100)}</b> to <b>{pct0(hi.covered_share * 100)}</b>,
        while the reserve left unused rises from <b>{mw(lo.avg_unused)}</b> to <b>{mw(hi.avg_unused)}</b> per hour on average,
        and the remaining shortfall falls from {mw(lo.avg_short)} to {mw(hi.avg_short)} per hour.
      </p>
      <Chart h={280} label={`Trade-off chart: covered share from ${pct0(lo.covered_share * 100)} to ${pct0(hi.covered_share * 100)} as unused reserve rises from ${mw(lo.avg_unused)} to ${mw(hi.avg_unused)}.`}
        caption="Across: unused reserve, MW per hour on average. Up: share of hours covered (%).">
        <ScatterChart margin={{ left: 0, right: 24, top: 12, bottom: 6 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" stroke="var(--muted)" tickFormatter={(v) => `${(v / 1000).toFixed(1)}`} unit=" GW" domain={[0, "dataMax + 300"]} />
          <YAxis type="number" dataKey="y" stroke="var(--muted)" unit="%" width={52} domain={[0, 100]} />
          <ZAxis range={[90, 90]} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload;
            return (
              <div className="ctip">
                <div className="ctip-h">{name(r)}{r.current ? " · your setting" : ""}</div>
                <div><span>Average reserve</span> <b>{mw(r.avg_reserve)}</b></div>
                <div><span>Hours covered</span> <b>{pct0(r.covered_share * 100)}</b> <span>(aim {pct0(r.aim * 100)})</span></div>
                <div><span>Unused reserve</span> <b>{mw(r.avg_unused)}</b> <span>per hour</span></div>
                <div><span>Still short</span> <b>{mw(r.avg_short)}</b> <span>per hour</span></div>
              </div>
            );
          }} />
          <Scatter data={pts} line={{ stroke: "var(--muted)", strokeDasharray: "4 4" }} {...ANIM}
            shape={(p) => (
              <g>
                {p.payload.current && <circle cx={p.cx} cy={p.cy} r={13} fill="none" stroke="var(--accent)" strokeWidth={3} />}
                <circle cx={p.cx} cy={p.cy} r={6} fill="var(--forecast)" stroke="var(--panel)" strokeWidth={2} />
              </g>
            )} />
        </ScatterChart>
      </Chart>
      <LineLegend items={[{ key: "p", name: "One cost setting", swatch: "dot", color: "var(--forecast)" }, { key: "c", name: "Ringed: your current setting", swatch: "ring" }]} />
      <table className="rt top-gap">
        <thead><tr><th>Shortfall costs</th><th>Average reserve</th><th>Hours covered (aim)</th><th>Unused reserve per hour</th><th>Still short per hour</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ratio} className={r.ratio === tr.current_ratio ? "total" : ""}>
              <td data-label="Shortfall costs"><b>{name(r)}</b>{r.ratio === tr.current_ratio && <small>your current setting</small>}</td>
              <td data-label="Average reserve">{mw(r.avg_reserve)}</td>
              <td data-label="Hours covered">{pct0(r.covered_share * 100)} ({pct0(r.aim * 100)})</td>
              <td data-label="Unused per hour">{mw(r.avg_unused)}</td>
              <td data-label="Still short per hour">{mw(r.avg_short)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note top-gap">Based on {num(lo.hours)} hours on {lo.days} days. Hours within a day move together, so treat small differences as rough.</p>
      <SeriesCaveat />
    </Panel>
  );
}
