import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Props spread onto every Recharts series so charts draw in, unless the user prefers reduced motion. */
export const ANIM = { isAnimationActive: !reduced(), animationDuration: 750, animationEasing: "ease-out" };

/** Number that counts from its previous value to the new one. The final value is always in aria-label / data-value. */
export function CountUp({ value, format = (x) => String(Math.round(x)), duration = 900 }) {
  const [shown, setShown] = useState(reduced() || value == null ? value : 0);
  const from = useRef(reduced() || value == null ? value : 0);
  useEffect(() => {
    if (reduced() || value == null || !Number.isFinite(value)) { setShown(value); from.current = value; return undefined; }
    const start = performance.now(), a = Number.isFinite(from.current) ? from.current : 0;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const cur = a + (value - a) * (1 - Math.pow(1 - p, 3)); // ease-out cubic
      from.current = cur; setShown(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="num" data-value={value} aria-label={format(value)}>{format(shown)}</span>;
}

/** KPI card. Pass `n` + `fmt` for an animated number, or `v` (string/node) for static content. `i` staggers the entrance. */
export function Card({ k, v, n, fmt, s, hl, i = 0 }) {
  return (
    <div className={`card${hl ? " hl" : ""}`} style={{ "--i": i }}>
      <div className="k">{k}</div>
      <div className="v">{n != null ? <CountUp value={n} format={fmt} /> : v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

const SeenContext = createContext(true);

/** True once the element has scrolled into view (stays true afterwards). Falls back to true without IntersectionObserver. */
function useSeen() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined" || reduced());
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** A chart panel: fades/slides in when scrolled into view, with a "how to read" box. Charts inside draw in once visible. */
export function Panel({ title, sub, how, children }) {
  const [ref, seen] = useSeen();
  return (
    <section ref={ref} className={`panel reveal${seen ? " in" : ""}`}>
      <h3>{title}</h3>
      {sub && <p className="note">{sub}</p>}
      <SeenContext.Provider value={seen}>{children}</SeenContext.Provider>
      {how && <div className="how"><b>How to read this: </b>{how}</div>}
    </section>
  );
}

/** Fixed-height chart area; the chart mounts (and so animates) only after its panel has been seen. */
export function Chart({ h = 280, children }) {
  const seen = useContext(SeenContext);
  return <div className="chartbox" style={{ height: h }}>{seen && <ResponsiveContainer>{children}</ResponsiveContainer>}</div>;
}

/** Shimmering placeholders shown while the first response is on its way. */
export function Skeleton({ cards = 5, panels = 1 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="cards">{Array.from({ length: cards }, (_, i) => <div key={i} className="card sk" style={{ "--i": i }} />)}</div>
      {Array.from({ length: panels }, (_, i) => <div key={i} className="panel sk-panel"><div className="sk sk-line" /><div className="sk sk-chart" /></div>)}
    </div>
  );
}

export function useAsync(fn, deps) {
  const [state, set] = React.useState({ loading: true });
  React.useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && set({ data, loading: false }))
        .catch((error) => live && set({ error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line
  }, deps);
  return state;
}
