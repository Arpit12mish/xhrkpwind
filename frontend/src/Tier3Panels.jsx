import React from "react";
import { Callout, Panel, Pill } from "./components.jsx";
import { SeriesCaveat } from "./PlanPanels.jsx";
import { mw, num, pct0, smw } from "./format.js";

const chance = (p) => (p == null ? "" : p < 0.01 ? "less than 1 time in 100" : `about ${Math.round(p * 100)} times in 100`);

/** Tier 3: forecast against a naive "same hour, earlier day" guess. */
export function BaselinePanel({ b }) {
  if (!b) return null;
  const [fair, yday] = b.guesses;
  if (!fair || !fair.n) return <Panel icon="dice" term="simple-guess" title="Is the forecast better than a simple guess?"><p className="note">No hours to compare for these choices.</p></Panel>;
  const verdict = (s) => (s > 0 ? `${pct0(s * 100)} better` : s < 0 ? `${pct0(-s * 100)} worse` : "no better");
  return (
    <Panel icon="dice" term="simple-guess" title="Is the forecast better than a simple guess?"
      headline={fair.skill_mae > 0 ? `Yes: the forecast’s typical miss is ${pct0(fair.skill_mae * 100)} smaller than the simple guess.` : `No: the simple guess did ${verdict(fair.skill_mae)} than the forecast here.`}
      pills={<Pill kind="fair" text="Fair comparison" why="The main guess uses only data known at your deadline (the same hour two days earlier), and both are judged on the same hours." />}
      sub="The simplest possible forecast: tomorrow’s wind will be what it was at the same hour on the latest day you already know."
      how="If the real forecast were not clearly better than this guess, it would not be worth paying attention to. “Better by” is how much smaller the forecast’s typical miss is.">
      <p className="lead">
        The guess “same hour two days earlier” (the latest full day known at your deadline) was off by <b>{mw(fair.guess_mae)}</b> on average.
        The forecast was off by <b>{mw(fair.forecast_mae)}</b> on the same {num(fair.n)} hours: <b>{verdict(fair.skill_mae)}</b>.
      </p>
      <table className="rt">
        <thead><tr><th>Simple guess</th><th>Known at your deadline?</th><th>Typical miss of the guess</th><th>Forecast better by</th></tr></thead>
        <tbody>
          <tr><td data-label="Simple guess"><b>Same hour, two days earlier</b></td><td data-label="Known at deadline">Yes</td>
            <td data-label="Guess miss">{mw(fair.guess_mae)}</td><td data-label="Forecast better by"><b>{verdict(fair.skill_mae)}</b></td></tr>
          <tr><td data-label="Simple guess"><b>Same hour, yesterday</b><small>a tougher, unfair comparison</small>
              <Pill kind="peeks" text="Unfair" why="At a 09:00 deadline most of yesterday has not happened yet, so you could not have made this guess. It is shown only as a tougher test." /></td><td data-label="Known at deadline">No (most of yesterday has not happened yet)</td>
            <td data-label="Guess miss">{mw(yday.guess_mae)}</td><td data-label="Forecast better by">{verdict(yday.skill_mae)}</td></tr>
        </tbody>
      </table>
      <p className="note top-gap">
        Both guesses are judged on exactly the same {num(fair.n)} hours
        {b.hours_without_guess ? ` (${num(b.hours_without_guess)} hours left out because the earlier day is outside the data)` : ""}.
        The guesses use the wind record itself, so unlike the forecast they do not suffer from the record-keeping gap below; the forecast wins anyway.
        Typical misses use the forecast as published, with no adjustment.
      </p>
      <SeriesCaveat />
    </Panel>
  );
}

/** Tier 3: weekdays vs weekends, with the sample-size rule. */
export function DayTypePanel({ p }) {
  if (!p) return null;
  const by = Object.fromEntries(p.groups.map((g) => [g.day_type, g]));
  const small = p.groups.filter((g) => g.days < p.min_days);
  return (
    <Panel icon="calendarRange" term="weekday-weekend" title="Weekdays and weekends"
      headline={small.length ? "Too few days to tell weekdays and weekends apart." : (p.test.p != null && p.test.p < 0.05 ? "Weekdays and weekends differ." : "No clear difference between weekdays and weekends.")}
      pills={small.length ? <Pill kind="small" text="Small sample" why={`Fewer than ${p.min_days} days in at least one group. Hours within a day move together, so hours do not count as separate evidence.`} /> : null}
      sub="Wind does not know what day it is, but forecasting and record-keeping routines might."
      how="Compare the typical miss on weekdays and weekends. The note says whether there are enough days to tell them apart.">
      <table className="rt">
        <thead><tr><th>Days</th><th>Days counted</th><th>Hours</th><th>Typical miss</th><th>Leans high (+) or low (−)</th><th>Bad-hour miss</th></tr></thead>
        <tbody>
          {["weekday", "weekend"].map((k) => by[k] && (
            <tr key={k}>
              <td data-label="Days"><b>{k === "weekday" ? "Weekdays" : "Weekends"}</b></td>
              <td data-label="Days counted">{num(by[k].days)}{by[k].days < p.min_days && <small className="warn-text">fewer than {p.min_days}</small>}</td>
              <td data-label="Hours">{num(by[k].hours)}</td>
              <td data-label="Typical miss"><b>{mw(by[k].typical_miss)}</b></td>
              <td data-label="Leans">{smw(by[k].bias)}</td>
              <td data-label="Bad-hour miss">{mw(by[k].bad_hour)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {small.length ? (
        <Callout title="Too few days to tell">
          Only {small.map((g) => `${g.days} ${g.day_type === "weekday" ? (g.days === 1 ? "weekday" : "weekdays") : (g.days === 1 ? "weekend day" : "weekend days")}`).join(" and ")} in this range, fewer than {p.min_days}. Hours within a day move together, so
          the hours do not add up to more evidence. Use the overall figures above for every day.
          {p.test.r != null && ` For what it is worth, the gap seen here is the kind that turns up by chance ${chance(p.test.p)}.`}
        </Callout>
      ) : (
        <p className="note top-gap">
          {p.test.p != null && p.test.p < 0.05
            ? `Weekends had ${by.weekend.typical_miss > by.weekday.typical_miss ? "bigger" : "smaller"} misses; a gap this size turns up by chance ${chance(p.test.p)}.`
            : `No clear difference: a gap this size turns up by chance ${chance(p.test.p)}.`}
        </p>
      )}
    </Panel>
  );
}
