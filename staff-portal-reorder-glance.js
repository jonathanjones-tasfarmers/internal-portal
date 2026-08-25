// LEL Staff Portal — "Reorder at a glance" logic.
//
// Moved OUT of an inline <script> tag in staff-portal-home-content.html
// on 2026-08-25 (round 3): Hub renders pasted content via innerHTML, and
// <script> tags inserted that way never execute (standard browser
// behaviour) — this is why the cards were stuck on "Loading reorder
// data…" forever. Scripts loaded via a dynamically-created <script src>
// element (added with appendChild, not parsed as part of an innerHTML
// string) DO execute, so this file is loaded that way — see the hidden
// <img onerror=...> trick at the bottom of staff-portal-home-content.html
// that pulls this file in.
//
// Host this on GitHub Pages (same repo as lickblock-internal-portal.html)
// and keep the <img onerror> src in staff-portal-home-content.html
// pointing at wherever this file actually ends up.
//
// Same two services, same fields, same REORDER_LEAD_DAYS as
// lickblock-internal-portal.html's own reorder maths — kept in sync
// manually since these are separate files. If you ever change the
// reorder maths in one, change it in both.
(function(){
  var USAGE_HISTORY_URL = "https://services6.arcgis.com/RkRGg1mAki7yG3EG/arcgis/rest/services/LEL_Lick_Block_Usage_History/FeatureServer/0/query";
  var ORDERS_URL         = "https://services6.arcgis.com/RkRGg1mAki7yG3EG/arcgis/rest/services/LEL_Lick_Block_Orders/FeatureServer/0/query";
  var REORDER_LEAD_DAYS = 40;
  var SOON_THRESHOLD_DAYS = 14; // reorder-by within this many days = "soon" (amber), this page's own triage threshold

  function q(url, params){
    return fetch(url + "?" + new URLSearchParams(params)).then(function(res){ return res.json(); }).then(function(data){
      if (data.error) throw new Error(data.error.message || "Query failed");
      return data;
    });
  }
  function fetchUsageHistory(){
    return q(USAGE_HISTORY_URL, {
      where: "treatment IN ('seafeed','control')",
      outFields: "snapshot_date,trial_site,treatment,cumulative_blocks_used,blocks_per_day_current",
      orderByFields: "snapshot_date ASC", resultRecordCount: "4000", f: "json"
    }).then(function(data){ return data.features.map(function(f){ return f.attributes; }); }).catch(function(err){
      console.error('Usage history fetch failed:', err);
      return [];
    });
  }
  function fetchOrders(){
    return q(ORDERS_URL, {
      where: "treatment IN ('seafeed','control')",
      outFields: "trial_site,treatment,blocks_ordered,order_date",
      orderByFields: "order_date ASC", resultRecordCount: "1000", f: "json"
    }).then(function(data){ return data.features.map(function(f){ return f.attributes; }); }).catch(function(err){
      console.error('Orders fetch failed:', err);
      return [];
    });
  }
  function fmtDate(ms){
    if (ms == null) return '–';
    return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function treatmentLabel(t){ return t === 'seafeed' ? 'SeaFeed' : 'Control'; }

  Promise.all([fetchUsageHistory(), fetchOrders()]).then(function(results){
    var usageHistory = results[0], orders = results[1];
    var grid = document.getElementById('sp-glance-grid');
    if (!grid) return; // this page's markup isn't present — nothing to do
    var farms = Array.from(new Set(usageHistory.map(function(r){ return r.trial_site; }))).sort();

    if (!farms.length) {
      grid.innerHTML = '<p class="sp-empty-note">No usage history yet — run 06. Lick_Block_Portal_Feed.py to populate this.</p>';
      return;
    }

    // Build one row of maths per (farm, treatment) — identical logic to
    // lickblock-internal-portal.html's "reorder maths, per treatment".
    var rows = [];
    farms.forEach(function(farm){
      var farmHistory = usageHistory.filter(function(r){ return r.trial_site === farm; });
      var farmOrders = orders.filter(function(r){ return r.trial_site === farm; });
      var latestByTreatment = {};
      farmHistory.forEach(function(r){
        if (!latestByTreatment[r.treatment] || r.snapshot_date > latestByTreatment[r.treatment].snapshot_date) latestByTreatment[r.treatment] = r;
      });
      var orderedByTreatment = { seafeed: 0, control: 0 };
      farmOrders.forEach(function(r){
        if (r.treatment === 'seafeed' || r.treatment === 'control') orderedByTreatment[r.treatment] += (r.blocks_ordered || 0);
      });

      ['seafeed', 'control'].forEach(function(treatment){
        var latest = latestByTreatment[treatment];
        var ordered = orderedByTreatment[treatment];
        var row = { farm: farm, treatment: treatment, status: 'ok', reorderByMs: null, note: '' };

        if (!latest) { row.status = 'nodata'; row.note = 'No usage history yet'; rows.push(row); return; }
        if (!ordered) { row.status = 'nodata'; row.note = 'No orders logged yet'; rows.push(row); return; }

        var onHand = ordered - latest.cumulative_blocks_used;
        var rate = latest.blocks_per_day_current;
        if (!rate || rate <= 0) { row.status = 'nodata'; row.note = 'Not enough data for a rate yet'; rows.push(row); return; }

        var daysToEmpty = onHand / rate;
        var runOutMs = Date.now() + daysToEmpty * 86400000;
        var reorderByMs = runOutMs - REORDER_LEAD_DAYS * 86400000;
        var outOfStock = onHand <= 0;
        var overdue = reorderByMs <= Date.now() || outOfStock;
        var soon = !overdue && reorderByMs <= Date.now() + SOON_THRESHOLD_DAYS * 86400000;

        row.reorderByMs = reorderByMs;
        row.onHand = onHand;
        row.daysToEmpty = daysToEmpty;
        row.status = overdue ? 'overdue' : (soon ? 'soon' : 'ok');
        row.note = outOfStock ? 'Out of stock — order now'
          : overdue ? 'Past reorder date — order now'
          : Math.max(0, Math.round(daysToEmpty)) + ' days of supply left';
        rows.push(row);
      });
    });

    // Soonest reorder date first (overdue effectively sorts first since
    // its reorderByMs is already in the past); "no data" rows pushed last.
    rows.sort(function(a, b){
      if (a.reorderByMs == null && b.reorderByMs == null) return 0;
      if (a.reorderByMs == null) return 1;
      if (b.reorderByMs == null) return -1;
      return a.reorderByMs - b.reorderByMs;
    });

    grid.innerHTML = rows.map(function(r){
      var statusClass = r.status === 'overdue' ? 'overdue' : (r.status === 'soon' ? 'soon' : '');
      var valueText = r.reorderByMs != null ? fmtDate(r.reorderByMs) : '–';
      return '<div class="sp-glance-card ' + statusClass + '">' +
        '<p class="sp-glance-label">' + r.farm + ' &mdash; ' + treatmentLabel(r.treatment) + '</p>' +
        '<p class="sp-glance-value ' + statusClass + '">' + valueText + '</p>' +
        '<p class="sp-glance-note' + (r.status === 'overdue' ? ' stale' : '') + '">' + r.note + '</p>' +
        '</div>';
    }).join('');
  }).catch(function(err){
    console.error('Reorder glance failed:', err);
    var g = document.getElementById('sp-glance-grid');
    if (g) g.innerHTML = '<p class="sp-empty-note">Could not load reorder data — check the console for details.</p>';
  });
})();
