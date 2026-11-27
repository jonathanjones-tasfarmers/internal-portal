/* LEL Finance site: shared code (added 2026-11-27) for lel-finance.html (Overview) and lel-spend-model.html (Spend Model).
   PUBLIC CODE, NO DATA. Every figure is read at view time from the private LEL_Fin_* tables in ArcGIS Online with the
   viewer's own sign-in (OAuth app "LEL Finance page sign-in"); only the LEL Finance group can read them.
   Holds: sign-in, data loading, formatting, theme, the 5 plain budget categories, and the spend model engine,
   so both pages tell the same story. */
(function () {
  "use strict";
  var F = window.LELFIN = {};
  var CLIENT_ID = "58PHUu9Nh1IwHqhb";
  var PORTAL = F.PORTAL = "https://indie520d1a051c0.maps.arcgis.com/sharing/rest";
  var PAGE = location.origin + location.pathname;
  F.ITEMS = {
    monthly: "bb2dcba9483a499c9d4c67931d36443e", snapshot: "7f4342b8e0a949109eed9193e9e4490d",
    bills: "72fdc4c8c2c048eaad4aded590542114", budget: "dc9a5bef6c4a426cb28b50edb188e412",
    contrib: "e1acce3bd4614c01a042def0842ef29f", milestones: "debed9f9fda64513a56aaa9564d4b980"
  };
  var PUB = "https://services6.arcgis.com/RkRGg1mAki7yG3EG/arcgis/rest/services/";
  F.TARGETS_URL = PUB + "LEL_Onboarding_Targets/FeatureServer/0/query?where=1%3D1&outFields=species,year_,quarter,target_farms_cumulative,target_head_cumulative&f=json";
  F.DIRECTORY_URL = PUB + "LEL_Farm_Directory_view/FeatureServer/0/query?where=1%3D1&outFields=trial_site,species,committed_head_count,pipeline_stage&f=json";
  var KEY = "lelFinToken";

  /* ---------- theme (light / dark, remembered per viewer) ---------- */
  var THEME_KEY = "lelFinTheme";
  function applyTheme(t) { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (e) {}
  F.isDark = function () {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  };
  F.toggleTheme = function () {
    var next = F.isDark() ? "light" : "dark";
    applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    if (F.onTheme) F.onTheme();
  };
  F.css = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };

  /* ---------- sign-in (ArcGIS OAuth implicit flow, remembered 14 days in this browser) ---------- */
  function readHash() {
    if (!/access_token=/.test(location.hash)) return null;
    var p = new URLSearchParams(location.hash.slice(1));
    return { token: p.get("access_token"), expires: Date.now() + (parseInt(p.get("expires_in"), 10) || 7200) * 1000, user: p.get("username") };
  }
  function store(t) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch (e2) {} } }
  F.token = function () {
    var t = null;
    try { t = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!t) { try { t = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) {} }
    return t && t.expires > Date.now() + 60000 ? t : null;
  };
  F.signOut = function () { try { localStorage.removeItem(KEY); } catch (e) {} try { sessionStorage.removeItem(KEY); } catch (e) {} location.reload(); };
  function authUrl() { return PORTAL + "/oauth2/authorize?client_id=" + CLIENT_ID + "&response_type=token&expiration=20160&redirect_uri=" + encodeURIComponent(PAGE); }
  F.signIn = function () { if (window.top !== window) window.open(authUrl(), "lelfin", "width=520,height=680"); else location.href = authUrl(); };
  /* Returns false when this window is only the sign-in popup (it hands the token back and closes). */
  F.handleRedirect = function (onToken) {
    var h = readHash();
    if (h) {
      if (window.opener && window.opener !== window) {
        try { window.opener.postMessage({ lelFinToken: h }, location.origin); } catch (e) {}
        window.close();
        document.body.innerHTML = "<p style='font-family:Verdana;padding:30px'>Signed in. You can close this window.</p>";
        return false;
      }
      store(h); history.replaceState(null, "", PAGE);
    }
    window.addEventListener("message", function (ev) {
      if (ev.origin !== location.origin || !ev.data || !ev.data.lelFinToken) return;
      store(ev.data.lelFinToken); onToken();
    });
    return true;
  };
  F.inFrame = window.top !== window;

  /* ---------- data ---------- */
  function getJSON(url, token) {
    return fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "f=json" + (token ? "&token=" + encodeURIComponent(token) : "")).then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.error) { var e = new Error(j.error.message || "ArcGIS error"); e.code = j.error.code; throw e; } return j; });
  }
  F.getJSON = getJSON;
  F.postJSON = function (url, params, token) {
    var body = new URLSearchParams(params); body.set("f", "json"); body.set("token", token);
    return fetch(url, { method: "POST", body: body }).then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.error) throw new Error(j.error.message || "ArcGIS error"); return j; });
  };
  function rows(j) { return (j.features || []).map(function (f) { return f.attributes; }); }
  F.rows = rows;
  F.table = function (key, token) {
    return getJSON(PORTAL + "/content/items/" + F.ITEMS[key], token).then(function (item) {
      return getJSON(item.url.replace(/\/$/, "") + "/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=4000", token);
    }).then(rows);
  };
  F.pub = function (url) { return fetch(url).then(function (r) { return r.json(); }).then(rows).catch(function () { return []; }); };
  /* Loads everything both pages need. */
  F.loadAll = function (token) {
    var keys = Object.keys(F.ITEMS);
    return Promise.all(keys.map(function (k) { return F.table(k, token); }).concat([F.pub(F.TARGETS_URL), F.pub(F.DIRECTORY_URL)]))
      .then(function (r) { var d = {}; keys.forEach(function (k, i) { d[k] = r[i]; }); d.targets = r[keys.length]; d.directory = r[keys.length + 1]; return d; });
  };
  F.errorMessage = function (e) {
    if (e.code === 498 || e.code === 499) { return { expired: true, msg: "Your sign-in has expired. Please sign in again." }; }
    if (e.code === 403 || e.code === 400) return { msg: "You are signed in, but your account is not in the LEL Finance group, so the figures are hidden. Ask Jono to add you." };
    return { msg: "The figures could not be loaded (" + e.message + "). Try again in a minute." };
  };

  /* ---------- formatting ---------- */
  F.money = function (v, dp) {
    if (v == null || isNaN(v)) return "–";
    var a = Math.abs(v), s = v < 0 ? "-$" : "$";
    if (a >= 1e6) return s + (a / 1e6).toFixed(dp == null ? 2 : dp) + "M";
    if (a >= 1e4) return s + Math.round(a / 1e3) + "k";
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "k";
    return s + Math.round(a);
  };
  F.full = function (v) { return v == null || isNaN(v) ? "–" : (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-AU"); };
  F.int = function (v) { return Math.round(v).toLocaleString("en-AU"); };
  F.pct = function (v) { return v == null || isNaN(v) ? "–" : Math.round(v * 100) + "%"; };
  var MON = F.MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  F.ym = function (d) { return d.getFullYear() * 12 + d.getMonth(); };
  F.ymLabel = function (n, long) { var y = Math.floor(n / 12), m = n % 12; return MON[m] + " " + (long ? y : String(y).slice(2)); };
  F.dmy = function (ms) { if (!ms) return "–"; var d = new Date(ms); return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); };
  F.esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  F.set = function (id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; };
  F.sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
  F.fyStart = function (m) { return m % 12 >= 6 ? m - (m % 12) + 6 : m - (m % 12) - 6; };   // Xero year runs July to June

  /* ---------- the 5 plain categories ---------- */
  F.GROUPS = ["People", "Feed and freight", "On-farm and research", "Governance and comms", "Contingency"];
  F.group = function (category) {
    var c = String(category || "");
    if (/Wages|Superannuation/i.test(c)) return "People";
    if (/^SF -|Feed|Freight|Delivery/i.test(c)) return "Feed and freight";
    if (/Research|Monitoring|Infrastructure/i.test(c)) return "On-farm and research";
    if (/Governance|Communications|Bank/i.test(c)) return "Governance and comms";
    if (/Contingency/i.test(c)) return "Contingency";
    return "Governance and comms";
  };
  F.groupColor = function (g) {
    return { "People": F.isDark() ? "#c3cfd8" : "#041221", "Feed and freight": "#3aa989", "On-farm and research": "#c98a2e",
             "Governance and comms": "#5f8bb0", "Contingency": F.isDark() ? "#4b6074" : "#a9b8c4" }[g];
  };
  F.budgetByGroupYear = function (budget) {   // {group: {year: aud}}
    var o = {}; F.GROUPS.forEach(function (g) { o[g] = {}; });
    budget.forEach(function (b) { var g = F.group(b.category); o[g][b.year] = (o[g][b.year] || 0) + b.budget_aud; });
    return o;
  };
  F.budgetBetween = function (byYear, from, to) {   // calendar-year budget spread evenly over its 12 months, months from..to inclusive
    var s = 0; for (var m = from; m <= to; m++) s += (byYear[Math.floor(m / 12)] || 0) / 12; return s;
  };

  /* ---------- the spend model ---------- */
  var COSTS = F.COSTS = {   // 01. TLEL Project Budget.xlsx (Supplement Costs, Beef Farm Costs, Project Budget sheets), read 27 Nov 2026
    sfPrice: 3.66, ctrlPrice: 2.35, frCattle: 500, frSheep: 600, doseCattleKg: 0.150, doseSheepKg: 0.015,
    farmSetup: 20170, farmRun: 3180, sheepSetup: 2500, tissue: 2.06, contPct: 10, headPerFarm: 250
  };
  F.ACTUAL_INTAKE_PCT = 32;   // ~48 g/head/day measured to 30 Oct 2026 = 32% of the 150 g dose
  var DAYS = 30.42;
  function qEnd(q) { return q.y * 12 + q.q * 3 - 1; }
  F.qEnd = qEnd;

  F.derive = function (d) {
    var snap = d.snapshot.slice().sort(function (a, b) { return b.snapshot_date - a.snapshot_date; })[0] || {};
    var S = F.ym(new Date(snap.snapshot_date || Date.now()));
    var mrows = d.monthly.map(function (r) { r.ym = F.ym(new Date(r.month)); r.group = F.group(r.category); return r; });
    var exp = mrows.filter(function (r) { return r.kind === "expense"; });
    var inc = mrows.filter(function (r) { return r.kind === "income"; });

    var wageBy = {}; exp.filter(function (r) { return /wages/i.test(r.account); }).forEach(function (r) { wageBy[r.ym] = (wageBy[r.ym] || 0) + r.amount_aud; });
    var posted = Object.keys(wageBy).map(Number).filter(function (m) { return wageBy[m] > 0 && m <= S; }).sort(function (a, b) { return a - b; });
    var lastPosted = posted.length ? posted[posted.length - 1] : S;
    var w6 = []; for (var m = lastPosted - 5; m <= lastPosted; m++) w6.push(wageBy[m] || 0);
    var OV = /Project Governance|Communications|Bank Fees/;
    var ovBy = {}; exp.filter(function (r) { return OV.test(r.category) || /travel/i.test(r.account); }).forEach(function (r) { ovBy[r.ym] = (ovBy[r.ym] || 0) + r.amount_aud; });
    var ov12 = []; for (m = S - 12; m < S; m++) ov12.push(ovBy[m] || 0);
    var wc = snap.working_capital_aud;
    var intBy = {}; inc.filter(function (r) { return /interest/i.test(r.account); }).forEach(function (r) { intBy[r.ym] = (intBy[r.ym] || 0) + r.amount_aud; });
    var i6 = []; for (m = S - 6; m < S; m++) i6.push(intBy[m] || 0);
    var interest = wc > 0 && F.sum(i6) > 0 ? Math.round(F.sum(i6) / 6 * 12 / wc * 1000) / 10 : 4.0;

    var partners = d.contrib.filter(function (c) { return c.kind === "cash" && !/grant/i.test(c.partner); }).map(function (c) {
      var got = c.xero_account ? inc.filter(function (r) { return r.account === c.xero_account; }).reduce(function (a, r) { return a + r.amount_aud; }, 0) : 0;
      return { name: c.partner, target: c.target_aud || 0, received: got, inXero: !!c.xero_account, left: Math.max(0, (c.target_aud || 0) - got) };
    });

    var live = d.directory.filter(function (f) { return !f.pipeline_stage || /active|live|onboard/i.test(f.pipeline_stage); });
    var beefNow = F.sum(live.filter(function (f) { return f.species === "Beef"; }).map(function (f) { return f.committed_head_count || 0; }));
    var sheepNow = F.sum(live.filter(function (f) { return f.species === "Sheep"; }).map(function (f) { return f.committed_head_count || 0; }));
    var tq = {};
    d.targets.forEach(function (t) {
      var k = t.year_ + "-" + t.quarter; tq[k] = tq[k] || { y: t.year_, q: t.quarter };
      if (t.species === "Beef") { tq[k].cattle = t.target_head_cumulative; tq[k].farms = t.target_farms_cumulative; }
      if (t.species === "Sheep") { tq[k].sheep = t.target_head_cumulative; tq[k].sheepFarms = t.target_farms_cumulative; }
    });
    var quarters = Object.keys(tq).map(function (k) { return tq[k]; }).filter(function (q) { return qEnd(q) >= S; })
      .sort(function (a, b) { return qEnd(a) - qEnd(b); })
      .map(function (q) { return { y: q.y, q: q.q, cattle: q.cattle || 0, sheep: q.sheep || 0, farms: q.farms || 0, sheepFarms: q.sheepFarms || 0 }; });

    var budget = {}; d.budget.forEach(function (b) { budget[b.year] = (budget[b.year] || 0) + b.budget_aud; });
    var D = { snap: snap, S: S, start: S + 1, horizon: 2029 * 12 + 11, wc: wc, lastPosted: lastPosted, unposted: Math.max(0, S - lastPosted), w6from: lastPosted - 5,
              beefNow: beefNow, sheepNow: sheepNow, beefFarmsNow: live.filter(function (f) { return f.species === "Beef"; }).length,
              sheepFarmsNow: live.filter(function (f) { return f.species === "Sheep"; }).length, budget: budget,
              budgetGroups: F.budgetByGroupYear(d.budget), partners: partners, roadmapOK: d.targets.length > 0,
              exp: exp, inc: inc, wageAvg: F.sum(w6) / 6, overAvg: F.sum(ov12) / 12 };
    var pp = {}; partners.filter(function (p) { return p.left > 0; }).forEach(function (p) { pp[p.name] = { on: true, amt: Math.round(p.left) }; });
    var DEF = {
      q: quarters, headScale: 100, feedEnd: 2028 * 12 + 11, ctrlPct: 100, intakePct: F.ACTUAL_INTAKE_PCT,
      sfPrice: COSTS.sfPrice, ctrlPrice: COSTS.ctrlPrice, frCattle: COSTS.frCattle, frSheep: COSTS.frSheep,
      farmSetup: COSTS.farmSetup, farmRun: COSTS.farmRun, sheepSetup: COSTS.sheepSetup, tissue: COSTS.tissue,
      contPct: COSTS.contPct, wage: Math.round(D.wageAvg / 100) * 100, wageGrowth: 3, catchup: true,
      overheads: Math.round(D.overAvg / 100) * 100, projEnd: 2029 * 12 + 1, partners: pp, partnersOn: true,
      cStart: 2027 * 12 + 2, cEnd: 2028 * 12 + 11, scaleProd: false, interest: interest,
      extraHead: 0, extraFrom: Math.max(S + 1, 2027 * 12 + 6), reserve: 400000
    };
    D.DEF = DEF;
    D.baseFeed = F.run(D, DEF, { extra: 0 }).feedTotal || 1;
    return D;
  };

  function interp(pts, m) {
    if (!pts.length) return 0;
    if (m <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (m <= pts.at(i)[0]) { var a = pts.at(i - 1), b = pts.at(i); return a[1] + (b[1] - a[1]) * (m - a[0]) / (b[0] - a[0]); }
    }
    return pts[pts.length - 1][1];
  }
  /* One month-by-month run of the model. opt: {extra, feedRatio, scale:{intake, head, price, wage, partner}} */
  F.run = function (D, p, opt) {
    opt = opt || {};
    var sc = opt.scale || {};
    var extra = opt.extra != null ? opt.extra : p.extraHead || 0;
    var S = D.S, st = D.start, H = D.horizon, hs = (p.headScale == null ? 100 : p.headScale) / 100 * (sc.head || 1);
    function pts(field, now, scale) { return [[S, now]].concat(p.q.filter(function (q) { return qEnd(q) > S; }).map(function (q) { return [qEnd(q), (Number(q[field]) || 0) * scale]; })); }
    var pC = pts("cattle", D.beefNow, hs), pS = pts("sheep", D.sheepNow, hs), pF = pts("farms", D.beefFarmsNow, hs), pSF = pts("sheepFarms", D.sheepFarmsNow, hs);
    var share = p.intakePct / 100 * (sc.intake || 1), sfP = p.sfPrice * (sc.price || 1), ctP = p.ctrlPrice * (sc.price || 1);
    var wage = p.wage * (sc.wage || 1);
    var extraFarms = extra > 0 ? Math.ceil(extra / COSTS.headPerFarm) : 0;
    function farmsC(m) { return m > p.feedEnd ? 0 : Math.round(interp(pF, m)) + (m >= p.extraFrom ? extraFarms : 0); }
    function farmsS(m) { return m > p.feedEnd ? 0 : Math.round(interp(pSF, m)); }
    var out = { months: [], bal: [], sf: [], ctrl: [], fr: [], farms: [], wages: [], over: [], cont: [], partner: [], interest: [], hc: [], hs: [],
                hdC: 0, feedC: 0, runout: null, minBal: Infinity, endBal: null };
    var nPay = Math.max(1, p.cEnd - p.cStart + 1), payMonthly = 0;
    if (p.partnersOn !== false) Object.keys(p.partners).forEach(function (k) {
      var pp = p.partners[k]; if (!pp.on) return;
      var amt = (pp.amt || 0) * (sc.partner || 1);
      if (p.scaleProd && /producers? feed/i.test(k) && opt.feedRatio != null) amt *= opt.feedRatio;
      payMonthly += amt / nPay;
    });
    var bal = D.wc, prevFC = Math.round(interp(pF, S)), prevFS = Math.round(interp(pSF, S));
    for (var m = st; m <= H; m++) {
      var feeding = m <= p.feedEnd;
      var hc = feeding ? Math.max(0, interp(pC, m)) + (m >= p.extraFrom ? extra : 0) : 0;
      var hsh = feeding ? Math.max(0, interp(pS, m)) : 0;
      var kgC = hc * DAYS * COSTS.doseCattleKg * share, kgS = hsh * DAYS * COSTS.doseSheepKg * share, cPct = p.ctrlPct / 100;
      var sf = (kgC + kgS) * sfP, ctrl = (kgC + kgS) * cPct * ctP;
      var fr = kgC * (1 + cPct) / 1000 * p.frCattle + kgS * (1 + cPct) / 1000 * p.frSheep;
      var fc = farmsC(m), fsh = farmsS(m);
      var farms = Math.max(0, fc - prevFC) * p.farmSetup + Math.max(0, fsh - prevFS) * p.sheepSetup + fc * p.farmRun / 12 + hc * p.tissue / 12;
      if (feeding) { prevFC = fc; prevFS = fsh; }
      var live = m <= p.projEnd;
      var wages = live ? wage * Math.pow(1 + p.wageGrowth / 100, (m - st) / 12) : 0;
      if (m === st && p.catchup) wages += wage * D.unposted;
      var over = live ? p.overheads : 0;
      var cont = p.contPct / 100 * (sf + ctrl + fr + farms);
      var partner = m >= p.cStart && m <= p.cEnd ? payMonthly : 0;
      var interest = live ? Math.max(bal, 0) * p.interest / 100 / 12 : 0;
      bal = bal - (sf + ctrl + fr + farms + wages + over + cont) + partner + interest;
      out.months.push(m); out.bal.push(bal); out.sf.push(sf); out.ctrl.push(ctrl); out.fr.push(fr); out.farms.push(farms);
      out.wages.push(wages); out.over.push(over); out.cont.push(cont); out.partner.push(partner); out.interest.push(interest);
      out.hc.push(hc); out.hs.push(hsh);
      if (hc > 0) { var kc = kgC * cPct; out.feedC += kgC * sfP + kc * ctP + (kgC + kc) / 1000 * p.frCattle; out.hdC += hc * DAYS; }
      if (m <= p.projEnd) {
        out.minBal = Math.min(out.minBal, bal);
        if (out.runout == null && bal < 0) out.runout = m;
        if (m === p.projEnd) out.endBal = bal;
      }
    }
    var n = out.months.filter(function (mm) { return mm <= p.projEnd; }).length;
    out.toEnd = n;
    function tot(k) { var s = 0; for (var i = 0; i < n; i++) s += out[k][i]; return s; }
    out.byGroup = { "Feed and freight": tot("sf") + tot("ctrl") + tot("fr"), "On-farm and research": tot("farms"), "People": tot("wages"),
                    "Governance and comms": tot("over"), "Contingency": tot("cont") };
    out.spendToEnd = F.sum(F.GROUPS.map(function (g) { return out.byGroup[g]; }));
    out.feedTotal = out.byGroup["Feed and freight"];
    out.partnerTotal = tot("partner"); out.interestTotal = tot("interest");
    out.costPerHeadDay = out.hdC > 0 ? out.feedC / out.hdC : null;
    return out;
  };
  F.model = function (D, p, extra, scale) {
    var o = { extra: extra, scale: scale };
    if (p.scaleProd) { var r0 = F.run(D, p, { extra: extra, scale: scale, feedRatio: 1 }); o.feedRatio = r0.feedTotal / D.baseFeed; }
    return F.run(D, p, o);
  };
  F.maxExtra = function (D, p) {
    function ok(n) { return F.model(D, p, n).minBal >= p.reserve; }
    if (!ok(0)) return -1;
    var lo = 0, hi = 500;
    while (ok(hi) && hi < 64000) { lo = hi; hi *= 2; }
    while (hi - lo > 10) { var mid = Math.floor((lo + hi) / 2); if (ok(mid)) lo = mid; else hi = mid; }
    return Math.floor(lo / 10) * 10;
  };
  /* Agreed Budget path from today: funds less the rest of the budget (spread evenly), plus the same partner cash. */
  F.budgetPath = function (D, p, r) {
    var cum = 0;
    return r.months.map(function (m, i) {
      if (m <= p.projEnd) cum += (D.budget[Math.floor(m / 12)] || 0) / 12 - r.partner[i];
      return D.wc - cum;
    });
  };

  /* ---------- chart helpers ---------- */
  F.chartDefaults = function () {
    Chart.defaults.font.family = "Verdana, Tahoma, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.animation = false;
    Chart.defaults.color = F.css("--ink-2");
    Chart.defaults.borderColor = F.css("--line");
  };
  F.axes = function (opts) {
    opts = opts || {};
    return {
      x: { stacked: !!opts.stacked, grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
      y: { stacked: !!opts.stacked, grid: { color: F.css("--line") }, border: { display: false }, beginAtZero: !!opts.zero,
           ticks: { callback: opts.fmt || function (v) { return F.money(v, 1); }, maxTicksLimit: 5 } }
    };
  };
  F.tip = function (fmt) {
    return { backgroundColor: "#041221", padding: 10, cornerRadius: 8, titleFont: { weight: "700" },
             callbacks: { label: function (c) { return " " + c.dataset.label + ": " + (fmt || F.full)(c.parsed.y); } } };
  };
  F.hline = function (getValue, color, dash, label) {
    return { id: "h" + Math.random().toString(36).slice(2), afterDatasetsDraw: function (c) {
      var v = typeof getValue === "function" ? getValue() : getValue; if (v == null) return;
      var y = c.scales.y.getPixelForValue(v), a = c.chartArea; if (y < a.top || y > a.bottom) return;
      var g = c.ctx; g.save(); g.strokeStyle = color; g.lineWidth = 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(a.left, y); g.lineTo(a.right, y); g.stroke();
      if (label) { g.fillStyle = color; g.font = "10.5px Verdana, Tahoma, sans-serif"; g.textAlign = "right"; g.fillText(label, a.right - 2, y - 4); }
      g.restore();
    } };
  };
  F.vline = function (getIndex, label) {
    return { id: "v" + Math.random().toString(36).slice(2), afterDatasetsDraw: function (c) {
      var i = getIndex(); if (i == null || i < 0) return;
      var x = c.scales.x.getPixelForValue(i), a = c.chartArea, g = c.ctx;
      g.save(); g.strokeStyle = F.css("--ink-3"); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke();
      if (label) { g.fillStyle = F.css("--ink-2"); g.font = "10.5px Verdana, Tahoma, sans-serif"; g.textAlign = "left"; g.fillText(label, x + 4, a.top + 10); }
      g.restore();
    } };
  };
  F.sparkline = function (canvas, values, color, fill) {
    return new Chart(canvas, {
      type: "line",
      data: { labels: values.map(function (_, i) { return i; }), datasets: [{ data: values, borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.35,
        fill: !!fill, backgroundColor: function (ctx) {
          var a = ctx.chart.chartArea; if (!a) return "transparent";
          var g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, color + "66"); g.addColorStop(1, color + "00"); return g;
        } }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }, layout: { padding: 2 } }
    });
  };
})();
