import React, { useEffect, useMemo, useState } from "react";
import { Callout } from "./components.jsx";
import { CannotTell } from "./PlanPanels.jsx";
import { Icon } from "./icons.jsx";
import { GROUPS, TERMS } from "./glossary.js";

const GROUP_ICON = { "Forecast data": "wind", Planning: "shield", "Checking the forecast": "target", "Units and statistics": "ruler" };
const STEPS = [
  ["calendar", "Pick the day you are buying for", "On the Plan page, choose a delivery day between 2 January and 1 February 2026."],
  ["clock", "The app finds the forecast you could have seen", "It takes the newest forecast published before your decide-by time on the day before (09:00 unless you change it)."],
  ["scale", "Say how costly running short is", "Even, Usual or Careful, or any ratio from 1 to 10. A higher ratio covers more hours and keeps more in reserve."],
  ["shield", "Read how much to keep in reserve", "Worked out from how wrong the forecast was on days already known. Plan for the forecast minus that reserve."],
  ["target", "Check how much to trust it", "The Accuracy page shows past misses, a fair check of the reserve, and what the data cannot tell you."],
];

const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export default function Guide({ meta, anchor }) {
  const [q, setQ] = useState("");
  const cutoff = meta?.default_cutoff ?? "09:00";
  const hits = useMemo(() => {
    const k = norm(q.trim());
    return k ? TERMS.filter((t) => norm(`${t.title} ${t.aka || ""} ${t.short} ${t.body} ${t.example}`).includes(k)) : TERMS;
  }, [q]);

  // Jump to a glossary entry from "Read more" links (#guide/<term>) and highlight it briefly.
  useEffect(() => {
    if (!anchor) return undefined;
    setQ("");
    const t = setTimeout(() => {
      const el = document.getElementById(anchor === "cannot-tell" ? "cannot-tell" : `term-${anchor}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("flash");
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      setTimeout(() => el.classList.remove("flash"), 1600);
    }, 60);
    return () => clearTimeout(t);
  }, [anchor]);

  return (
    <div className="guide">
      <section className="panel">
        <div className="ph"><span className="ph-icon"><Icon name="listChecks" size={20} /></span><h2 className="gh2">How the app works in 5 steps</h2></div>
        <ol className="steps big-steps">
          {STEPS.map(([ic, t, d], i) => (
            <li key={t}><span className="step-n" aria-hidden="true">{i + 1}</span><span className="step-i"><Icon name={ic} size={18} /></span>
              <span><b>{t}</b><small>{d}</small></span></li>
          ))}
        </ol>
        <Callout title="About the decide-by time">
          {cutoff} is a working assumption, not an official deadline. Great Britain’s day-ahead auctions close at about 09:20 (EPEX) and 09:50
          (Nord Pool N2EX). Change the time on the Plan page to match your market.
        </Callout>
      </section>

      <section className="panel glossary" aria-labelledby="gl-h">
        <div className="ph"><span className="ph-icon"><Icon name="book" size={20} /></span><h2 id="gl-h" className="gh2">Every term, explained</h2></div>
        <p className="headline">Each entry gives a short meaning, a little more detail, and an example with real January 2026 figures.</p>
        <div className="search">
          <Icon name="search" size={18} />
          <label htmlFor="gl-q" className="sr-only">Search the terms</label>
          <input id="gl-q" type="search" placeholder="Search, for example “reserve” or “MWh”" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="note" role="status">{q ? `${hits.length} term${hits.length === 1 ? "" : "s"} match “${q}”.` : `${TERMS.length} terms in ${GROUPS.length} groups.`}</p>
        <nav className="gl-index" aria-label="Glossary groups">
          {GROUPS.map((g) => <a key={g} href={`#guide/${TERMS.find((t) => t.group === g).id}`}><Icon name={GROUP_ICON[g]} size={16} />{g}</a>)}
        </nav>
        {GROUPS.map((g) => {
          const items = hits.filter((t) => t.group === g);
          if (!items.length) return null;
          return (
            <section key={g} className="gl-group" aria-labelledby={`g-${g}`}>
              <h3 id={`g-${g}`} className="gl-gh"><Icon name={GROUP_ICON[g]} size={18} />{g}</h3>
              <dl className="gl-list">
                {items.map((t) => (
                  <div key={t.id} id={`term-${t.id}`} className="term" tabIndex={-1}>
                    <dt><span className="term-h">{t.title}</span>{t.aka && <span className="aka">also called {t.aka}</span>}</dt>
                    <dd>
                      <p className="term-short">{t.short}</p>
                      <p>{t.body}</p>
                      <p className="example"><Icon name="info" size={16} /><span><b>Example:</b> {t.example}</span></p>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
        {!hits.length && <p className="note">No term matches. Try a shorter word.</p>}
      </section>

      <CannotTell />
    </div>
  );
}
