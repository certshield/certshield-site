/* CertShield Practice, Offers page (the same model as certshield.academy): five FIXED expandable sections, each a table of exams.
   The page is static HTML built at one moment, so this script repaints it on the visitor's clock: a section's rows are the exams that hold an offer in it ('Community Support: Udemy
   Practice Exam Offers' lists every exam with the instructor's permanent link and is the catalog the other tables are cloned from if an offer appears while the page is open).
   An offer counts only inside [start, end) and inside the month (activation inclusive, expiry exclusive). Every row is repainted at the next boundary and once more on click, so a
   link never points at an expired coupon. Also: one search + category filter over every table (the featured exams are pinned and never filtered), Expand all, hash links that open
   the section holding a row. Without JavaScript the page is still true as built (native <details>). */
(function () {
  'use strict';
  var d = document, w = window, root = d.querySelector('[data-offers-root]');
  if (!root) return;
  var $ = function (s, r) { return (r || d).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
  var LABELS = {}, emb = {};
  try { LABELS = JSON.parse(root.dataset.labels || '{}'); } catch (e) { LABELS = {}; }
  try { emb = JSON.parse(($('#o-data') || {}).textContent || '{}'); } catch (e) { emb = {}; }
  var DATA = { ms: +root.dataset.ms, me: +root.dataset.me, tiers: emb.tiers || {}, links: emb.links || {} };
  var OFFER_SECS = ['deal', 'discount', 'free', 'giveaway'], ENDED = (root.dataset.ended || '').split(',').filter(Boolean);
  var RANK = { free_open: 0, free_targeted: 1, best_price: 2, custom_price: 3 }, timer = null;
  function nowS() { return Math.floor(Date.now() / 1000); }
  function isFree(t) { return t.t === 'free_open' || t.t === 'free_targeted'; }
  function keyOf(t) { return isFree(t) ? (t.t === 'free_open' ? 'gift' : 'giveaway') : (t.k === 'thanks' || t.k === 'discount' ? t.k : 'support'); }
  function secOf(t) { return (LABELS[keyOf(t)] || {}).section || 'referral'; }
  function end(t) { return Math.min(t.e, DATA.me); }
  function usable(t, n) { return n >= DATA.ms && n < DATA.me && t.s <= n && n < end(t); }
  function order(a, b) { return (RANK[a.t] - RANK[b.t]) || ((b.p || 0) - (a.p || 0)) || (end(a) - end(b)); }
  /* times: the visitor's own zone, month spelled out, zone named (never a bare 11/08/26) */
  var fmt = null, fmtS = null;
  try { fmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); } catch (e) { fmt = null; }
  try { fmtS = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); } catch (e) { fmtS = null; }
  function local(sec) { return fmt ? fmt.format(new Date(sec * 1000)) : new Date(sec * 1000).toUTCString(); }
  function iso(sec) { return new Date(sec * 1000).toISOString().replace('.000', ''); }
  function timeEl(sec, attr) { return '<time datetime="' + iso(sec) + '" data-' + attr + '="' + sec + '">' + local(sec) + '</time>'; }
  function timeShort(sec, attr) { return '<time datetime="' + iso(sec) + '" data-' + attr + '="' + sec + '">' + (fmtS ? fmtS.format(new Date(sec * 1000)) : local(sec)) + '</time>'; }

  /* one exam in one section: its coupon link while the offer is open, 'Starts ...' before, hidden after. A row that is not live keeps the instructor link as its href, so even a click
     that lands just as an offer expires goes to the permanent link, never to an expired coupon. */
  var catalog = {};
  $$('#sec-referral .ofr-row').forEach(function (r) { catalog[r.dataset.cid] = r; });
  function ensureRows(sid, n) {
    var sec = d.getElementById('sec-' + sid); if (!sec) return;
    var have = {}; $$('.ofr-row', sec).forEach(function (r) { have[r.dataset.cid] = 1; });
    Object.keys(DATA.tiers).forEach(function (cid) {
      var src = catalog[cid]; if (have[cid] || !src) return;
      if (!DATA.tiers[cid].some(function (t) { return secOf(t) === sid && end(t) > n; })) return;
      var tr = src.cloneNode(true), ex = $('.or-extra', tr); tr.removeAttribute('id'); if (ex) ex.parentNode.removeChild(ex);
      var a = $('[data-o-main]', tr); if (a) a.textContent = sec.dataset.cta || '';
      var body = $(src.hasAttribute('data-pin') ? 'tbody.ofr-pin' : 'tbody:not(.ofr-pin)', sec), i = +tr.dataset.i, next = null;
      $$('.ofr-row', body).forEach(function (r) { if (!next && +r.dataset.i > i) next = r; });
      body.insertBefore(tr, next);
    });
  }
  function paintRow(tr, n) {
    var sec = tr.closest('[data-o-sec]'), sid = sec ? sec.dataset.oSec : ''; if (!sid || sid === 'referral') return;
    var cid = tr.dataset.cid, ts = (DATA.tiers[cid] || []).filter(function (t) { return secOf(t) === sid; }), L = DATA.links[cid] || {};
    var live = ts.filter(function (t) { return usable(t, n); }).sort(order)[0] || null, up = null;
    if (!live) up = ts.filter(function (t) { return n < t.s && t.s >= DATA.ms && t.s < end(t); }).sort(function (a, b) { return a.s - b.s; })[0] || null;
    var state = live ? 'live' : (up ? 'soon' : 'ended'); tr.dataset.state = state; tr.hidden = state === 'ended';
    var a = $('[data-o-main]', tr);
    if (a) {
      var href = live ? live.u : (L.r || L.u || a.getAttribute('href')); if (a.getAttribute('href') !== href) a.setAttribute('href', href);
      a.hidden = !live; a.dataset.offerType = live ? live.t : ''; a.dataset.ctaKind = live ? 'coupon' : 'referral';
    }
    var when = $('[data-o-when]', tr);
    if (when) { var html = live ? 'Available until ' + timeShort(end(live), 'end') : (up ? 'Starts ' + timeShort(up.s, 'start') : 'This round has ended.'); if (when.dataset.h !== html) { when.dataset.h = html; when.innerHTML = html; } }
  }
  /* the five fixed sections: what sits under each today (offers_page.py section_state builds the same) */
  function secState(id, n) {
    if (id === 'referral') return { status: 'open', html: 'Available now' };
    var ts = []; Object.keys(DATA.tiers).forEach(function (cid) { DATA.tiers[cid].forEach(function (t) { if (secOf(t) === id) ts.push(t); }); });
    var live = ts.filter(function (t) { return usable(t, n); });
    if (live.length) {
      var e = Math.min.apply(null, live.map(end)), seats = Math.max.apply(null, live.map(function (t) { return t.m || 0; }));
      return { status: 'live', end: e, html: 'Available now until ' + timeEl(e, 'end') + ((id === 'free' || id === 'giveaway') && seats ? ' · Up to ' + seats + ' seats per exam' : '') };
    }
    var up = ts.filter(function (t) { return n < t.s && t.s >= DATA.ms && t.s < end(t); }).sort(function (a, b) { return a.s - b.s; });
    if (up.length) return { status: 'soon', start: up[0].s, html: 'Starts ' + timeEl(up[0].s, 'start') };
    if (ENDED.indexOf(id) > -1 || ts.some(function (t) { return end(t) <= n; })) return { status: 'ended', html: 'This round has ended.' };
    return { status: 'none', html: 'No offer currently available.' };
  }
  function paintSections(n) {
    var states = {}, anyLive = false;
    $$('[data-o-sec]').forEach(function (el) { if (secState(el.dataset.oSec, n).status === 'live') anyLive = true; });
    $$('[data-o-sec]').forEach(function (el) {
      var id = el.dataset.oSec, st = secState(id, n), act = st.status === 'live' || st.status === 'open'; states[id] = st;
      el.dataset.status = st.status;
      var line = $('[data-o-secstate]', el); if (line && line.dataset.h !== st.html) { line.dataset.h = st.html; line.innerHTML = st.html; }
      var on = act || st.status === 'soon', wrap = $('[data-o-tablewrap]', el), closed = $('[data-o-closed]', el);
      if (wrap) wrap.hidden = !on; if (closed) closed.hidden = on;
      var want = st.status === 'live' || (id === 'referral' && !anyLive);
      if (!el.dataset.touched && el.open !== want) el.open = want;          /* open what can be claimed now (the instructor's list when nothing else is on offer), unless the visitor chose */
    });
    return states;
  }
  function banner(states) {
    var el = $('[data-o-banner]'); if (!el) return;
    var names = {}; $$('[data-o-sec]').forEach(function (a) { names[a.dataset.oSec] = ($('h3', a) || {}).textContent; });
    var live = OFFER_SECS.filter(function (id) { return states[id] && states[id].status === 'live'; }), html, kind;
    if (live.length) {
      kind = 'live'; html = '<span class="offers-pill offers-pill-live">Available now</span>' + live.map(function (id) { return '<span class="ofr-avail"><a href="#sec-' + id + '">' + names[id] + '</a> until ' + timeEl(states[id].end, 'end') + '</span>'; }).join(' ');
    } else {
      var base = '<span class="offers-pill">Open to everyone</span><span class="ofr-avail">Every exam is open for enrollment on Udemy.</span>';
      var soon = OFFER_SECS.filter(function (id) { return states[id] && states[id].status === 'soon'; }).sort(function (a, b) { return states[a].start - states[b].start; });
      if (soon.length) { kind = 'soon'; html = base + '<span class="ofr-avail">Next: <a href="#sec-' + soon[0] + '">' + names[soon[0]] + '</a> starts ' + timeEl(states[soon[0]].start, 'start') + '</span>'; }
      else { kind = 'none'; html = base; }
    }
    if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
    el.dataset.kind = kind;
  }
  /* search + category filter over the instructor's catalog; every other table follows it. The featured (pinned) rows are never filtered. */
  var q = $('[data-o-search]'), chips = $$('[data-o-v]'), emptyBox = $('[data-o-filter-empty]'), blob = {};
  $$('#sec-referral .ofr-row').forEach(function (r) { blob[r.dataset.cid] = r.dataset.search || ''; });
  function applyFilter() {
    var term = q ? q.value.toLowerCase().trim() : '', on = chips.filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; }).map(function (c) { return c.dataset.oV; }), shown = 0, total = 0;
    $$('.ofr-row:not([data-pin])').forEach(function (r) {
      var ok = (!term || term.split(/\s+/).every(function (p) { return (blob[r.dataset.cid] || '').indexOf(p) > -1; })) && (!on.length || on.indexOf(r.dataset.v) > -1);
      r.classList.toggle('is-filtered', !ok);
      if (r.closest('#sec-referral')) { total++; if (ok) shown++; }
    });
    if (emptyBox) emptyBox.hidden = !(total > 0 && shown === 0);
  }
  if (q) q.addEventListener('input', applyFilter);
  chips.forEach(function (c) { c.addEventListener('click', function () { c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')); applyFilter(); }); });
  var clear = $('[data-o-clear]'); if (clear) clear.addEventListener('click', function () { if (q) q.value = ''; chips.forEach(function (c) { c.setAttribute('aria-pressed', 'false'); }); applyFilter(); if (q) q.focus(); });
  var qs = new URLSearchParams(location.search).get('q'); if (q && qs) { q.value = qs; }

  function paintAll() {
    var n = nowS(); OFFER_SECS.forEach(function (id) { ensureRows(id, n); }); $$('.ofr-row').forEach(function (tr) { paintRow(tr, n); });
    banner(paintSections(n)); schedule(n); applyFilter();
    var tz = $('[data-o-tz]'); if (tz) { try { tz.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* keep UTC */ } }
    root.dataset.painted = String(n);
  }
  /* the next moment anything changes: an offer opens or closes, or the month ends */
  function schedule(n) {
    clearTimeout(timer); var next = Infinity;
    Object.keys(DATA.tiers).forEach(function (id) { DATA.tiers[id].forEach(function (t) { [t.s, end(t)].forEach(function (b) { if (b > n && b < next) next = b; }); }); });
    if (DATA.me > n && DATA.me < next) next = DATA.me;
    var ms = isFinite(next) ? Math.min((next - n) * 1000 + 250, 6 * 3600 * 1000) : 6 * 3600 * 1000;
    timer = setTimeout(paintAll, Math.max(ms, 500));
  }
  paintAll();
  var again = function () { if (!d.hidden) paintAll(); };
  d.addEventListener('visibilitychange', again); w.addEventListener('focus', again); w.addEventListener('pageshow', again);
  /* click / middle-click: decide again right now and point the link at the answer before the browser follows it */
  function beforeGo(e) {
    var a = e.target.closest && e.target.closest('[data-o-main]'); if (!a) return;
    var tr = a.closest('.ofr-row'); if (tr) paintRow(tr, nowS());
  }
  d.addEventListener('click', beforeGo, true); d.addEventListener('auxclick', beforeGo, true); d.addEventListener('contextmenu', beforeGo, true);
  /* navigation: a visitor's own opening or closing is kept; 'Expand all' / 'Collapse all'; a link to a row inside a closed section opens it */
  var allBtn = $('[data-o-toggleall]');
  function syncAll() { if (!allBtn) return; var all = $$('.ofr-acc'), open = all.every(function (x) { return x.open; }); allBtn.textContent = open ? 'Collapse all' : 'Expand all'; allBtn.setAttribute('aria-pressed', String(open)); }
  d.addEventListener('click', function (e) {
    var s = e.target.closest && e.target.closest('.ofr-acc > summary'); if (s) s.parentNode.dataset.touched = '1';
    var c = e.target.closest && e.target.closest('[data-o-sec-clear]'); if (c) { var r = d.getElementById('sec-referral'); if (r) { r.open = true; r.dataset.touched = '1'; } }
  });
  if (allBtn) allBtn.addEventListener('click', function () {
    var all = $$('.ofr-acc'), open = all.every(function (x) { return x.open; });
    all.forEach(function (x) { x.open = !open; x.dataset.touched = '1'; }); syncAll();
  });
  root.addEventListener('toggle', syncAll, true);
  function openHash() {
    var id = decodeURIComponent((location.hash || '').slice(1)); if (!id) return;
    var el = d.getElementById(id), det = el && el.closest('details'); if (det && !det.open) { det.open = true; det.dataset.touched = '1'; if (el.scrollIntoView) el.scrollIntoView(); }
  }
  w.addEventListener('hashchange', openHash); openHash(); syncAll(); applyFilter();
})();
