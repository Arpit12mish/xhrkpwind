"""Is the forecast bias real? Reproducible checks behind docs/BIAS_FINDINGS.md.

Run from the repo root (needs network for the B1630 cross-check):
    python scripts/bias_analysis.py            # prints markdown, also writes docs/bias_analysis_results.md

Uses the stored snapshot (FUELHH wind actuals, WINDFOR forecasts) for the configured window and
cross-checks against a second official actuals series, B1630/AGWS "actual or estimated wind and
solar power generation" (Wind Onshore + Wind Offshore), fetched live from BMRS.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app import config, db, ingestion, selection  # noqa: E402

FIRST, LAST = date.fromisoformat(config.DATA_FIRST_DAY), date.fromisoformat(config.DATA_LAST_DAY)
out = []


def p(s=""):
    print(s)
    out.append(s)


def stats(f, a):
    e = f - a
    return {"n": len(e), "mean actual": a.mean(), "bias": e.mean(), "MAE": e.abs().mean(),
            "RMSE": float(np.sqrt((e ** 2).mean())), "MAPE %": (e.abs() / a).mean() * 100,
            "P90 abs": np.percentile(e.abs(), 90), "forecast/actual": f.sum() / a.sum()}


def md(df, nd=0):
    cols = [df.index.name or ""] + list(df.columns)
    lines = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]

    def fmt(c, v):
        if isinstance(v, str):
            return v
        if c == "n":
            return f"{int(v):,}"
        if c in ("forecast/actual", "f/a"):
            return f"{v:.3f}"
        if c == "MAPE %":
            return f"{v:.1f}"
        return f"{v:,.{nd}f}"

    for i, r in df.iterrows():
        lines.append("| " + " | ".join([str(i)] + [fmt(c, v) for c, v in r.items()]) + " |")
    return "\n".join(lines)


fc, act = db.load_forecasts(), db.load_actuals()
sel = selection.select_latest_forecasts(fc, config.DEFAULT_CUTOFF)
sel = sel[(sel.delivery_day >= FIRST) & (sel.delivery_day <= LAST)]
fcs = sel.set_index("start_time").forecast
fuelhh = act.set_index("start_time").actual


def shifted(series, minutes):
    s = series.copy()
    s.index = s.index - pd.Timedelta(minutes=minutes)  # value at t+minutes is labelled t
    return s


# Second official actuals series, fetched once and used in (a) and (c) -------------------
plan = ingestion.fetch_plan()
rows, d0 = [], plan.actual_from
while d0 <= plan.actual_to:
    d1 = min(d0 + timedelta(days=7), plan.actual_to + timedelta(days=1))
    r = requests.get(f"{config.BMRS_BASE}/generation/actual/per-type/wind-and-solar",
                     params={"from": f"{d0}T00:00Z", "to": f"{d1}T00:00Z", "format": "json"}, timeout=60)
    r.raise_for_status()
    rows += r.json()["data"]
    d0 = d1
b = pd.DataFrame(rows)
b = b[b.psrType.str.contains("Wind")].sort_values("publishTime").drop_duplicates(["startTime", "psrType"], keep="last")
b["start"] = pd.to_datetime(b.startTime, utc=True)
agws = b.groupby("start").quantity.sum()

p(f"Window: delivery days {FIRST} to {LAST}; cutoff {config.DEFAULT_CUTOFF} UK on D-1; decision-time forecasts vs FUELHH WIND.\n")

# (a) timestamp shift test --------------------------------------------------------------
p("## (a) Timestamp shift test (actual used for target t is the actual at t + shift)\n")
rows = {}
for s in [-120, -90, -60, -30, 0, 30, 60, 90, 120]:
    j = pd.concat([fcs.rename("f"), shifted(fuelhh, s).rename("a")], axis=1).dropna()
    st = stats(j.f, j.a)
    j2 = pd.concat([fcs.rename("f"), shifted(agws, s).rename("a")], axis=1).dropna()
    st2 = stats(j2.f, j2.a)
    rows[f"{s:+d} min"] = {"n": st["n"], "FUELHH bias": st["bias"], "FUELHH MAE": st["MAE"], "FUELHH RMSE": st["RMSE"],
                           "AGWS bias": st2["bias"], "AGWS MAE": st2["MAE"]}
t = pd.DataFrame(rows).T
t.index.name = "shift"
p(md(t))
p("\nHourly-average variants of the actual (WINDFOR is hourly, FUELHH half-hourly):\n")
rows = {}
for name, offs in [("mean(t, t+30)  (hour beginning at t)", [0, 30]), ("mean(t-30, t)  (hour ending at t)", [-30, 0]),
                   ("point value at t (used by the app)", [0])]:
    a = pd.concat([shifted(fuelhh, o) for o in offs], axis=1).dropna().mean(axis=1)
    j = pd.concat([fcs.rename("f"), a.rename("a")], axis=1).dropna()
    st = stats(j.f, j.a)
    rows[name] = {k: st[k] for k in ["n", "bias", "MAE"]}
t = pd.DataFrame(rows).T
t.index.name = "definition of actual"
p(md(t))

# (b) level test ------------------------------------------------------------------------
j = pd.concat([fcs.rename("f"), fuelhh.rename("a")], axis=1).dropna()
j["e"] = j.f - j.a
p(f"\n## (b) Level test\n\nMean forecast {j.f.mean():,.0f} MW, mean FUELHH actual {j.a.mean():,.0f} MW, "
  f"difference {j.e.mean():,.0f} MW, ratio {j.f.sum() / j.a.sum():.3f}.\n")
j["hours (UTC=UK)"] = (j.index.hour // 4 * 4).map(lambda h: f"{h:02d}-{h + 3:02d}")
g = j.groupby("hours (UTC=UK)").apply(lambda d: pd.Series({"mean actual": d.a.mean(), "bias": d.e.mean(), "f/a": d.f.sum() / d.a.sum()}))
p(md(g, 0).replace("| f/a |","| f/a |"))
j["wind level (actual quintile)"] = pd.qcut(j.a, 5, labels=["Q1 low", "Q2", "Q3", "Q4", "Q5 high"])
g = j.groupby("wind level (actual quintile)", observed=True).apply(
    lambda d: pd.Series({"n": len(d), "mean actual": d.a.mean(), "bias": d.e.mean(), "f/a": d.f.sum() / d.a.sum()}))
p("\n" + md(g, 0))
day = j.groupby(j.index.tz_convert(config.UK_TZ).date).e.mean()
beta, alpha = np.polyfit(j.a, j.f, 1)
p(f"\nDays with positive mean error: {(day > 0).sum()}/{len(day)} (daily bias range {day.min():,.0f} to {day.max():,.0f} MW). "
  f"OLS: forecast = {alpha:,.0f} + {beta:.3f} x actual, correlation {np.corrcoef(j.a, j.f)[0, 1]:.3f}.")

p("\n## (c) Cross-check against B1630/AGWS actual wind (onshore + offshore)\n")
d = pd.concat([fcs.rename("f"), fuelhh.rename("fuelhh"), agws.rename("agws")], axis=1).dropna()
res = {"FUELHH WIND (assignment's actuals)": stats(d.f, d.fuelhh), "B1630/AGWS wind (cross-check)": stats(d.f, d.agws)}
t = pd.DataFrame(res).T
t.index.name = "actuals series used"
p(md(t[["n", "mean actual", "bias", "MAE", "RMSE", "MAPE %", "P90 abs", "forecast/actual"]], 1))
gap = d.agws - d.fuelhh
p(f"\nAGWS minus FUELHH: mean {gap.mean():,.0f} MW, ratio {d.agws.sum() / d.fuelhh.sum():.3f}, "
  f"correlation {np.corrcoef(d.agws, d.fuelhh)[0, 1]:.4f}; mean gap by 4-hour block "
  f"{gap.groupby(gap.index.hour // 4 * 4).mean().min():,.0f} to {gap.groupby(gap.index.hour // 4 * 4).mean().max():,.0f} MW.")

# (d) cutoff sensitivity ------------------------------------------------------------
p("\n## (d) Sensitivity to the assumed cutoff (FUELHH actuals)\n")
rows = {}
for c in ["06:00", "09:00", "09:20", "09:50", "12:00"]:
    s2 = selection.select_latest_forecasts(fc, c)
    s2 = s2[(s2.delivery_day >= FIRST) & (s2.delivery_day <= LAST)]
    j2 = s2.merge(act, on="start_time").dropna()
    st = stats(j2.forecast, j2.actual)
    rows[c] = {"vintage used (UTC)": ", ".join(sorted(s2.publish_time.dt.strftime("%H:%M").unique())),
               "n": st["n"], "bias": st["bias"], "MAE": st["MAE"], "RMSE": st["RMSE"], "P90 abs": st["P90 abs"]}
t = pd.DataFrame(rows).T
t.index.name = "cutoff (UK, D-1)"
p(md(t))

(ROOT / "docs" / "bias_analysis_results.md").write_text(
    "# Bias analysis results (generated by scripts/bias_analysis.py)\n\n" + "\n".join(out) + "\n")
