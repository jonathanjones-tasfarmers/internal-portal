# Farm results page build

Source for `../lel-farm-results-e6ca6b1a6425.html` (the LEL farm results page iframed into the Hub site). Moved here from the private `lel-farm-results` repo on 23 Nov 2026 so the page can rebuild itself every day without a cross-repo token. The finished page was already public in this repo, so this adds little exposure. The underscore folder name keeps these files out of the GitHub Pages site.

- **Daily:** `.github/workflows/farm-results-refresh.yml` runs at 03:30 UTC (13:30 AEST / 14:30 AEDT): `fetch_data.py <yesterday>`, `build.py`, copy to the root file, commit. To refresh now: Actions, "Daily farm results refresh", "Run workflow" (optional cap date).
- **Edit the page here:** `src/index.template.html`. Open-cohort tiles (CO2e, abatement, intake and dose, weights, ADG, day count, verdict) are calculated from `data/data.json` for the cohorts in the `OPEN` list near the end of the template. The Growth page's four ADG and weight cards follow the rolling 14-day series for open cohorts (since 26 Nov 2026; they used to be hand-typed OptiWeigh windows and went stale). Cost, blocks, lab, head counts and closed-cohort figures are still hand-written. When a cohort closes, remove it from `OPEN` and write its final figures in.
- **By hand:** `python3 fetch_data.py [YYYY-MM-DD] && python3 build.py && cp dist/governance.html ../lel-farm-results-e6ca6b1a6425.html`.

## Government view (added 26 Nov 2026)

`build_government.py` builds `../lel-project-results-gov-9f5e0da4a403.html`, the page Jono uses when presenting to Government. It is a separate file built from a cut-down data set, so costs, prices, bromoform lab results, dosing guidance, feeding set-ups, pasture data, farm names, start dates and exact head counts are never in its source. The Governance page no longer has a Government toggle.

- **Edit its words** in the `COHORTS`, `MESSAGES`, `NEXT` and `MILESTONES` lists at the top of `build_government.py`, and its layout in `src/government.template.html`. It reuses the Governance page's styles.
- **Safety check:** the build stops if the page contains any word in `CHECK_TERMS` (farm names, "trial", bromoform, prices, budget, troughs and so on). Add to that list rather than removing from it.
- **When a cohort closes,** set `open=False` and write its final growth figures and cost verdict in `COHORTS`, as for Cohort 1.
- **By hand:** `python3 build_government.py && cp dist/government.html ../lel-project-results-gov-9f5e0da4a403.html`.
