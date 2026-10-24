import React from "react";

/*
 * Line styles for the day chart. Each line differs in dash pattern and width as well as colour, so the chart
 * still reads for colour-blind users and in greyscale print.
 */
export const LINES = {
  forecast: { key: "forecast", name: "Forecast", short: "Forecast", color: "var(--forecast)", width: 3, dash: undefined },
  plan: { key: "plan", name: "Plan for (forecast minus reserve)", short: "Plan for", color: "var(--plan)", width: 2, dash: "8 5" },
  actual: { key: "actual", name: "What actually happened", short: "Actual", color: "var(--actual)", width: 2.5, dash: "1 5" },
  demand: { key: "demand", name: "Your demand (your number)", short: "Demand", color: "var(--demand)", width: 2, dash: "12 4 2 4" },
  buy: { key: "buyCover", name: "To buy, with cover", short: "To buy", color: "var(--buy)", width: 2, dash: "3 3" },
};

/** HTML legend that draws each line's real dash pattern, plus swatches for areas, dots and faded bars. */
export function LineLegend({ items }) {
  return (
    <ul className="lgd" aria-label="Chart key">
      {items.map((it) => (
        <li key={it.key}>
          <svg width="34" height="14" aria-hidden="true" focusable="false">
            {it.swatch === "band" && <rect x="1" y="2" width="32" height="10" rx="3" fill="var(--band)" stroke="var(--line)" />}
            {it.swatch === "dot" && <circle cx="17" cy="7" r="5" fill={it.color || "var(--ramp)"} stroke="var(--panel)" strokeWidth="2" />}
            {it.swatch === "ring" && <><circle cx="17" cy="7" r="6" fill="none" stroke="var(--accent)" strokeWidth="2.5" /><circle cx="17" cy="7" r="3" fill="var(--forecast)" /></>}
            {it.swatch === "bar" && <rect x="9" y="1" width="16" height="12" rx="2" fill={it.color} fillOpacity={it.opacity ?? 1} />}
            {!it.swatch && <line x1="2" y1="7" x2="32" y2="7" stroke={it.color} strokeWidth={it.width} strokeDasharray={it.dash} strokeLinecap="round" />}
          </svg>
          <span>{it.name}</span>
        </li>
      ))}
    </ul>
  );
}
