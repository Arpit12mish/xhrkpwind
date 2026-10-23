import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import DecisionView from "./DecisionView.jsx";
import AccuracyView from "./AccuracyView.jsx";
import Guide from "./Guide.jsx";
import { api, warmApi } from "./api.js";
import { useAsync } from "./components.jsx";

const icon = (d) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const TABS = [
  ["decision", "Plan tomorrow", "How much wind to expect and how much extra to keep in reserve", icon(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></>)],
  ["accuracy", "Forecast accuracy", "How far off the forecast has been in the past", icon(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>)],
  ["guide", "Help", "Plain-language guide and word list", icon(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></>)],
];

const isTab = (id) => TABS.some(([t]) => t === id);
const tabFromHash = () => (isTab(location.hash.slice(1)) ? location.hash.slice(1) : "decision");

export default function App() {
  const [tab, setTab] = useState(tabFromHash);
  const refs = useRef({});
  const [pill, setPill] = useState({ x: 0, w: 0, ready: false });
  const meta = useAsync(() => api("meta"), []);
  useEffect(() => { warmApi(); }, []);
  const m = meta.data;

  // One canonical URL per view: a bare "/" or an unknown hash becomes "/#decision" (replaced, so no extra history entry).
  // Also follow the browser back/forward buttons.
  useEffect(() => {
    const sync = () => {
      if (!isTab(location.hash.slice(1))) history.replaceState(null, "", `${location.pathname}${location.search}#decision`);
      setTab(tabFromHash());
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Slide the highlight pill under the active tab; re-measure on resize.
  useLayoutEffect(() => {
    const place = () => {
      const el = refs.current[tab];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [tab]);

  const select = (id) => { if (id !== tab) location.hash = id; window.scrollTo({ top: 0, behavior: "smooth" }); };
  const onKey = (e, i) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
    select(next); refs.current[next]?.focus();
  };
  const current = TABS.find(([id]) => id === tab);

  return (
    <>
      <header className="top">
        <div className="wrap bar">
          <h1><span className="logo" aria-hidden="true">{icon(<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8a2.5 2.5 0 1 1-2.5 2.5" />)}</span>GB wind <span className="muted">day-ahead planner</span></h1>
          <nav role="tablist" aria-label="Sections" className="tabs">
            <span className="pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)`, opacity: pill.ready ? 1 : 0 }} aria-hidden="true" />
            {TABS.map(([id, label, , ic], i) => (
              <button key={id} ref={(el) => (refs.current[id] = el)} role="tab" id={`tab-${id}`} aria-selected={tab === id}
                aria-controls="view" tabIndex={tab === id ? 0 : -1} className={tab === id ? "on" : ""}
                onClick={() => select(id)} onKeyDown={(e) => onKey(e, i)}>
                {ic}<span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="wrap" id="view" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <div key={tab} className="view">
          <div className="crumb"><div className="t"><span className="dot" />{current[1]}</div><p className="d">{current[2]}</p></div>
          {meta.error && <div className="err">Could not reach the API: {String(meta.error.message)}</div>}
          {tab === "decision" && <DecisionView meta={m} />}
          {tab === "accuracy" && <AccuracyView meta={m} />}
          {tab === "guide" && <Guide meta={m} />}
        </div>
      </main>
    </>
  );
}
