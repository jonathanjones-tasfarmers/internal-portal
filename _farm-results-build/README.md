# Farm results page build

Source for `../lel-farm-results-e6ca6b1a6425.html` (the LEL farm results page iframed into the Hub site). Moved here from the private `lel-farm-results` repo on 23 Nov 2026 so the page can rebuild itself every day without a cross-repo token. The finished page was already public in this repo, so this adds little exposure. The underscore folder name keeps these files out of the GitHub Pages site.

- **Daily:** `.github/workflows/farm-results-refresh.yml` runs at 03:30 UTC (13:30 AEST / 14:30 AEDT): `fetch_data.py <yesterday>`, `build.py`, copy to the root file, commit. To refresh now: Actions, "Daily farm results refresh", "Run workflow" (optional cap date).
- **Edit the page here:** `src/index.template.html`. Open-cohort tiles (CO2e, abatement, intake and dose, weights, ADG, day count, verdict) are calculated from `data/data.json` for the cohorts in the `OPEN` list near the end of the template. Cost, blocks, lab, OptiWeigh-native ADG windows, head counts and closed-cohort figures are still hand-written. When a cohort closes, remove it from `OPEN` and write its final figures in.
- **By hand:** `python3 fetch_data.py [YYYY-MM-DD] && python3 build.py && cp dist/governance.html ../lel-farm-results-e6ca6b1a6425.html`.
