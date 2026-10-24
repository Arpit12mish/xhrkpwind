import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import DecisionView from "./DecisionView.jsx";
import AccuracyView from "./AccuracyView.jsx";
import Guide from "./Guide.jsx";
import { api, warmApi } from "./api.js";
import { ErrorBox, useAsync } from "./components.jsx";
import { Icon } from "./icons.jsx";

const TABS = [
  ["decision", "Plan tomorrow", "How much wind to expect and how much extra to keep in reserve", "target"],
  ["accuracy", "Forecast accuracy", "How far off the forecast has been in the past", "barChart"],
  ["guide", "Help", "How the app works, and every term explained", "book"],
];

// URLs: #decision, #accuracy, #guide, and #guide/<term> for a glossary entry.
const isTab = (id) => TABS.some(([t]) => t === id);
const parseHash = () => {
  const [tab, sub] = location.hash.slice(1).split("/");
  return isTab(tab) ? { tab, sub: tab === "guide" ? sub || "" : "" } : null;
};

export default function App() {
  const [route, setRoute] = useState(() => parseHash() || { tab: "decision", sub: "" });
  const tab = route.tab;
  const refs = useRef({});
  const [pill, setPill] = useState({ x: 0, w: 0, ready: false });
  const meta = useAsync(() => api("meta"), []);
  useEffect(() => { warmApi(); }, []);
  const m = meta.data;

  // One canonical URL per view: a bare "/" or an unknown hash becomes "/#decision" (replaced, so no extra history entry).
  // Also follow the browser back/forward buttons and in-page glossary links.
  useEffect(() => {
    const sync = () => {
      const r = parseHash();
      if (!r) history.replaceState(null, "", `${location.pathname}${location.search}#decision`);
      setRoute(r || { tab: "decision", sub: "" });
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Slide the highlight under the active tab; re-measure on resize.
  useLayoutEffect(() => {
    const place = () => {
      const el = refs.current[tab];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [tab]);

  const select = (id) => { if (id !== tab || route.sub) location.hash = id; window.scrollTo({ top: 0, behavior: "smooth" }); };
  const onKey = (e, i) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
    select(next); refs.current[next]?.focus();
  };
  const current = TABS.find(([id]) => id === tab);

  return (
    <>
      <a className="skip" href="#view">Skip to content</a>
      <header className="top">
        <div className="wrap bar">
          <h1><span className="logo"><Icon name="wind" size={20} /></span>GB wind <span className="muted">day-ahead planner</span></h1>
          <nav role="tablist" aria-label="Sections" className="tabs">
            <span className="tab-pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)`, opacity: pill.ready ? 1 : 0 }} aria-hidden="true" />
            {TABS.map(([id, label, , ic], i) => (
              <button key={id} ref={(el) => (refs.current[id] = el)} role="tab" id={`tab-${id}`} aria-selected={tab === id}
                aria-controls="view" tabIndex={tab === id ? 0 : -1} className={tab === id ? "on" : ""}
                onClick={() => select(id)} onKeyDown={(e) => onKey(e, i)}>
                <Icon name={ic} size={16} /><span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="wrap" id="view" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        <div key={tab} className="view">
          <div className="crumb"><div className="t"><span className="dot" />{current[1]}</div><p className="d">{current[2]}</p></div>
          <ErrorBox error={meta.error} onRetry={meta.retry} what="the basic settings" />
          {tab === "decision" && <DecisionView meta={m} />}
          {tab === "accuracy" && <AccuracyView meta={m} />}
          {tab === "guide" && <Guide meta={m} anchor={route.sub} />}
        </div>
      </main>
      <footer className="foot">
        <div className="wrap foot-in">
          <p><Icon name="database" size={16} />Data: Elexon BMRS, national wind forecasts (WINDFOR) and recorded wind generation (FUELHH).</p>
          <p><Icon name="calendarRange" size={16} />Scope: buying decisions made in January 2026 (delivery days 2 January to 1 February).</p>
          <p><Icon name="alert" size={16} /><a href="#guide/cannot-tell">What this cannot tell you</a></p>
        </div>
      </footer>
    </>
  );
}
