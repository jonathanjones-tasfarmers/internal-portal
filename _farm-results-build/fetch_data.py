"""
fetch_data.py - regenerate data/data.json for the LEL farm results page from the PUBLIC ArcGIS layers.
Reads only public services (no login, no credentials). Writes nothing outside data/data.json.

    python3 fetch_data.py [YYYY-MM-DD]

Optional date argument: drop every row after that day. Use the last COMPLETE day of OptiWeigh readings
(the newest day is often still filling in and its rolling figures move when the rest of its readings arrive).

Shape of data.json (per farm key bw, eb, trt):
  ser1 / ser2  cohort 1 / cohort 2: {treatment: {date: [rolling_weight_14d, rolling_adg, ci_lower, ci_upper]}}
  em1 / em2    modelled SeaFeed (KleenGrow) emissions rows: {date: [abatement_rate, intake_g_per_hd_day, methane_abated_g_per_hd_day]}
  ctl2         [0, latest standard-block intake] for cohort 2 (None when there is no cohort 2)
  cost1/cost2  cumulative cost: {treatment: {date: [cost_per_head_day_aud, cost_per_head_aud]}} (cohort 2: [cost_per_head_aud])
"""
import json, os, sys, urllib.parse, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://services6.arcgis.com/RkRGg1mAki7yG3EG/arcgis/rest/services"
TZ = ZoneInfo("Australia/Hobart")
FARMS = {  # key: (cohort 1 farm_name, cohort 2 farm_name or None)
    "bw": ("Bowood Farm", "Bowood Farm - Cohort 2"),
    "eb": ("Eastbourne Farm", "Eastbourne Farm - Cohort 2"),
    "trt": ("TRT Pastoral", None),
}


def query(layer, where, fields, order):
    params = {"where": where, "outFields": fields, "orderByFields": order, "resultRecordCount": 2000, "f": "json"}
    url = f"{BASE}/{layer}/FeatureServer/0/query?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "lel-farm-results"})
    data = json.load(urllib.request.urlopen(req))
    if "error" in data:
        raise RuntimeError(f"{layer}: {data['error']}")
    return [f["attributes"] for f in data["features"]]


def day(ms):
    return datetime.fromtimestamp(ms / 1000, TZ).date().isoformat()


def weights(farm):
    if not farm:
        return {"seafeed": {}, "control": {}}
    out = {"seafeed": {}, "control": {}}
    rows = query("OptiWeigh_Cattle_Weights", f"farm_name='{farm}' AND rolling_weight_14d IS NOT NULL",
                 "snapshot_date,treatment_group,rolling_weight_14d,rolling_adg,rolling_adg_ci_lower,rolling_adg_ci_upper", "snapshot_date")
    for a in rows:
        out.setdefault(a["treatment_group"], {})[day(a["snapshot_date"])] = [a["rolling_weight_14d"], a["rolling_adg"], a["rolling_adg_ci_lower"], a["rolling_adg_ci_upper"]]
    return out


def emissions(farm):
    em, ctl = {}, None
    if not farm:
        return em, ctl
    for a in query("LEL_Emissions_Data_view", f"farm_name='{farm}'", "record_date,treatment,abatement_rate,intake_g_per_hd_day,methane_abated_g_per_hd_day", "record_date"):
        if a["treatment"] == "seafeed":
            em[day(a["record_date"])] = [a["abatement_rate"], a["intake_g_per_hd_day"], a["methane_abated_g_per_hd_day"]]
        elif a["treatment"] == "control":
            ctl = [0, a["intake_g_per_hd_day"]]
    return em, ctl


def costs(farm, cohort2):
    out = {"seafeed": {}, "control": {}}
    if not farm:
        return out
    for a in query("LEL_Economics_Data", f"farm_name='{farm}'", "calculation_date,treatment,cost_per_head_day_aud,cost_per_head_aud", "calculation_date"):
        out.setdefault(a["treatment"], {})[day(a["calculation_date"])] = [a["cost_per_head_aud"]] if cohort2 else [a["cost_per_head_day_aud"], a["cost_per_head_aud"]]
    return out


data = {}
for key, (f1, f2) in FARMS.items():
    em1, _ = emissions(f1)
    em2, ctl2 = emissions(f2)
    data[key] = {"ser1": weights(f1), "ser2": weights(f2), "em1": em1, "em2": em2, "ctl2": ctl2,
                 "cost1": costs(f1, False), "cost2": costs(f2, True)}
    print(key, {k: (len(v) if hasattr(v, "__len__") and v is not None else v) for k, v in data[key].items()})
CAP = sys.argv[1] if len(sys.argv) > 1 else None


def trim(obj):
    """Drop date keys later than CAP (date keys are YYYY-MM-DD strings)."""
    if isinstance(obj, dict):
        return {k: trim(v) for k, v in obj.items() if not (CAP and len(k) == 10 and k[4] == "-" and k > CAP)}
    return obj


if CAP:
    data = trim(data)
    print("Capped at", CAP)
with open(os.path.join(HERE, "data", "data.json"), "w") as fh:
    json.dump(data, fh)
print("Wrote data/data.json")
