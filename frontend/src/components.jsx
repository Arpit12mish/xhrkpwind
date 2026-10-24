import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";
import { Icon } from "./icons.jsx";
import { TERM } from "./glossary.js";

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

// ------------------------------------------------------------------------------------- popovers
/**
 * Small popover used by info buttons and status pills.
 * Opens on hover (mouse) or by click / tap / Enter / Space (a standard disclosure button, so keyboard users press Enter
 * and then Tab into the "Read more" link). Closes on Escape, on leaving, or on tapping elsewhere.
 * Kept inside the viewport so it never causes sideways scrolling on a phone.
 */
function Popover({ trigger, children, className = "" }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef(null), bubble = useRef(null), byHover = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === "Escape") { setOpen(false); wrap.current?.querySelector("button")?.focus(); } };
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", away); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !bubble.current) { setShift(0); return; }
    const r = bubble.current.getBoundingClientRect(), pad = 8;
    let s = 0;
    if (r.right > window.innerWidth - pad) s = window.innerWidth - pad - r.right;
    if (r.left + s < pad) s = pad - r.left;
    setShift(s);
  }, [open]);
  const props = {
    "aria-expanded": open, "aria-controls": id,
    onClick: () => { if (byHover.current) { byHover.current = false; setOpen(true); } else setOpen((o) => !o); },
  };
  return (
    <span ref={wrap} className={`pop ${className}`}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") { byHover.current = true; setOpen(true); } }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") { byHover.current = false; setOpen(false); } }}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget)) setOpen(false); }}>
      {trigger(props)}
      <span ref={bubble} id={id} role="note" className={`bubble${open ? " open" : ""}`} hidden={!open}
        style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
        {children}
      </span>
    </span>
  );
}

/** Info icon next to a term: short plain definition and a link to the Help page entry. */
export function InfoTip({ term }) {
  const t = TERM[term];
  if (!t) return null;
  return (
    <Popover trigger={(p) => (
      <button type="button" className="info-btn" aria-label={`What does “${t.title}” mean?`} {...p}>
        <Icon name="info" size={16} />
      </button>
    )}>
      <b className="bubble-title">{t.title}</b>
      <span className="bubble-text">{t.short}</span>
      <a href={`#guide/${t.id}`} className="bubble-link">Read more in Help</a>
    </Popover>
  );
}

const PILL = {
  info: { icon: "info", tone: "neutral" },
  small: { icon: "alert", tone: "warn" },
  nolink: { icon: "unlink", tone: "neutral" },
  peeks: { icon: "eyeOff", tone: "warn" },
  fair: { icon: "checkCircle", tone: "good" },
};

/** Status pill with an icon and a "why" popover, e.g. Information only / Small sample / No clear link. */
export function Pill({ kind = "info", text, why }) {
  const k = PILL[kind] || PILL.info;
  return (
    <Popover className="pill-pop" trigger={(p) => (
      <button type="button" className="pill-hit" aria-label={`${text}: why?`} {...p}>
        <span className={`pill tone-${k.tone}`}><Icon name={k.icon} size={14} /><span>{text}</span></span>
      </button>
    )}>
      <b className="bubble-title">{text}</b>
      <span className="bubble-text">{why}</span>
    </Popover>
  );
}

// ------------------------------------------------------------------------------------- cards and panels
/** KPI card. Pass `n` + `fmt` for an animated number, or `v` (string/node) for static content. `i` staggers the entrance. */
export function Card({ k, v, n, fmt, s, hl, wide, i = 0, icon, term }) {
  return (
    <div className={`card${hl ? " hl" : ""}${wide ? " wide" : ""}`} style={{ "--i": i }}>
      <div className="k">
        {icon && <span className="k-icon"><Icon name={icon} size={18} /></span>}
        <span className="k-text">{k}</span>
        {term && <InfoTip term={term} />}
      </div>
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

/**
 * Section card: icon + title + info button + status pills, then the headline sentence, then the details.
 * Fades in when scrolled into view; charts inside draw in once visible.
 */
export function Panel({ title, sub, how, children, icon, term, headline, pills, id }) {
  const [ref, seen] = useSeen();
  return (
    <section ref={ref} id={id} className={`panel reveal${seen ? " in" : ""}`}>
      <div className="ph">
        {icon && <span className="ph-icon"><Icon name={icon} size={20} /></span>}
        <h3>{title}</h3>
        {term && <InfoTip term={term} />}
        {pills && <span className="pills">{pills}</span>}
      </div>
      {headline && <p className="headline">{headline}</p>}
      {sub && <p className="note">{sub}</p>}
      <SeenContext.Provider value={seen}>{children}</SeenContext.Provider>
      {how && <div className="how"><b>How to read this: </b>{how}</div>}
    </section>
  );
}

/** Fixed-height chart area; the chart mounts (and so animates) only after its panel has been seen. */
export function Chart({ h = 280, caption, label, children }) {
  const seen = useContext(SeenContext);
  // The chart is one labelled image for screen readers; its words are in the headline, caption and "How to read" text.
  return (
    <>
      <div className="chartbox" role="img" aria-label={label || caption || "Chart. The sentence above the chart summarises it."}
        style={{ height: `clamp(230px, 62vw, ${h}px)` }}>
        <div aria-hidden="true" style={{ width: "100%", height: "100%" }}>{seen && <ResponsiveContainer>{children}</ResponsiveContainer>}</div>
      </div>
      {caption && <p className="axis-caption">{caption}</p>}
    </>
  );
}

/** A form control with its label, an optional info button and a short plain-language hint. */
export function Field({ label, hint, children, term, wide }) {
  const id = useId();
  const kids = React.Children.toArray(children);
  const first = React.isValidElement(kids[0]) ? React.cloneElement(kids[0], { id, "aria-describedby": hint ? `${id}-hint` : undefined }) : kids[0];
  return (
    <div className={`field${wide ? " wide" : ""}`}>
      <div className="lbl-row"><label className="lbl" htmlFor={id}>{label}</label>{term && <InfoTip term={term} />}</div>
      {first}
      {kids.slice(1)}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

/** A highlighted note with an icon: tone is "info" or "warn". */
export function Callout({ tone = "info", title, children, id }) {
  return (
    <aside className={`callout ${tone}`} role="note" id={id}>
      <span className="ci"><Icon name={tone === "warn" ? "alert" : "info"} size={18} /></span>
      <div><b>{title}</b><div>{children}</div></div>
    </aside>
  );
}

/** Horizontal gauge: the shaded stretch is the likely range, the marker is the expected value (all in MW). */
export function RangeBar({ low, mid, high, labels }) {
  const top = Math.max(1000, Math.ceil((high * 1.12) / 1000) * 1000);
  const pos = (v) => `${Math.min(100, Math.max(0, (v / top) * 100))}%`;
  const fmt = (v) => `${Math.round(v).toLocaleString("en-GB")} MW`;
  return (
    <div className="range">
      <div className="track" role="img" aria-label={`${labels.low} ${fmt(low)}, ${labels.mid} ${fmt(mid)}, ${labels.high} ${fmt(high)}`}>
        <span className="span" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
        <span className="mark" style={{ left: pos(mid) }} />
      </div>
      <div className="range-labels">
        <div><span className="rl"><Icon name="trendingDown" size={16} />{labels.low}<InfoTip term="weak-wind" /></span><b>{fmt(low)}</b></div>
        <div className="mid"><span className="rl"><Icon name="target" size={16} />{labels.mid}<InfoTip term="expected-wind" /></span><b>{fmt(mid)}</b></div>
        <div className="end"><span className="rl"><Icon name="trendingUp" size={16} />{labels.high}<InfoTip term="strong-wind" /></span><b>{fmt(high)}</b></div>
      </div>
    </div>
  );
}

/** Shimmering placeholders shown while the first response is on its way. */
export function Skeleton({ cards = 5, panels = 1 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <p className="sr-only">Loading the latest figures</p>
      <div className="cards">{Array.from({ length: cards }, (_, i) => <div key={i} className="card sk" style={{ "--i": i }} />)}</div>
      {Array.from({ length: panels }, (_, i) => <div key={i} className="panel sk-panel"><div className="sk sk-line" /><div className="sk sk-chart" /></div>)}
    </div>
  );
}

/** Turn a fetch error into plain words. */
export function plainError(error) {
  const msg = String(error?.message || error || "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "The page could not reach the server. Check your connection, then try again.";
  const m = msg.match(/^(\d{3})\s*(.*)$/s);
  if (m) {
    let detail = m[2];
    try { const j = JSON.parse(m[2]); detail = typeof j.detail === "string" ? j.detail : (j.detail?.[0]?.msg || ""); } catch { /* keep text */ }
    if (m[1] === "422") return `That choice is outside what the data covers${detail ? `: ${detail}` : ""}. Please adjust it and try again.`;
    return `The server had a problem (code ${m[1]}). Please try again in a moment.`;
  }
  return "Something unexpected went wrong. Please try again.";
}

export function ErrorBox({ error, onRetry, what = "these figures" }) {
  if (!error) return null;
  return (
    <div className="errbox" role="alert">
      <Icon name="alert" size={20} />
      <div>
        <b>We could not load {what}.</b>
        <p>{plainError(error)}</p>
        {onRetry && <button type="button" className="btn" onClick={onRetry}><Icon name="refresh" size={16} />Try again</button>}
      </div>
    </div>
  );
}

export function useAsync(fn, deps) {
  const [state, set] = React.useState({ loading: true });
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && set({ data, loading: false }))
        .catch((error) => live && set({ error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line
  }, [...deps, nonce]);
  return { ...state, retry: () => setNonce((n) => n + 1) };
}
