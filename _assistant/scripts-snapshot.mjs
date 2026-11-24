// Prints today's live data snapshot (public layers only, no secrets), so a pull request shows
// exactly what the assistant would answer from.  Usage: node scripts-snapshot.mjs
import { fetchSnapshot } from "./src/data.js";
const s = await fetchSnapshot(fetch, Date.now());
const text = JSON.stringify(s);
console.log(`Snapshot as of ${s.as_of}: ${s.mobs.length} mob(s), ${text.length} characters (~${Math.round(text.length / 3.5)} tokens)`);
for (const m of s.mobs) {
  console.log(`  ${m.farm} / ${m.treatment} [${m.status}] latest ${m.latest ? `${m.latest.date} ${m.latest.abatement_pct}% ${m.latest.intake_g_hd_day} g` : "-"}`
    + (m.attention && m.attention.length ? `  ATTENTION: ${m.attention.join("; ")}` : ""));
}
console.log("Whole Project:", JSON.stringify(s.whole_project));
console.log("ADG:", JSON.stringify(s.adg_comparison));
console.log("Blocks:", JSON.stringify(s.lick_blocks));
console.log("Model:", JSON.stringify(s.model_assumptions));
