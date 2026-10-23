export const mw = (v, d = 0) =>
  v == null ? "–" : `${Number(v).toLocaleString("en-GB", { maximumFractionDigits: d })} MW`;
export const gw = (v) => (v == null ? "–" : `${(v / 1000).toFixed(1)} GW`);
export const num = (v, d = 0) =>
  v == null ? "–" : Number(v).toLocaleString("en-GB", { maximumFractionDigits: d });
export const pct = (v) => (v == null ? "–" : `${Number(v).toFixed(1)}%`);

const fmt = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts });
const hm = fmt({ hour: "2-digit", minute: "2-digit" });
const dm = fmt({ day: "2-digit", month: "short" });
const full = fmt({ weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const timeUK = (iso) => hm.format(new Date(iso));
export const dayUK = (iso) => dm.format(new Date(iso));
export const stampUK = (iso) => (iso ? full.format(new Date(iso)) : "–");
