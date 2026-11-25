// Builds the data snapshot the assistant answers from. Reads ONLY the public LEL layers the Staff
// Portal pages already read without a token, so the assistant can never see more than a portal
// visitor can. One snapshot is kept per worker instance for SNAPSHOT_TTL_MS.

export const BASE = "https://services6.arcgis.com/RkRGg1mAki7yG3EG/arcgis/rest/services";
export const AGGREGATE_LABEL = "All Farms (Trial Aggregate)";
const DAY_MS = 86400000;
const RECENT_DAYS = 14;
const STALE_DAYS = 3;

async function query(fetchFn, layer, params) {
  const qs = new URLSearchParams({ f: "json", resultRecordCount: "2000", ...params });
  const res = await fetchFn(`${BASE}/${layer}/FeatureServer/0/query?${qs}`, {
    headers: { "User-Agent": "lel-staff-assistant" },
  });
  if (!res.ok) throw new Error(`${layer}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${layer}: ${data.error.message || "query failed"}`);
  return (data.features || []).map((f) => f.attributes);
}

// Hobart calendar date (YYYY-MM-DD) for an epoch-ms timestamp.
export function hobartDate(ms) {
  if (ms == null) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Hobart", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

function sqlTs(ms) {
  return "timestamp '" + new Date(ms).toISOString().slice(0, 19).replace("T", " ") + "'";
}

const r = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
// Mean abatement and intake over readings with from < date <= to.
function week(em, from, to) {
  const rows = em.filter((a) => a.record_date > from && a.record_date <= to);
  if (!rows.length) return null;
  const pick = (k) => rows.map((a) => a[k]).filter((v) => v != null);
  return { days: rows.length, mean_abatement_pct: r(mean(pick("abatement_rate"))), mean_intake_g_hd_day: r(mean(pick("intake_g_per_hd_day"))) };
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function latestBy(rows, keyFn, dateField) {
  const out = {};
  for (const a of rows) {
    const k = keyFn(a);
    if (k == null || a[dateField] == null) continue;
    if (!out[k] || a[dateField] > out[k][dateField]) out[k] = a;
  }
  return out;
}

// "Bowood Farm" is closed once "Bowood Farm - Cohort 2" exists.
export function closedFarms(farms) {
  const set = new Set(farms);
  return new Set(farms.filter((f) => !/ - Cohort \d+$/.test(f) && [...set].some((g) => g.startsWith(f + " - Cohort "))));
}

// Pure: turns layer rows into the snapshot object. Kept separate from fetching so it can be tested.
export function buildSnapshot({ headline, emissions, economics, weights, adg, usage, assumptions }, nowMs) {
  const today = hobartDate(nowMs);
  const daysAgo = (ms) => (ms == null ? null : Math.floor((nowMs - ms) / DAY_MS));
  const recentFrom = nowMs - RECENT_DAYS * DAY_MS;

  const farms = [...new Set(emissions.concat(economics).map((a) => a.farm_name))]
    .filter((f) => f && f !== AGGREGATE_LABEL).sort();
  const closed = closedFarms(farms);

  const mobs = [];
  for (const farm of farms) {
    for (const t of ["seafeed", "control"]) {
      const em = emissions.filter((a) => a.farm_name === farm && a.treatment === t && a.record_date != null)
        .sort((a, b) => a.record_date - b.record_date);
      const ec = economics.filter((a) => a.farm_name === farm && a.treatment === t && a.calculation_date != null)
        .sort((a, b) => a.calculation_date - b.calculation_date);
      const wt = weights.filter((a) => a.farm_name === farm && a.treatment_group === t && a.snapshot_date != null)
        .sort((a, b) => a.snapshot_date - b.snapshot_date);
      if (!em.length && !ec.length && !wt.length) continue;
      const lastEm = em[em.length - 1], lastEc = ec[ec.length - 1], lastWt = wt[wt.length - 1];
      const rates = em.map((a) => a.abatement_rate).filter((v) => v != null);
      const intakes = em.map((a) => a.intake_g_per_hd_day).filter((v) => v != null);
      const mob = {
        farm, treatment: t === "seafeed" ? "KleenGrow (SeaFeed)" : "control (standard block)",
        status: closed.has(farm) ? "closed cohort (final figures)" : "open cohort",
        emissions_days: em.length,
        emissions_from: lastEm ? hobartDate(em[0].record_date) : null,
        emissions_to: lastEm ? hobartDate(lastEm.record_date) : null,
        cohort_mean_abatement_pct: r(mean(rates)),
        cohort_mean_intake_g_hd_day: r(mean(intakes)),
        latest: lastEm ? {
          date: hobartDate(lastEm.record_date),
          abatement_pct: r(lastEm.abatement_rate),
          intake_g_hd_day: r(lastEm.intake_g_per_hd_day),
          baseline_ch4_g_hd_day: r(lastEm.baseline_ch4_g_per_hd_day),
          ch4_abated_g_hd_day: r(lastEm.methane_abated_g_per_hd_day),
          dose_mg_per_kg_dmi: r(lastEm.bromoform_mg_per_kg_dmi, 2),
          intake_g_per_kg_liveweight: r(lastEm.intake_g_per_kg_lw, 3),
        } : null,
        // Precomputed so the model doesn't have to average rows itself: the 7 days to the latest
        // reading, and the 7 days before that.
        last_7_days: lastEm ? week(em, lastEm.record_date - 7 * DAY_MS, lastEm.record_date) : null,
        previous_7_days: lastEm ? week(em, lastEm.record_date - 14 * DAY_MS, lastEm.record_date - 7 * DAY_MS) : null,
        last_14_days: em.filter((a) => a.record_date >= recentFrom).map((a) => [
          hobartDate(a.record_date), r(a.abatement_rate), r(a.intake_g_per_hd_day), r(a.bromoform_mg_per_kg_dmi, 2),
        ]),
        economics: lastEc ? {
          date: hobartDate(lastEc.calculation_date),
          head_count: lastEc.representative_head_count,
          cumulative_ch4_abated_kg_per_head: r(lastEc.cumulative_ch4_abated_kg_per_head, 2),
          weight_gain_kg_per_head: r(lastEc.weight_gain_kg_per_head, 1),
          weight_gain_days: lastEc.days_of_data,
          adg_g_day: lastEc.weight_gain_kg_per_head != null && lastEc.days_of_data
            ? Math.round((lastEc.weight_gain_kg_per_head / lastEc.days_of_data) * 1000) : null,
          cost_per_head_aud: r(lastEc.cost_per_head_aud, 2),
          cost_per_kg_gain_aud: r(lastEc.cost_per_kg_gain_aud, 2),
          intensity_baseline_kg_co2e_per_kg_gain: r(lastEc.ch4_intensity_baseline_kg_co2e_per_kg_lwg, 2),
          intensity_after_abatement_kg_co2e_per_kg_gain: r(lastEc.ch4_intensity_kg_co2e_per_kg_lwg, 2),
        } : null,
        weights: lastWt ? {
          date: hobartDate(lastWt.snapshot_date),
          rolling_weight_14d_kg: r(lastWt.rolling_weight_14d),
          rolling_adg_g_day: lastWt.rolling_adg != null ? Math.round(lastWt.rolling_adg) : null,
          adg_95pct_band_g_day: lastWt.rolling_adg_ci_lower != null && lastWt.rolling_adg_ci_upper != null
            ? [Math.round(lastWt.rolling_adg_ci_lower), Math.round(lastWt.rolling_adg_ci_upper)] : null,
        } : null,
      };
      if (!closed.has(farm)) {
        const flags = [];
        const emAge = daysAgo(lastEm && lastEm.record_date), wtAge = daysAgo(lastWt && lastWt.snapshot_date);
        if (emAge == null) flags.push("no emissions data yet");
        else if (emAge > STALE_DAYS) flags.push(`emissions data ${emAge} days old`);
        if (wtAge == null) flags.push("no OptiWeigh weights");
        else if (wtAge > STALE_DAYS) flags.push(`last OptiWeigh weight ${wtAge} days old`);
        if (t === "seafeed" && lastEm && lastEm.intake_g_per_hd_day != null && lastEm.intake_g_per_hd_day < 30)
          flags.push(`low KleenGrow intake (${r(lastEm.intake_g_per_hd_day)} g/head/day)`);
        if (t === "seafeed" && lastEm && lastEm.abatement_rate == null)
          flags.push("no abatement figure (no liveweight to estimate dry matter intake)");
        mob.attention = flags;
      }
      mobs.push(mob);
    }
  }

  const adgLatest = Object.values(latestBy(adg, (a) => `${a.farm_name}|${a.window_days}`, "comparison_date"))
    .filter((a) => a.window_days === 9999 || a.window_days === 30)
    .sort((a, b) => String(a.farm_name).localeCompare(String(b.farm_name)) || a.window_days - b.window_days)
    .map((a) => ({
      farm: a.farm_name, window: a.window_days === 9999 ? "start to date" : `${a.window_days} days`,
      date: hobartDate(a.comparison_date), kleengrow_adg_g: r(a.seafeed_adg, 0), control_adg_g: r(a.control_adg, 0),
      difference_pct: r(a.diff_pct), eligible: a.eligible, note: a.note || null,
    }));

  const blocks = Object.values(latestBy(usage, (a) => `${a.trial_site}|${a.treatment}`, "snapshot_date"))
    .sort((a, b) => String(a.trial_site).localeCompare(String(b.trial_site)) || String(a.treatment).localeCompare(String(b.treatment)))
    .map((a) => ({
      site: a.trial_site, treatment: a.treatment, date: hobartDate(a.snapshot_date),
      head_count: a.head_count, blocks_per_day: r(a.blocks_per_day_current, 2),
      cumulative_blocks_used: r(a.cumulative_blocks_used, 1), consumption_g_hd_day: r(a.avg_consumption_g_per_hd_day),
    }));

  const h = headline.sort((a, b) => a.record_date - b.record_date).slice(-1)[0];
  const whole = h ? {
    date: hobartDate(h.record_date), abatement_pct: r(h.abatement_rate_pct), intake_g_hd_day: r(h.intake_g_per_hd_day),
    ch4_abated_g_hd_day: r(h.methane_abated_g_per_hd_day, 2), co2e_abated_tonnes: r(h.co2e_abated_t, 2),
    animal_days: h.animal_days, cohorts: h.cohorts,
    adg_kleengrow_g: r(h.adg_seafeed_g, 0), adg_control_g: r(h.adg_control_g, 0), adg_difference_pct: r(h.adg_diff_pct, 2),
  } : null;

  const model = {};
  for (const [k, v] of Object.entries(assumptions[0] || {})) {
    if (v != null && !/objectid|globalid|^shape/i.test(k)) model[k] = v;
  }

  return { as_of: today, whole_project: whole, mobs, adg_comparison: adgLatest, lick_blocks: blocks, model_assumptions: model };
}

export async function fetchSnapshot(fetchFn, nowMs) {
  const since = (days) => sqlTs(nowMs - days * DAY_MS);
  const [headline, emissions, economics, weights, adg, usage, assumptions] = await Promise.all([
    query(fetchFn, "LEL_Trial_Headline_view", { where: "1=1", outFields: "*", orderByFields: "record_date DESC", resultRecordCount: "5" }),
    query(fetchFn, "LEL_Emissions_Data_view", { where: `farm_name <> '${AGGREGATE_LABEL}'`, outFields: "*", orderByFields: "record_date ASC" }),
    query(fetchFn, "LEL_Economics_Data", { where: `farm_name <> '${AGGREGATE_LABEL}'`, outFields: "*", orderByFields: "calculation_date DESC" }),
    query(fetchFn, "OptiWeigh_Cattle_Weights", {
      where: `farm_name <> '${AGGREGATE_LABEL}' AND snapshot_date >= ${since(30)}`,
      outFields: "farm_name,treatment_group,snapshot_date,rolling_weight_14d,rolling_adg,rolling_adg_ci_lower,rolling_adg_ci_upper",
      orderByFields: "snapshot_date ASC",
    }),
    query(fetchFn, "LEL_ADG_Comparison", { where: `comparison_date >= ${since(5)}`, outFields: "*", orderByFields: "comparison_date DESC" }),
    query(fetchFn, "LEL_Lick_Block_Usage_History", { where: `snapshot_date >= ${since(7)}`, outFields: "*", orderByFields: "snapshot_date DESC" }),
    query(fetchFn, "LEL_Model_Assumptions_Public", { where: "1=1", outFields: "*" }),
  ]);
  return buildSnapshot({ headline, emissions, economics, weights, adg, usage, assumptions }, nowMs);
}
