/* ============================================================
   LEL Staff Portal: shared helpers (added 2026-11-25, portal
   simplification). Loaded by every *-portal.html page before its
   own script. Exposes window.LELPortal.

   Cohorts. The pipelines name a farm's later cohorts with a suffix
   ("Bowood Farm - Cohort 2") and leave the first cohort under the
   plain farm name ("Bowood Farm"). Pages used to show these as
   separate farms. These helpers let every page show one farm with a
   cohort label, and move a finished cohort into the Archive fold:
   a cohort is closed when the same farm has a later cohort.
   ============================================================ */
(function () {
  var COHORT_RE = /^(.*?)\s*-\s*Cohort\s*(\d+)\s*$/i;

  function parse(site) {
    var m = COHORT_RE.exec(site || "");
    if (m) return { farm: m[1], cohort: parseInt(m[2], 10) };
    return { farm: site || "", cohort: 1 };
  }

  // The highest cohort number seen for each farm in a list of site names.
  function latestByFarm(allSites) {
    var latest = {};
    (allSites || []).forEach(function (s) {
      var p = parse(s);
      if (!latest[p.farm] || p.cohort > latest[p.farm]) latest[p.farm] = p.cohort;
    });
    return latest;
  }

  // True when this site is an earlier cohort of a farm that has a later one.
  function isClosed(site, allSites) {
    var p = parse(site);
    return latestByFarm(allSites)[p.farm] > p.cohort;
  }

  // True when the farm has more than one cohort in the list, so the
  // cohort label is worth showing.
  function hasCohorts(site, allSites) {
    var p = parse(site);
    return (allSites || []).some(function (s) {
      return s !== site && parse(s).farm === p.farm;
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // "Bowood Farm <span class=lp-cohort>Cohort 2</span>" as HTML.
  function nameHtml(site, allSites) {
    var p = parse(site);
    var label =
      hasCohorts(site, allSites) || p.cohort > 1
        ? ' <span class="lp-cohort' +
          (isClosed(site, allSites) ? " closed" : "") +
          '">Cohort ' +
          p.cohort +
          (isClosed(site, allSites) ? ", closed" : "") +
          "</span>"
        : "";
    return esc(p.farm) + label;
  }

  // Plain-text version, for chart labels and alerts.
  function nameText(site, allSites) {
    var p = parse(site);
    return hasCohorts(site, allSites) || p.cohort > 1
      ? p.farm + " (Cohort " + p.cohort + ")"
      : p.farm;
  }

  // Splits a list of site names into current and closed, keeping order.
  function split(allSites) {
    var current = [],
      closed = [];
    (allSites || []).forEach(function (s) {
      (isClosed(s, allSites) ? closed : current).push(s);
    });
    return { current: current, closed: closed };
  }

  // A <details> fold as an HTML string.
  function fold(summary, bodyHtml, opts) {
    opts = opts || {};
    return (
      '<details class="lp-fold' +
      (opts.cls ? " " + opts.cls : "") +
      '"' +
      (opts.id ? ' id="' + opts.id + '"' : "") +
      (opts.open ? " open" : "") +
      "><summary>" +
      summary +
      (opts.hint ? ' <span class="lp-fold-hint">' + opts.hint + "</span>" : "") +
      '</summary><div class="lp-fold-body">' +
      bodyHtml +
      "</div></details>"
    );
  }

  // Charts drawn inside a closed fold have no size until it opens.
  // Chart.js resizes on its own when the container changes, but a
  // chart created while hidden can stay at 0 px in some browsers, so
  // pages call this to nudge every chart in a fold when it opens.
  function resizeChartsOnOpen(root) {
    (root || document).addEventListener(
      "toggle",
      function (e) {
        var d = e.target;
        if (!d || d.tagName !== "DETAILS" || !d.open) return;
        if (!window.Chart || !window.Chart.instances) return;
        Object.keys(window.Chart.instances).forEach(function (k) {
          var c = window.Chart.instances[k];
          if (c && c.canvas && d.contains(c.canvas)) c.resize();
        });
      },
      true,
    );
  }
  resizeChartsOnOpen(document);

  window.LELPortal = {
    parse: parse,
    isClosed: isClosed,
    hasCohorts: hasCohorts,
    nameHtml: nameHtml,
    nameText: nameText,
    split: split,
    fold: fold,
    esc: esc,
  };
})();
