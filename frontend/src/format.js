const MINUS = "−";
const group = (v, d = 0) => Number(Math.abs(v)).toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d });

/** "4,154 MW" - always the full number, never abbreviated. */
export const mw = (v, d = 0) => (v == null ? "–" : `${v < 0 ? MINUS : ""}${group(v, d)} MW`);
/** "+1,746 MW" / "−426 MW" - with an explicit sign. */
export const smw = (v, d = 0) => {
  if (v == null) return "–";
  const r = Number(v.toFixed(d));            // sign follows the number as displayed, so 0.04 never shows as "+0"
  return `${r < 0 ? MINUS : r > 0 ? "+" : ""}${group(r, d)} MW`;
};
/** Correlation-style number with a true minus sign: "−0.34". */
export const r2 = (v) => (v == null ? "–" : `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(2)}`);
export const gw = (v) => (v == null ? "–" : `${v < 0 ? MINUS : ""}${(Math.abs(v) / 1000).toFixed(1)} GW`);
export const num = (v, d = 0) => (v == null ? "–" : `${v < 0 ? MINUS : ""}${group(v, d)}`);
export const pct = (v) => (v == null ? "–" : `${Number(v).toFixed(1)}%`);
export const pct0 = (v) => (v == null ? "–" : `${Math.round(v)}%`);

const fmt = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts });
const hm = fmt({ hour: "2-digit", minute: "2-digit" });
const dm = fmt({ day: "2-digit", month: "short" });
const full = fmt({ weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const longDay = fmt({ weekday: "long", day: "numeric", month: "long" });
export const timeUK = (iso) => hm.format(new Date(iso));
export const dayUK = (iso) => dm.format(new Date(iso));
export const stampUK = (iso) => (iso ? full.format(new Date(iso)) : "–");
/** "Thursday 15 January" from "2026-01-15". */
export const longDate = (ymd) => (ymd ? longDay.format(new Date(`${ymd}T12:00:00Z`)) : "");

/** "1 time in 10" from a central coverage like 0.8 (each tail holds (1 - coverage) / 2). */
export const oneIn = (coverage) => Math.round(2 / (1 - coverage));
