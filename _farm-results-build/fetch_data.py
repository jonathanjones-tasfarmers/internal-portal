"""
fetch_data.py - regenerate data/data.json for the LEL farm results page from the PUBLIC ArcGIS layers.
Reads only public services (no login, no credentials). Writes nothing outside data/data.json.

    python3 fetch_data.py [YYYY-MM-DD]

Optional date argument: drop every row after that day. Use the last COMPLETE day of OptiWeigh readings
(the newest day is often still filling in and its rolling figures move when the rest of its readings arrive).

Shape of data.json (per farm key bw, eb, trt):
  ser1 / ser2  cohort 1 / cohort 2: {treatment: {date: [rolling_weight_14d, rolling_adg, ci_lower, ci_upper]}}
  em1 / em2    modelled SeaFeed (KleenGrow) emissions rows: {date: [abatement_rate, intake_g_per_hd_day, methane_abated_g_per_hd_day,
               bromoform_mg_per_kg_dmi, intake_g_per_kg_lw]}  (the last two added 24 Nov 2026; None with no liveweight)
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


def layer_fields(layer):
    req = urllib.request.Request(f"{BASE}/{layer}/FeatureServer/0?f=json", headers={"User-Agent": "lel-farm-results"})
    return {f["name"] for f in json.load(urllib.request.urlopen(req)).get("fields", [])}


# Dose and intake per kg of liveweight (added 24 Nov 2026). The pipeline stores both on each row; if the
# public view does not show a field yet, it is worked out here from the row's own intake and baseline with
# the live constants in LEL_Model_Assumptions_Public (the same maths as lel_abatement.py in lel-pipelines).
EM_FIELDS = layer_fields("LEL_Emissions_Data_view")
MA = (query("LEL_Model_Assumptions_Public", "1=1", "dmi_pct_of_bodyweight,charmley_my_g_per_kg_dmi,block_bromoform_mg_per_kg", "") or [{}])[0]
STORED = [f for f in ("bromoform_mg_per_kg_dmi", "intake_g_per_kg_lw") if f in EM_FIELDS]
print("Public view shows:", STORED or "neither dose nor intake per kg (worked out from intake and baseline)")


def dose_and_per_kg(a):
    intake, base = a.get("intake_g_per_hd_day"), a.get("baseline_ch4_g_per_hd_day")
    dose, gpk = a.get("bromoform_mg_per_kg_dmi"), a.get("intake_g_per_kg_lw")
    ok = intake is not None and base and MA.get("charmley_my_g_per_kg_dmi") and MA.get("dmi_pct_of_bodyweight")
    if gpk is None and "intake_g_per_kg_lw" not in STORED and ok:
        gpk = round(intake / (base / (MA["charmley_my_g_per_kg_dmi"] * MA["dmi_pct_of_bodyweight"])), 3)
    if dose is None and "bromoform_mg_per_kg_dmi" not in STORED and ok and MA.get("block_bromoform_mg_per_kg"):
        dose = round(intake / 1000 * MA["block_bromoform_mg_per_kg"] / (base / MA["charmley_my_g_per_kg_dmi"]), 2)
    return dose, gpk


def emissions(farm):
    em, ctl = {}, None
    if not farm:
        return em, ctl
    fields = "record_date,treatment,abatement_rate,intake_g_per_hd_day,methane_abated_g_per_hd_day"
    extra = [f for f in ["baseline_ch4_g_per_hd_day"] + STORED if f in EM_FIELDS]
    for a in query("LEL_Emissions_Data_view", f"farm_name='{farm}'", ",".join([fields] + extra), "record_date"):
        if a["treatment"] == "seafeed":
            em[day(a["record_date"])] = [a["abatement_rate"], a["intake_g_per_hd_day"], a["methane_abated_g_per_hd_day"], *dose_and_per_kg(a)]
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


# Emissions intensity (added 24 Nov 2026): kg CO2e per kg liveweight gain, baseline and after abatement,
# stored on per-farm LEL_Economics_Data rows by 04 (lel_intensity.py in lel-pipelines). Left out until the
# layer has the fields. {treatment: {day: [baseline, net]}}
INT_FIELDS = ["ch4_intensity_baseline_kg_co2e_per_kg_lwg", "ch4_intensity_kg_co2e_per_kg_lwg"]
HAS_INT = all(f in layer_fields("LEL_Economics_Data") for f in INT_FIELDS)
print("Economics has intensity fields:", HAS_INT)


def intensity(farm):
    out = {"seafeed": {}, "control": {}}
    if not farm or not HAS_INT:
        return out
    for a in query("LEL_Economics_Data", f"farm_name='{farm}' AND {INT_FIELDS[0]} IS NOT NULL",
                   "calculation_date,treatment," + ",".join(INT_FIELDS), "calculation_date"):
        out.setdefault(a["treatment"], {})[day(a["calculation_date"])] = [a[INT_FIELDS[0]], a[INT_FIELDS[1]]]
    return out


data = {}
for key, (f1, f2) in FARMS.items():
    em1, _ = emissions(f1)
    em2, ctl2 = emissions(f2)
    data[key] = {"ser1": weights(f1), "ser2": weights(f2), "em1": em1, "em2": em2, "ctl2": ctl2,
                 "cost1": costs(f1, False), "cost2": costs(f2, True),
                 "int1": intensity(f1), "int2": intensity(f2)}
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
