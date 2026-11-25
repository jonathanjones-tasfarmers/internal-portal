"""
build_government.py - build the Government view of the LEL Project Results page.

    python3 build_government.py

Reads data/data.json, src/government.template.html and the <style> block of src/index.template.html
(so both pages share one look), and writes dist/government.html.

Why a separate file (26 Nov 2026): the Governance page used to carry a Government toggle that only hid
content on screen, so costs, farm names and lab results stayed in the page source. This page is built
from a cut-down data set instead. Nothing below is ever written into it:
  - KleenGrow or standard-block cost, cost against budget, break-even gain, sale or carbon prices
  - bromoform lab results, block concentration, dose in mg/kg DMI, intake in grams or g/kg liveweight
  - Sea Forest dosing guidance, feeding set-ups, blocks put out
  - farm names, start dates, exact head counts, paddock or pasture data
It only carries what the Grant Deed outcomes need (Item 10: emissions estimate, cost against gain,
feasibility) plus milestone status. Agreed with Jono on 26 Nov 2026 (plan: "Government View Audit and Plan").
CHECK_TERMS at the end fails the build if a blocked word or figure slips into the page.
"""
import json, os, re
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
GWP_CH4 = 28        # GWP100, AR5
DOSE_MODEL = 90     # g/head/day the methane model assumes; shown only as a percentage

# ---------- hand-written content (edit here) ----------
# head: exact KleenGrow head, used only to total CO2e for the mob; it is never written into the page.
# mobs: rounded head counts shown on the page.  open: cohort still running (figures computed daily).
COHORTS = {
    ("bw", 1): dict(farm="Farm 1", open=False, head=160, mobs="about 160 head per mob", days=123,
        verdict_growth="Growth was level with the standard block: the mobs' ADG bands overlapped on 30 of 63 days.",
        cost="The extra gain did not cover the cost of KleenGrow.",
        growth=[["30-day ADG (g/day)", "54 matched days", "1,166", "1,231", "-65"],
                ["90-day ADG (g/day)", "end of cohort", "1,280", "1,395", "-115"],
                ["Gain per head (kg)", "123 days", "126.2", "125.9", "+0.3"]],
        gnote="Both mobs gained strongly through spring. Season drove growth far more than treatment."),
    ("bw", 2): dict(farm="Farm 1", open=True, head=160, mobs="about 160 head per mob", start="2026-11-04",
        gnote="Cohort 2 began with a crossover, so each mob now acts as its own comparison."),
    ("eb", 1): dict(farm="Farm 2", open=False, head=206, mobs="about 210 KleenGrow and 190 standard head", days=62,
        verdict_growth="KleenGrow gained 4.6 kg more per head over 62 days, but the advantage rests on a single day's reading.",
        cost="The extra gain covered the cost of KleenGrow, but the gain is fragile.",
        growth=[["30-day ADG (g/day)", "22 matched days", "1,081", "1,060", "+21"],
                ["Gain per head (kg)", "62 days", "77.1", "72.5", "+4.6"]],
        gnote="KleenGrow gained slightly more than the standard mob, within the range of normal variation."),
    ("eb", 2): dict(farm="Farm 2", open=True, head=203, mobs="about 200 KleenGrow and 190 standard head", start="2026-10-28",
        gnote="Cohort 2 began with re-drafted mobs at near-identical start weights."),
    ("trt", 1): dict(farm="Farm 3", open=True, head=356, mobs="about 360 KleenGrow and 400 standard head", start=None, onboarding=True,
        gnote="No growth data yet. Weight and ADG will appear once automatic weighing is installed."),
}
REGISTER = [  # farm, cohort, head (rounded), status chip, status label
    ("Farm 1", 1, "160 / 160", "done", "COMPLETE"), ("Farm 1", 2, "160 / 160", "live", "IN PROGRESS"),
    ("Farm 2", 1, "210 / 190", "done", "COMPLETE"), ("Farm 2", 2, "200 / 190", "live", "IN PROGRESS"),
    ("Farm 3", 1, "360 / 400", "live", "ONBOARDING")]
MESSAGES = [
    "Neither farm shows a consistent growth benefit from KleenGrow so far",
    "At one farm the extra gain did not cover the cost of KleenGrow; at the other it did, but the gain is fragile",
    "Block intake is about half the dose the methane model assumes, so modelled abatement is small",
    "Results are early and indicative: mobs are not randomised and no full finishing period exists yet"]
NEXT = [
    "Cohort 2 at both reporting farms builds to a 30-day matched window",
    "Farm 3 automatic weighing and first growth data",
    "Measured methane to test the modelled abatement",
    "A full finishing period before conclusions on economic feasibility"]
MILESTONES = [  # number, name, period, deliverables, funding, chip, status, note
    ["1", "Foundation Activities", "19 Jun to 27 Sep 2024", "Project plan and budget, data protocols, animal ethics approval, historical data, on-farm technical leads", "Drawdown 1: $1,500,000", "done", "COMPLETE", "Approved 27 Sep 2024"],
    ["2", "On-Farm Induction Activities", "Oct 2024 to 5 May 2025", "Progress Report on feed protocols, animal induction and baseline data; quarterly stakeholder reports", "Instalment 2: $600,000", "done", "COMPLETE", "Approved; paid 5 May 2025"],
    ["3", "On-Farm Activities and Reporting, Phase 1", "Jun to Aug 2026", "Execution of Variation 1; updated Project Plan, Risk Management Plan and Agreed Budget", "Drawdown 2(a) $750,000 and 2(b) $750,000", "done", "COMPLETE", "Accepted by the Grantor"],
    ["4", "On-Farm Activities and Reporting, Phase 2", "Jul to Aug 2026", "Continuous grazing on Program farms for beef and sheep; formal Progress Report by 30 Sep 2026", "Drawdown 3: $800,000", "done", "COMPLETE", "Progress Report 5 accepted by the Grantor"],
    ["5", "On-Farm Activities and Reporting, Phase 3", "Sep 2026 to 31 Dec 2028", "Long-term pasture-based beef and sheep/wool cohorts; bi-annual Progress and Data Reports", "Not drawdown-linked", "live", "IN PROGRESS", "Under way following acceptance of Milestone 4"],
    ["6", "Final Project Report and Publication", "Jan to 1 Feb 2029", "Final Report, audited Financial Acquittal, producer handbook, economic feasibility calculator, viability report", "Drawdown 4: $200,000", "pend", "DUE 1 FEB 2029", "Not started"]]

# ---------- helpers ----------
MON = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
def fdt(x): y, m, d = map(int, x.split("-")); return f"{d} {MON[m-1]}"
def days(a, b): return (date.fromisoformat(b) - date.fromisoformat(a)).days
def pl(n, w): return f"{n} {w}{'' if n == 1 else 's'}"

def build_cohort(D, f, c, cfg):
    d = D[f]
    E = d.get(f"em{c}") or {}
    ed = sorted(E)
    S = d.get(f"ser{c}") or {"seafeed": {}, "control": {}}
    wd = sorted(x for x in S["seafeed"] if x in S["control"])
    I = d.get(f"int{c}") or {}
    out = dict(farm=cfg["farm"], coh=c, open=cfg["open"], gnote=cfg["gnote"])
    last = max([x for x in (wd[-1:] + ed[-1:])] or [""])

    # emissions: latest modelled day (closed cohorts end on their final day)
    e = E[ed[-1]] if ed else None
    rate = e[0] if e else None
    pct = round(e[1] / DOSE_MODEL * 100) if e and e[1] is not None else None
    co2 = sum((E[x][2] or 0) for x in ed) * cfg["head"] * GWP_CH4 / 1e6 if ed else 0
    out["em"] = dict(rate=rate, pct=pct, co2=(None if not co2 else (round(co2, 1) if co2 >= 1 else round(co2, 2))),
                     n=len(ed), to=fdt(ed[-1]) if ed else None)
    out["em_series"] = [[x, E[x][0], (round(E[x][1] / DOSE_MODEL * 100) if E[x][1] is not None else None)] for x in ed]
    # emissions intensity, kg CO2e per kg gain (latest day that has one)
    def lastI(t):
        r = I.get(t) or {}
        k = sorted(r)
        return (k[-1], r[k[-1]]) if k else None
    s, k = lastI("seafeed"), lastI("control")
    out["ei"] = dict(k=(round(s[1][1], 1) if s else None), k0=(round(s[1][0], 1) if s else None),
                     c=(round(k[1][0], 1) if k else None), when=(fdt(s[0]) if s else None))

    # growth series: [date, kleengrow weight, adg, lo, hi, control weight, adg, lo, hi]
    dates = sorted(set(S["seafeed"]) | set(S["control"]))
    g = lambda t, x: S[t].get(x) or [None] * 4
    out["ser"] = [[x] + [None if v is None else round(v, 1) for v in g("seafeed", x) + g("control", x)] for x in dates]

    if cfg["open"]:
        start = cfg.get("start")
        din = days(start, last) if start and last else None
        n = up = dn = 0
        for x in wd:
            p, q = S["seafeed"][x], S["control"][x]
            if None in (p[2], p[3], q[2], q[3]): continue
            n += 1
            if p[2] > q[3]: up += 1
            elif q[2] > p[3]: dn += 1
        if wd:
            a, b = S["seafeed"][wd[-1]], S["control"][wd[-1]]
            out["adg"] = dict(diff=round(a[1] - b[1]), k=round(a[1]), c=round(b[1]), lab="14-day ADG, KleenGrow vs control",
                              note=f"bands overlapped on {n - up - dn} of {n} days" if n else "Not yet a matched window")
        out["growth"] = None
        out["days"] = len(wd)
        if cfg.get("onboarding"):
            out["chip"], out["label"] = "live", "ONBOARDING"
            out["status"] = f"Lick blocks in use · {cfg['mobs']} · automatic weighing not yet installed"
            out["verdict"] = ("Too early to report a result. Automatic weighing is not yet installed, so there is no growth data, "
                              "and no modelled abatement until liveweight is available. Intake so far is "
                              + (f"{pct}% of the model dose, provisional." if pct is not None else "not yet recorded."))
            out["cost"] = "Cost cannot be compared with gain until weight data exists."
        else:
            out["chip"], out["label"] = "live", "IN PROGRESS"
            out["status"] = f"Day {din} · {cfg['mobs']}"
            out["verdict"] = (f"Too early to call. Cohort {c} is {din} days in: modelled abatement is {rate}% with intake at "
                              f"{pct}% of the model dose ({pl(len(ed), 'day')} of intake data), and growth figures are still building.")
            out["cost"] = "Too early to compare cost with gain."
        out["gsub"] = (f"Cohort {c} has {pl(len(wd), 'day')} of matched weight data. "
                       + ("Treat differences between mobs as unreliable until the bands separate and a 30-day window exists."
                          if len(wd) < 30 else "Read a difference between mobs as real only where the 95% bands separate.")) if wd else cfg["gnote"]
    else:
        out["chip"], out["label"] = "done", "COMPLETE"
        out["status"] = f"{cfg['mobs']} · {cfg['days']} matched days"
        out["days"] = cfg["days"]
        out["growth"] = cfg["growth"]
        diff = cfg["growth"][-1][4]
        out["adg"] = dict(gain=diff, lab="Extra gain per head, KleenGrow vs control", note=f"Over {cfg['days']} matched days")
        out["verdict"] = (f"KleenGrow™ delivered a modelled {rate}% methane abatement at this farm, with intake at {pct}% of the "
                          f"model dose. {cfg['verdict_growth']} {cfg['cost']}")
        out["cost"] = cfg["cost"]
        out["gsub"] = cfg["gnote"]
    return out


def main():
    D = json.load(open(os.path.join(HERE, "data", "data.json"), encoding="utf8"))
    view = {"farms": {}, "register": REGISTER, "messages": MESSAGES, "next": NEXT, "milestones": MILESTONES}
    for (f, c), cfg in COHORTS.items():
        view["farms"].setdefault(cfg["farm"], {})[str(c)] = build_cohort(D, f, c, cfg)
    found = []
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if re.match(r"\d{4}-\d\d-\d\d$", k): found.append(k)
                else: walk(v)
    walk(D)
    data_to = max(found)
    view["data_to"] = f"{int(data_to[8:])} {MON[int(data_to[5:7]) - 1]} {data_to[:4]}"

    src = open(os.path.join(HERE, "src", "index.template.html"), encoding="utf8").read()
    style = re.search(r"<style>.*?</style>", src, re.S).group(0)
    style = style.replace("body.pub .g-only{display:none!important}body:not(.pub) .p-only{display:none!important}", "")
    tpl = open(os.path.join(HERE, "src", "government.template.html"), encoding="utf8").read()
    out = tpl.replace("__STYLE__", style).replace("__VIEW__", json.dumps(view, ensure_ascii=False, separators=(",", ":")))

    check(out)
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    path = os.path.join(HERE, "dist", "government.html")
    open(path, "w", encoding="utf8").write(out)
    print(f"Wrote {path} ({len(out.encode('utf8')) / 1024:.0f} KB)")


# Words and figures that must never appear in the Government page (case-insensitive).
CHECK_TERMS = ["Bowood", "Eastbourne", "TRT", "Pastoral", "Ingleby", "trial", "bromoform", "mg/kg", "budget rate",
               "of budget", "planning rate", "$0.", "$4.85", "$32.50", "60.23", "farmer share", "net return",
               "break-even", "pallet", "trough", "feeding point", "blocks per", "1 block per", "150 g", "90 g",
               "g/day intake", "AST ", "NDVI", "paddock", "pasture quality", "LEL_", "Survey123",
               "notes_g", "dec_g", "committee"]


def check(html):
    body = re.sub(r"<style>.*?</style>", "", html, flags=re.S)
    hits = [t for t in CHECK_TERMS
            if re.search((r"(?<![A-Za-z])" if t[0].isalpha() else "") + re.escape(t), body, re.I)]
    if hits:
        raise SystemExit(f"Government page blocked: found {hits}. Remove these before publishing.")


if __name__ == "__main__":
    main()
