"""Independent recompute of one number per Tier-1 and Tier-2 feature, compared with the live API output.

Deliberately does NOT use the app's selection/metrics/planning code: it reads the raw SQLite snapshot with
sqlite3 + pandas and re-implements each rule from its plain-language definition. Run from the repo root:
    python scripts/verify_tier1.py
"""
import sqlite3
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
UK = ZoneInfo("Europe/London")
FIRST, LAST = date(2026, 1, 2), date(2026, 2, 1)

con = sqlite3.connect(ROOT / "backend" / "data" / "wind.db")
fc = pd.read_sql("select start_time, publish_time, generation as f from wind_forecast", con)
act = pd.read_sql("select start_time, generation as a from wind_actual", con)
for c in ("start_time", "publish_time"):
    fc[c] = pd.to_datetime(fc[c], utc=True)
act["start_time"] = pd.to_datetime(act["start_time"], utc=True)

# Decision-time forecast: newest publish_time <= 09:00 UK on the day before delivery.
fc["day"] = fc["start_time"].dt.tz_convert(UK).dt.date
fc["cut"] = fc["day"].map(lambda d: pd.Timestamp(datetime.combine(d - timedelta(days=1), time(9), tzinfo=UK)).tz_convert("UTC"))
sel = fc[fc["publish_time"] <= fc["cut"]].sort_values("publish_time").groupby("start_time").tail(1)
ev = sel.merge(act, on="start_time")
ev["e"] = ev["f"] - ev["a"]
ev = ev[(ev["day"] >= FIRST) & (ev["day"] <= LAST)].sort_values("start_time")

sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient  # noqa: E402  (only used to fetch the API's answer)
from app.main import app  # noqa: E402

api = TestClient(app)
results = []


def check(name, mine, theirs, tol=0.01):
    ok = (mine is None and theirs is None) or (mine is not None and theirs is not None and abs(mine - theirs) <= tol)
    results.append(ok)
    print(f"{'OK ' if ok else 'BAD'} {name}: independent {mine} vs API {theirs}")


def levels(values, ref):
    t1, t2 = np.quantile(ref, 1 / 3), np.quantile(ref, 2 / 3)
    return np.where(values <= t1, "low", np.where(values <= t2, "mid", "high"))


def level_margin(hist, values, q, min_n=30):
    lv_h, lv = levels(hist["f"].values, hist["f"].values), levels(values, hist["f"].values)
    flat = np.quantile(hist["e"], q)
    out = []
    for x in lv:
        e = hist["e"].values[lv_h == x]
        out.append(np.quantile(e, q) if len(e) >= min_n else flat)
    return np.array(out)


D = date(2026, 1, 20)
today = ev[ev["day"] == D]

# Feature 1 - net buy, demand 25,000 MW, ratio 3, every window day, by wind level
m = level_margin(ev, today["f"].values, 0.75)
plan = np.maximum(0, today["f"].values - m)
j = api.get("/api/decision", params={"day": D.isoformat(), "demand": 25000, "margin_by": "level", "band_basis": "all"}).json()
check("F1 avg power to buy (MW)", round(np.maximum(0, 25000 - today["f"].values).mean(), 3), j["demand"]["avg_buy"])
check("F1 avg to buy with cover (MW)", round(np.maximum(0, 25000 - plan).mean(), 3), j["demand"]["avg_buy_cover"])

# Feature 2 - margin by wind level, only days <= D-2 (no look-ahead)
hist = ev[ev["day"] <= D - timedelta(days=2)]
m2 = level_margin(hist, today["f"].values, 0.75)
j = api.get("/api/decision", params={"day": D.isoformat(), "band_basis": "prior", "margin_by": "level"}).json()
check("F2 day-average level margin, prior days (MW)", round(m2.mean(), 3), j["margin"]["avg"])
check("F2 hours of history, prior days", float(len(hist)), float(j["margin"]["n"]), tol=0)

# Feature 3 - cost ratio 7 -> q = 7/8, one flat margin over every window day
j = api.get("/api/decision", params={"day": D.isoformat(), "cost_ratio": 7, "margin_by": "flat", "band_basis": "all"}).json()
check("F3 q for ratio 7", 7 / 8, j["margin"]["q"], tol=1e-3)
check("F3 flat margin at q=0.875 (MW)", round(float(np.quantile(ev["e"], 7 / 8)), 3), j["margin"]["avg"])

# Feature 4 - walk-forward margin check, ratio 3, by wind level
covered, n = 0, 0
for i in range((LAST - FIRST).days + 1):
    d = FIRST + timedelta(days=i)
    h = ev[ev["day"] <= d - timedelta(days=2)]
    t = ev[ev["day"] == d]
    if len(h) < 30 or t.empty:
        continue
    mm = level_margin(h, t["f"].values, 0.75)
    covered += int((t["e"].values <= mm).sum())
    n += len(t)
j = api.get("/api/margin-check", params={"margin_by": "level"}).json()
check("F4 share of hours covered", round(covered / n, 3), j["achieved"], tol=1e-3)
check("F4 hours checked", float(n), float(j["n_hours"]), tol=0)

# ------------------------------------------------------------------------------------------------ Tier 2
# Feature 5 - ramp size = largest change within 1-3 h in the version used; auto threshold = 90th percentile over window days
vers = fc.set_index(["publish_time", "start_time"])["f"]
vers = vers[~vers.index.duplicated(keep="last")]
def ramp(df):
    out = []
    for pt, st, f in zip(df["publish_time"], df["start_time"], df["f"]):
        ch = [abs(f - vers[(pt, st - pd.Timedelta(hours=k))]) for k in (1, 2, 3) if (pt, st - pd.Timedelta(hours=k)) in vers.index]
        out.append(max(ch) if ch else np.nan)
    return np.array(out)
rs = ramp(ev)
R = float(np.quantile(rs[~np.isnan(rs)], 0.9))
j = api.get("/api/decision", params={"day": "2026-01-15", "band_basis": "all"}).json()
check("F5 automatic ramp size (MW)", round(R, 3), j["ramps"]["threshold"])
check("F5 typical miss in ramp hours (MW)", round(float(np.abs(ev["e"].values[rs >= R]).mean()), 3), j["ramps"]["history"]["ramp"]["typical_miss"])

# Feature 6 - |latest - earliest day average| of full-coverage versions in the 24 h before the cutoff vs day MAE
rev, dmae = [], []
for i in range((LAST - FIRST).days + 1):
    d = FIRST + timedelta(days=i)
    hrs = set(ev.loc[ev["day"] == d, "start_time"])
    cut = pd.Timestamp(datetime.combine(d - timedelta(days=1), time(9), tzinfo=UK)).tz_convert("UTC")
    g = fc[(fc["publish_time"] > cut - pd.Timedelta(hours=24)) & (fc["publish_time"] <= cut) & fc["start_time"].isin(hrs)]
    avgs = [x["f"].mean() for _, x in g.groupby("publish_time") if len(set(x["start_time"])) == len(hrs)]
    if len(avgs) >= 2:
        rev.append(abs(avgs[-1] - avgs[0])); dmae.append(ev.loc[ev["day"] == d, "e"].abs().mean())
check("F6 link strength |revision| vs day miss", round(float(np.corrcoef(rev, dmae)[0, 1]), 3), j["stability"]["history"]["r"], tol=1e-3)

# Feature 7 - walk-forward: subtract mean daily error of the last 3 days known (<= D-2)
daily = ev.groupby("day")["e"].mean()
raw, cor = [], []
for i in range((LAST - FIRST).days + 1):
    d = FIRST + timedelta(days=i)
    known = daily[daily.index <= d - timedelta(days=2)].iloc[-3:]
    t = ev[ev["day"] == d]
    if len(known) < 3 or t.empty:
        continue
    raw += list(np.abs(t["e"])); cor += list(np.abs(t["e"] - known.mean()))
rb = api.get("/api/recent-bias").json()
check("F7 typical miss with 3-day adjustment (MW)", round(float(np.mean(cor)), 3), rb["primary"]["mae_corrected"])
check("F7 typical miss without (same days, MW)", round(float(np.mean(raw)), 3), rb["primary"]["mae_raw"])

# Feature 8 - decide by 12:00: newest version <= 12:00 UK on D-1
f12 = fc.copy()
f12["cut"] = f12["day"].map(lambda d: pd.Timestamp(datetime.combine(d - timedelta(days=1), time(12), tzinfo=UK)).tz_convert("UTC"))
s12 = f12[f12["publish_time"] <= f12["cut"]].sort_values("publish_time").groupby("start_time").tail(1).merge(act, on="start_time")
s12 = s12[(s12["day"] >= FIRST) & (s12["day"] <= LAST)]
cc = {r["cutoff"]: r for r in api.get("/api/cutoff-compare").json()["rows"]}
check("F8 typical miss deciding at 12:00 (MW)", round(float((s12["f"] - s12["a"]).abs().mean()), 3), cc["12:00"]["mae"])

# ------------------------------------------------------------------------------------------------ Tier 3
# Naive guess: recorded wind at the same UK clock hour two days earlier; skill on hours where both guesses exist
aa = act.set_index("start_time")["a"]
def guess(df, lag):
    wall = df["start_time"].dt.tz_convert(UK).dt.tz_localize(None) - pd.Timedelta(days=lag)
    return aa.reindex(wall.dt.tz_localize(UK, nonexistent="NaT", ambiguous="NaT").dt.tz_convert("UTC")).to_numpy()
g2, g1 = guess(ev, 2), guess(ev, 1)
ok = ~np.isnan(g2) & ~np.isnan(g1)
skill = 1 - np.abs(ev["e"].to_numpy()[ok]).mean() / np.abs(g2[ok] - ev["a"].to_numpy()[ok]).mean()
bl = api.get("/api/baseline").json()["guesses"][0]
check("T3 forecast skill vs same hour two days earlier", round(float(skill), 3), bl["skill_mae"], tol=1e-3)
wk = ev[[d.weekday() >= 5 for d in ev["day"]]]
dt = {g["day_type"]: g for g in api.get("/api/accuracy").json()["by_daytype"]["groups"]}
check("T3 weekend typical miss (MW)", round(float(wk["e"].abs().mean()), 3), dt["weekend"]["typical_miss"])

# ------------------------------------------------------------------------------- "When the forecast is wrong"
# Feature 1: share of known hours (days <= D-2) in which wind ended more than 2,000 MW below the forecast, for 15 Jan,
# overall and within the medium-wind third (terciles of those known hours' forecasts)
D15 = date(2026, 1, 15)
h15 = ev[ev["day"] <= D15 - timedelta(days=2)]
t1, t2 = np.quantile(h15["f"], 1 / 3), np.quantile(h15["f"], 2 / 3)
mid = h15[(h15["f"] > t1) & (h15["f"] <= t2)]
hw = api.get("/api/decision", params={"day": "2026-01-15"}).json()["how_wrong"]
check("W1 share > 2,000 MW below, all known hours", round(float((h15["e"] > 2000).mean()), 3), hw["all"]["below"][2], tol=1e-3)
check("W1 share > 2,000 MW below, medium wind", round(float((mid["e"] > 2000).mean()), 3), hw["levels"][1]["below"][2], tol=1e-3)

# Feature 4: replay with one flat margin (q = 0.75) learned from days <= D-2, scored on D
short = unused = 0.0
for i in range((LAST - FIRST).days + 1):
    d = FIRST + timedelta(days=i)
    h = ev[ev["day"] <= d - timedelta(days=2)]
    t = ev[ev["day"] == d]
    if len(h) < 30 or t.empty:
        continue
    res = max(0.0, float(np.quantile(h["e"], 0.75)))
    need = np.maximum(t["e"].to_numpy(), 0)
    short += np.maximum(need - res, 0).sum(); unused += np.maximum(res - need, 0).sum()
rt = api.get("/api/replay").json()["totals"]
check("W4 total short (MWh)", round(float(short), 3), rt["short_mwh"])
check("W4 total unused reserve (MWh)", round(float(unused), 3), rt["unused_mwh"])

# Feature 2: on 15 Jan, wind 30% below the forecast; flat reserve = 75th percentile of known misses (days <= 13 Jan)
t15 = ev[ev["day"] == D15]
res15 = max(0.0, float(np.quantile(h15["e"], 0.75)))
drop = t15["f"].to_numpy() * 0.3
wi = {s["id"]: s for s in api.get("/api/decision", params={"day": "2026-01-15"}).json()["what_if"]["scenarios"]}
check("W2 30% less wind: left to buy (MWh)", round(float(np.maximum(drop - res15, 0).sum()), 3), wi["pct30"]["day"]["left_mwh"], tol=0.01)
check("W2 bad-hour miss from known days (MW)", round(float(np.percentile(h15["e"].abs(), 90)), 3), wi["bad_hour"]["day"]["avg_drop"] if wi["bad_hour"]["available"] else None, tol=0.01)

# Feature 3: covered share with shortfall costing 9x a surplus (q = 0.9), one flat margin, walk-forward
cov = n9 = 0
for i in range((LAST - FIRST).days + 1):
    d = FIRST + timedelta(days=i)
    h = ev[ev["day"] <= d - timedelta(days=2)]
    t = ev[ev["day"] == d]
    if len(h) < 30 or t.empty:
        continue
    r9 = max(0.0, float(np.quantile(h["e"], 0.9)))
    cov += int((np.maximum(t["e"].to_numpy(), 0) <= r9).sum()); n9 += len(t)
tr9 = {r["ratio"]: r for r in api.get("/api/tradeoff").json()["rows"]}[9.0]
check("W3 covered share at 9x", round(cov / n9, 3), tr9["covered_share"], tol=1e-3)

print("\nALL MATCH" if all(results) else "\nMISMATCHES FOUND")
sys.exit(0 if all(results) else 1)
