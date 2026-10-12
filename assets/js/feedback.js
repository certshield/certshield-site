/* CertShield feedback box - one small dialog that drops an email into contact@certshield.academy.
 *
 * Shared by certshield.academy and practice.certshield.academy (same file in both repos; the script tag carries the config):
 *   <script src=".../feedback.js" data-endpoint="/api/feedback" data-site="academy" data-privacy="/privacy/" defer></script>
 * Any element with [data-feedback-open] (the footer link is a plain mailto: link until this script upgrades it) opens the box.
 * Progressive: no fetch/<dialog> support or a failed send falls back to a pre-filled email in the visitor's own mail app.
 * Nothing is sent until the visitor presses "Send"; no cookies; the draft lives in sessionStorage only.
 * With data-turnstile-sitekey set, Cloudflare Turnstile (interaction-only, so usually invisible) is loaded the first time the box is OPENED
 * (never on page load) and its one-time token travels with the message; the server verifies it. */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || !window.fetch) return;
  var d = document;
  var cfg = {
    endpoint: script.getAttribute('data-endpoint') || '/api/feedback',
    site: script.getAttribute('data-site') || location.hostname,
    privacy: script.getAttribute('data-privacy') || '/privacy/',
    contact: script.getAttribute('data-contact') || 'contact@certshield.academy',
    turnstile: script.getAttribute('data-turnstile-sitekey') || ''
  };
  var MAX = 2000, MIN = 10, KEY = 'certshield.feedback.draft';
  var TYPES = [
    ['error', 'Found an error', 'What is wrong? Name the question or the sentence you saw.'],
    ['idea', 'Idea', 'What would make CertShield more useful for you?'],
    ['praise', 'Kind word', 'What helped you most?'],
    ['other', 'Other', 'Tell us anything else.']
  ];
  var dlg, els, fab, lastQ = '', openedAt = 0, busy = false;
  var tsId = null, tsToken = '', tsLoading = false, tsFailed = false, waiting = false;

  function el(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function attr(n, o) { for (var k in o) n.setAttribute(k, o[k]); return n; }
  function clean(s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); }
  function store(op, v) {
    try {
      if (op === 'get') return JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (op === 'set') sessionStorage.setItem(KEY, JSON.stringify(v));
      else sessionStorage.removeItem(KEY);
    } catch (e) { /* private mode: the box still works, just without a remembered draft */ }
    return null;
  }
  function icon() {
    var s = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    attr(s, { viewBox: '0 0 24 24', width: '22', height: '22', 'aria-hidden': 'true', focusable: 'false' });
    var p = d.createElementNS('http://www.w3.org/2000/svg', 'path');
    attr(p, { d: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linejoin': 'round' });
    var l = d.createElementNS('http://www.w3.org/2000/svg', 'path');
    attr(l, { d: 'M7 9h10M7 12.5h6', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' });
    s.appendChild(p); s.appendChild(l);
    return s;
  }

  /* What the visitor was looking at: the page, and on a quiz the question they were on (so "this answer is wrong" is actionable). */
  d.addEventListener('click', trackQuestion, true);
  d.addEventListener('focusin', trackQuestion, true);
  function trackQuestion(e) {
    var q = e.target && e.target.closest ? e.target.closest('article.q[id]') : null;
    if (q) lastQ = q.id;
  }
  function context() {
    var h1 = d.querySelector('h1');
    var title = clean((h1 && h1.textContent) || d.title, 140);
    var part = '';
    var run = d.querySelector('.assessment-progress-text');
    if (run && run.offsetParent !== null && /\d/.test(run.textContent)) part = clean(run.textContent, 40);
    else if (lastQ && /^q\d+$/.test(lastQ)) part = 'Question ' + lastQ.slice(1);
    return { title: title, part: part, label: part ? title + ' · ' + part : title };
  }

  function build() {
    dlg = el('dialog', 'fb');
    dlg.setAttribute('aria-labelledby', 'fb-title');
    var form = el('form', 'fb-form');
    form.noValidate = true;
    els = { form: form };

    var head = el('div', 'fb-head');
    var ht = el('div');
    var h = el('h2', '', 'Tell us what you think'); h.id = 'fb-title';
    ht.appendChild(h);
    ht.appendChild(el('p', 'fb-sub', 'A mistake, an idea or a thank-you goes straight to our inbox. We read every one.'));
    var x = el('button', 'fb-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close feedback box');
    head.appendChild(ht); head.appendChild(x);
    form.appendChild(head);

    var fs = el('fieldset', 'fb-types');
    fs.appendChild(el('legend', 'fb-label', 'What is this about?'));
    var row = el('div', 'fb-chips');
    TYPES.forEach(function (t) {
      var lab = el('label', 'fb-chip');
      var r = attr(el('input'), { type: 'radio', name: 'fb-type', value: t[0] });
      lab.appendChild(r); lab.appendChild(el('span', '', t[1]));
      row.appendChild(lab);
    });
    fs.appendChild(row); form.appendChild(fs);

    els.ctx = el('p', 'fb-ctx');
    els.ctxText = el('span');
    var cx = el('button', 'fb-ctx-x', '×'); cx.type = 'button'; cx.setAttribute('aria-label', 'Do not include the page details');
    els.ctx.appendChild(el('b', '', 'About: ')); els.ctx.appendChild(els.ctxText); els.ctx.appendChild(cx);
    form.appendChild(els.ctx);

    var lm = el('label', 'fb-label', 'Your message'); lm.setAttribute('for', 'fb-msg');
    els.msg = attr(el('textarea', 'fb-msg'), { id: 'fb-msg', rows: '5', maxlength: String(MAX), required: '', 'aria-describedby': 'fb-count' });
    els.count = el('span', 'fb-count', '0 / ' + MAX); els.count.id = 'fb-count';
    form.appendChild(lm); form.appendChild(els.msg); form.appendChild(els.count);

    var det = el('details', 'fb-reply');
    det.appendChild(el('summary', '', 'Want a reply? Add your email (optional)'));
    var le = el('label', 'fb-label', 'Email'); le.setAttribute('for', 'fb-email');
    els.email = attr(el('input', 'fb-email'), { id: 'fb-email', type: 'email', autocomplete: 'email', maxlength: '120', placeholder: 'you@example.com' });
    det.appendChild(le); det.appendChild(els.email);
    els.reply = det; form.appendChild(det);

    var hp = attr(el('div', 'fb-hp'), { 'aria-hidden': 'true' });
    els.hp = attr(el('input'), { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
    hp.appendChild(els.hp); form.appendChild(hp);

    els.ts = el('div', 'fb-ts');
    form.appendChild(els.ts);

    var pv = el('p', 'fb-priv', 'We receive your message, the page address and your browser language, plus your email only if you add it.' + (cfg.turnstile ? ' Cloudflare Turnstile checks that you are not a bot.' : '') + ' ');
    var pa = el('a', '', 'Privacy'); pa.href = cfg.privacy; pv.appendChild(pa);
    form.appendChild(pv);

    els.status = el('p', 'fb-status'); els.status.setAttribute('role', 'status'); els.status.setAttribute('aria-live', 'polite');
    form.appendChild(els.status);

    var act = el('div', 'fb-actions');
    var cancel = el('button', 'fb-cancel', 'Cancel'); cancel.type = 'button';
    els.send = el('button', 'fb-send', 'Send feedback'); els.send.type = 'submit';
    act.appendChild(cancel); act.appendChild(els.send);
    form.appendChild(act);

    els.done = el('div', 'fb-done'); els.done.hidden = true;
    var ok = el('div', 'fb-ok', '✓'); ok.setAttribute('aria-hidden', 'true');
    els.doneTitle = el('h2', '', 'Thank you!'); els.doneTitle.tabIndex = -1;
    var dc = el('button', 'fb-send', 'Close'); dc.type = 'button';
    els.done.appendChild(ok); els.done.appendChild(els.doneTitle);
    els.done.appendChild(el('p', '', 'Your note is in our inbox. If you left an email, we will reply there.'));
    els.done.appendChild(dc);

    dlg.appendChild(form); dlg.appendChild(els.done);
    d.body.appendChild(dlg);

    x.addEventListener('click', close); cancel.addEventListener('click', close); dc.addEventListener('click', close);
    cx.addEventListener('click', function () { els.ctx.hidden = true; els.ctx.setAttribute('data-off', ''); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });   /* click on the backdrop */
    dlg.addEventListener('close', saveDraft);
    form.addEventListener('submit', submit);
    form.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(e); });
    els.msg.addEventListener('input', function () { els.count.textContent = els.msg.value.length + ' / ' + MAX; els.status.textContent = ''; });
    row.addEventListener('change', syncType);
  }

  function chosen() { var r = els.form.querySelector('input[name=fb-type]:checked'); return r ? r.value : 'idea'; }
  function setType(v) {
    var r = els.form.querySelector('input[name=fb-type][value=' + v + ']');
    if (r) r.checked = true;
    syncType();
  }
  function syncType() {
    var v = chosen();
    TYPES.forEach(function (t) { if (t[0] === v) els.msg.placeholder = t[2]; });
  }
  function saveDraft() {
    if (!els || !els.done.hidden) return;
    var m = els.msg.value.trim();
    if (m) store('set', { type: chosen(), message: m, email: els.email.value.trim() }); else store('del');
  }

  function open() {
    if (!dlg) build();
    if (typeof dlg.showModal !== 'function') { location.href = mailto('', ''); return; }
    els.done.hidden = true; els.form.hidden = false; els.status.textContent = ''; busy = false; els.send.disabled = false;
    var c = context();
    els.ctxText.textContent = c.label;
    els.ctx.hidden = false; els.ctx.removeAttribute('data-off');
    var draft = store('get');
    els.msg.value = draft && draft.message ? draft.message : '';
    els.email.value = draft && draft.email ? draft.email : '';
    els.reply.open = !!els.email.value;
    els.count.textContent = els.msg.value.length + ' / ' + MAX;
    setType(draft && draft.type ? draft.type : (c.part ? 'error' : 'idea'));
    openedAt = Date.now(); waiting = false;
    dlg.showModal();
    els.msg.focus();
    ensureTurnstile();
  }
  function close() { if (dlg && dlg.open) dlg.close(); }

  /* Cloudflare Turnstile: loaded on first open, rendered explicitly into .fb-ts, one fresh token per send. */
  function ensureTurnstile() {
    if (!cfg.turnstile || tsId !== null || tsLoading || tsFailed) return;
    var render = function () {
      try {
        tsId = window.turnstile.render(els.ts, {
          sitekey: cfg.turnstile, action: 'feedback', appearance: 'interaction-only',
          callback: function (t) { tsToken = t; if (waiting) { waiting = false; submit(); } },
          'expired-callback': function () { tsToken = ''; },
          'error-callback': function () { tsToken = ''; tsFailed = true; if (waiting) { waiting = false; submit(); } }
        });
      } catch (e) { tsFailed = true; }
    };
    if (window.turnstile) { render(); return; }
    tsLoading = true;
    var s = d.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.defer = true;
    s.onload = function () { tsLoading = false; render(); };
    s.onerror = function () { tsLoading = false; tsFailed = true; if (waiting) { waiting = false; submit(); } };
    d.head.appendChild(s);
  }
  function resetTurnstile() {
    tsToken = '';
    if (tsId !== null && window.turnstile) { try { window.turnstile.reset(tsId); } catch (e) { /* the next open renders a fresh one */ } }
  }

  function mailto(msg, ctxLabel) {
    var body = (msg ? msg.slice(0, 1500) + '\n\n' : '') + '--\nPage: ' + location.origin + location.pathname + (ctxLabel ? '\nAbout: ' + ctxLabel : '');
    return 'mailto:' + cfg.contact + '?subject=' + encodeURIComponent('CertShield feedback') + '&body=' + encodeURIComponent(body);
  }
  function say(text, bad) { els.status.textContent = text; els.status.className = 'fb-status' + (bad ? ' is-bad' : ''); }

  function submit(e) {
    if (e) e.preventDefault();
    if (busy) return;
    var msg = els.msg.value.trim(), email = els.email.value.trim();
    if (msg.length < MIN) { say('Please write a few words so we can act on it.', true); els.msg.focus(); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { els.reply.open = true; say('That email address looks incomplete. Fix it or leave it empty.', true); els.email.focus(); return; }
    var c = context(), withCtx = !els.ctx.hasAttribute('data-off');
    if (cfg.turnstile && !tsToken) {
      if (tsFailed) { failed(msg, withCtx ? c.label : ''); return; }   /* blocked or broken check: let them email instead */
      waiting = true; say('One moment, confirming you are human…'); ensureTurnstile();
      setTimeout(function () { if (waiting) { waiting = false; tsFailed = true; submit(); } }, 25000);
      return;
    }
    var payload = {
      v: 1, type: chosen(), message: msg, email: email, site: cfg.site,
      page: withCtx ? location.origin + location.pathname : '', title: withCtx ? c.title : '', context: withCtx ? c.part : '',
      lang: (navigator.language || '').slice(0, 20), t: Date.now() - openedAt, website: els.hp.value, turnstile: tsToken
    };
    busy = true; els.send.disabled = true; say('Sending…');
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    fetch(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload), credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j || {} }; }); })
      .then(function (res) {
        clearTimeout(timer); resetTurnstile();
        if (res.body.ok) return done(payload.type);
        busy = false; els.send.disabled = false;
        if ((res.status === 400 || res.status === 403 || res.status === 429) && res.body.message) { say(res.body.message, true); return; }
        failed(msg, withCtx ? c.label : '');
      })
      .catch(function () { clearTimeout(timer); resetTurnstile(); busy = false; els.send.disabled = false; failed(msg, withCtx ? c.label : ''); });
  }
  function failed(msg, label) {
    say('We could not send that just now. ', true);
    var a = el('a', 'fb-mail', 'Email it to us instead'); a.href = mailto(msg, label);
    els.status.appendChild(a);
  }
  function done(type) {
    store('del');
    els.form.hidden = true; els.done.hidden = false; els.doneTitle.focus();
    try { if (typeof window.gtag === 'function') window.gtag('event', 'feedback_submit', { feedback_type: type }); } catch (e) { /* analytics is optional */ }
  }

  /* launcher: a round button that widens to say "Feedback" on hover/focus */
  fab = el('button', 'fb-fab');
  fab.type = 'button'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-label', 'Send feedback'); fab.setAttribute('data-feedback-open', '');
  fab.appendChild(icon());
  var fl = el('span', '', 'Feedback'); fl.setAttribute('aria-hidden', 'true'); fab.appendChild(fl);
  d.body.appendChild(fab);

  d.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-feedback-open]') : null;
    if (!t) return;
    e.preventDefault();
    open();
  });
  window.CertShieldFeedback = { open: open };
})();
