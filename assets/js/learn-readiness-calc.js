/**
 * The Honest score calculator (/learn/readiness/). Enter a result from any practice test, as one total or per exam topic, and see the range it supports.
 * Needs CertShieldHonest (the maths) and CertShieldLearnUI (DOM builders). Runs entirely in the browser; the only state is the address bar, so a
 * result can be shared as a link (?c=21&n=30, or ?exam=<slug>&t=6.8,5.8,...). Nothing is sent anywhere.
 */
(function () {
  "use strict";

  var honest = window.CertShieldHonest;
  var ui = window.CertShieldLearnUI;
  var root = document.querySelector("[data-readiness]");
  if (!honest || !ui || !root) return;

  var el = ui.el;
  var LEARN = ui.LEARN;
  var MAX = 100000;
  var SIZES = [10, 20, 50, 100, 200];

  var blueprints = [];
  var bySlug = {};
  try {
    var node = document.querySelector("script[data-blueprints]");
    blueprints = node ? JSON.parse(node.textContent) : [];
  } catch (error) {
    blueprints = [];
  }
  blueprints.forEach(function index(b) { bySlug[b.slug] = b; });

  var radios = Array.prototype.slice.call(root.querySelectorAll('input[name="rc-mode"]'));
  var panels = { total: root.querySelector('[data-panel="total"]'), topics: root.querySelector('[data-panel="topics"]') };
  var totalC = root.querySelector("[data-total-correct]");
  var totalA = root.querySelector("[data-total-attempted]");
  var examSelect = root.querySelector("[data-exam]");
  var rowsHost = root.querySelector("[data-topic-rows]");
  var errorBox = root.querySelector("[data-error]");
  var resultBox = root.querySelector("[data-result]");
  var current = null; // { exam, rows: [{ topic, c, a }] } while an exam is chosen
  var timer = null;

  function mode() {
    for (var i = 0; i < radios.length; i += 1) if (radios[i].checked) return radios[i].value;
    return "total";
  }

  function setMode(value) {
    radios.forEach(function set(r) {
      r.checked = r.value === value;
      var label = r.closest(".lx-mode");
      if (label) label.classList.toggle("is-on", r.checked);
    });
    panels.total.hidden = value !== "total";
    panels.topics.hidden = value !== "topics";
  }

  function readInt(input) {
    var raw = String(input.value).trim();
    if (raw === "") return { blank: true, value: 0 };
    if (!/^\d{1,6}$/.test(raw)) return { bad: true };
    var n = Number(raw);
    return n > MAX ? { bad: true } : { value: n };
  }

  function clearErrors() {
    errorBox.hidden = true;
    errorBox.textContent = "";
    root.querySelectorAll("[aria-invalid]").forEach(function clear(n) { n.removeAttribute("aria-invalid"); });
  }

  function fail(message, inputs) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    (inputs || []).forEach(function mark(n) { n.setAttribute("aria-invalid", "true"); });
    resultBox.textContent = "";
    setUrl(null);
    return null;
  }

  function hint(message) {
    resultBox.textContent = "";
    resultBox.appendChild(el("p", "lx-empty", message));
    setUrl(null);
    return null;
  }

  function setUrl(query) {
    try {
      window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
    } catch (error) {
      /* a sandboxed frame: the calculator still works, the link just is not updated */
    }
  }

  // ---------------------------------------------------------------- the topic rows for a chosen exam

  function buildRows(slug, values) {
    rowsHost.textContent = "";
    current = null;
    var exam = bySlug[slug];
    if (!exam) return;
    current = { exam: exam, rows: [] };
    exam.topics.forEach(function addTopic(topic, i) {
      var row = el("div", "lx-topic");
      var name = el("p", "lx-topic-name", topic.name);
      name.appendChild(el("small", "", (exam.approximate ? "about " : "") + topic.weight + "% of the real exam"));
      row.appendChild(name);
      var cells = [];
      [["c", "Right", "right"], ["a", "Answered", "answered"]].forEach(function addField(spec) {
        var field = el("div", "lx-field");
        var id = "rc-t" + i + "-" + spec[0];
        var label = el("label", "", spec[1]);
        label.setAttribute("for", id);
        label.appendChild(el("span", "sr-only", " in " + topic.name));
        field.appendChild(label);
        var input = document.createElement("input");
        input.id = id;
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.inputMode = "numeric";
        input.setAttribute("autocomplete", "off");
        if (values && values[i] && values[i][spec[0]] !== undefined) input.value = String(values[i][spec[0]]);
        input.addEventListener("input", schedule);
        field.appendChild(input);
        row.appendChild(field);
        cells.push(input);
      });
      current.rows.push({ topic: topic, cInput: cells[0], aInput: cells[1] });
      rowsHost.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- compute

  function gather() {
    clearErrors();
    if (mode() === "total") {
      var c = readInt(totalC);
      var a = readInt(totalA);
      if (c.bad || a.bad) return fail("Use whole numbers from 0 up: no decimals, signs or letters.", [c.bad ? totalC : null, a.bad ? totalA : null].filter(Boolean));
      if (c.blank && a.blank) return hint("Enter your numbers above and your range appears here.");
      if (a.blank) return hint("Now enter how many questions you answered.");
      if (a.value === 0) return fail("Enter at least 1 answered question.", [totalA]);
      if (c.value > a.value) return fail("The questions you got right cannot be more than the questions you answered.", [totalC]);
      return { mode: "total", topics: [{ name: "All questions", c: c.value, a: a.value, w: null }], query: "c=" + c.value + "&n=" + a.value };
    }
    if (!current) return hint("Choose an exam to enter your result for each topic.");
    var topics = [];
    var parts = [];
    for (var i = 0; i < current.rows.length; i += 1) {
      var row = current.rows[i];
      var rc = readInt(row.cInput);
      var ra = readInt(row.aInput);
      if (rc.bad || ra.bad) return fail("Use whole numbers from 0 up in “" + row.topic.name + "”.", [rc.bad ? row.cInput : null, ra.bad ? row.aInput : null].filter(Boolean));
      if (rc.value > ra.value) return fail("In “" + row.topic.name + "” you cannot have more right answers than answered questions.", [row.cInput]);
      topics.push({ name: row.topic.name, c: rc.value, a: ra.value, w: row.topic.weight });
      parts.push(rc.value + "." + ra.value);
    }
    var answered = topics.reduce(function add(n, t) { return n + t.a; }, 0);
    if (!answered) return hint("Enter your right and answered counts for the topics you attempted. Leave the others empty.");
    return { mode: "topics", exam: current.exam, topics: topics, query: "exam=" + encodeURIComponent(current.exam.slug) + "&t=" + parts.join(",") };
  }

  function schedule() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(run, 180);
  }

  function run() {
    timer = null;
    var input = gather();
    if (!input) return;
    var sum = honest.summarise(input.topics);
    draw(sum, input);
    setUrl(input.query);
  }

  // ---------------------------------------------------------------- the result

  function card(title, big, small) {
    var c = el("div", "lr-card");
    c.appendChild(el("h3", "", title));
    c.appendChild(el("p", "lr-big", big));
    c.appendChild(el("p", "", small));
    return c;
  }

  function draw(sum, input) {
    resultBox.textContent = "";
    var headline = sum.weighted || sum.pooled;
    var shown = Math.round(sum.pct);
    var hero = el("div", "lr-hero");
    hero.appendChild(el("p", "lr-kicker", "Your range"));
    hero.appendChild(el("p", "lr-range", honest.rangeText(headline.loPct, headline.hiPct)));
    hero.appendChild(el("p", "lr-sentence", "You got " + sum.correct + " of " + sum.attempted + " right (" + shown + "%). " +
      (sum.weighted
        ? "Counting each topic the way the real exam does, that points to a level of between " + headline.loPct + "% and " + headline.hiPct + "%."
        : "That points to a level of between " + headline.loPct + "% and " + headline.hiPct + "% on questions like these.")));
    hero.appendChild(ui.rangeBar(headline.loPct, headline.hiPct, shown, "Likely range " + headline.loPct + " to " + headline.hiPct + " percent; your score is " + shown + " percent"));
    resultBox.appendChild(hero);

    var pair = el("div", "lr-pair");
    pair.appendChild(card("Your score", sum.correct + " / " + sum.attempted, shown + "% of the questions you answered."));
    pair.appendChild(card("Range for questions like these", honest.rangeText(sum.pooled.loPct, sum.pooled.hiPct), "A 90% range from how many questions you answered. Wider means less evidence."));
    if (sum.weighted) {
      pair.appendChild(card("Range on the real exam’s mix of topics", honest.rangeText(sum.weighted.loPct, sum.weighted.hiPct),
        "Each topic counts as much as the exam guide says" + (input.exam && input.exam.approximate ? " (the vendor’s percentages are approximate or averages)" : "") + "."));
    }
    resultBox.appendChild(pair);

    if (sum.attempted < 10) {
      resultBox.appendChild(el("p", "lr-note lr-warn", "With fewer than ten answers any range is very wide. Treat this as a first hint."));
    }
    if (sum.untouched.length && input.mode === "topics") {
      var carries = sum.untouchedWeight !== null ? " They carry about " + Math.round(sum.untouchedWeight * 100) + "% of the real exam." : "";
      resultBox.appendChild(el("p", "lr-note lr-warn", "You answered nothing in: " + sum.untouched.map(function n(t) { return t.name; }).join(", ") + "." + carries + " They widen the weighted range instead of being ignored."));
    }

    if (input.mode === "topics") {
      resultBox.appendChild(el("h3", "lr-h", "Your result by topic"));
      var list = el("ul", "lx-bars");
      list.setAttribute("aria-label", "Result by exam topic");
      input.topics.forEach(function addTopic(t) {
        var row = el("li", "lx-bar-row");
        var label = el("span", "lx-bar-label");
        label.appendChild(el("span", "", t.name));
        row.appendChild(label);
        var pct = t.a ? Math.round((t.c / t.a) * 100) : 0;
        row.appendChild(ui.bar(pct));
        row.appendChild(el("span", "lx-bar-n", t.a ? t.c + " of " + t.a + " right · " + pct + "%" + (t.a < 3 ? " · limited evidence" : "") : "not answered"));
        list.appendChild(row);
      });
      resultBox.appendChild(list);
    }

    // ---- the same percentage on a longer test
    resultBox.appendChild(el("h3", "lr-h", "The same percentage on a longer test"));
    resultBox.appendChild(el("p", "lr-sub", "More questions, narrower range. This is why one short test should not decide anything."));
    var sizes = SIZES.slice();
    if (sizes.indexOf(sum.attempted) === -1) sizes.push(sum.attempted);
    sizes.sort(function asc(x, y) { return x - y; });
    var table = document.createElement("table");
    table.className = "lr-narrow";
    var cap = document.createElement("caption");
    cap.textContent = "Likely range for your percentage on tests of different sizes";
    table.appendChild(cap);
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["Questions answered", "Right", "Range", "Picture"].forEach(function head(label) { var th = document.createElement("th"); th.scope = "col"; th.textContent = label; hr.appendChild(th); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    var p = sum.correct / sum.attempted;
    sizes.forEach(function addSize(n) {
      var yours = n === sum.attempted;
      var k = yours ? sum.correct : Math.round(p * n);
      var r = honest.wilsonPct(k, n);
      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = n + (yours ? " (your test)" : "");
      tr.appendChild(th);
      var right = document.createElement("td");
      right.textContent = k + " (" + Math.round((k / n) * 100) + "%)";
      tr.appendChild(right);
      var range = document.createElement("td");
      range.textContent = honest.rangeText(r.loPct, r.hiPct);
      tr.appendChild(range);
      var pic = document.createElement("td");
      pic.appendChild(ui.rangeBar(r.loPct, r.hiPct, null, "Range " + r.loPct + " to " + r.hiPct + " percent for " + n + " questions"));
      tr.appendChild(pic);
      if (yours) tr.className = "is-yours";
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var scroll = el("div", "assessment-table-scroll");
    scroll.setAttribute("tabindex", "0");
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Ranges by test size (scrollable table)");
    scroll.appendChild(table);
    resultBox.appendChild(scroll);

    // ---- share and next steps
    var share = el("div", "lr-share");
    var copy = el("button", "button button-secondary", "Copy a link to this result");
    copy.type = "button";
    var status = el("span", "microcopy");
    status.setAttribute("role", "status");
    copy.addEventListener("click", function () { copyLink(status); });
    share.appendChild(copy);
    share.appendChild(status);
    resultBox.appendChild(share);

    resultBox.appendChild(el("h3", "lr-h", "Keep going, all free"));
    var links = el("ul", "lr-links");
    function add(a) { var li = document.createElement("li"); li.appendChild(a); links.appendChild(li); }
    if (input.exam) add(ui.link(LEARN + "/exams/" + input.exam.slug + "/", "Take the free " + input.exam.name + " mock exam"));
    else add(ui.link(LEARN + "/exams/", "Take a free mock exam"));
    add(ui.link(LEARN + "/trap-atlas/", "Learn how exam questions mislead you"));
    add(ui.link(LEARN + "/method/#pooled", "How these ranges are worked out"));
    resultBox.appendChild(links);
  }

  function copyLink(status) {
    var url = window.location.href;
    function manual() {
      status.textContent = "";
      var box = document.createElement("input");
      box.type = "text";
      box.readOnly = true;
      box.value = url;
      box.className = "filter-input";
      box.setAttribute("aria-label", "Link to this result");
      status.appendChild(box);
      box.focus();
      box.select();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function ok() { status.textContent = "Link copied."; }, manual);
    } else {
      manual();
    }
  }

  // ---------------------------------------------------------------- wiring

  radios.forEach(function wire(r) {
    r.addEventListener("change", function () { setMode(mode()); run(); });
  });
  [totalC, totalA].forEach(function wire(n) { n.addEventListener("input", schedule); });
  examSelect.addEventListener("change", function () { buildRows(examSelect.value, null); run(); });

  // restore a shared result from the address
  var q = new URLSearchParams(window.location.search);
  var wantExam = q.get("exam");
  if (wantExam && bySlug[wantExam]) {
    setMode("topics");
    examSelect.value = wantExam;
    var values = (q.get("t") || "").split(",").map(function split(part) {
      var m = /^(\d{1,6})\.(\d{1,6})$/.exec(part);
      return m ? { c: Number(m[1]), a: Number(m[2]) } : null;
    });
    buildRows(wantExam, values.length === bySlug[wantExam].topics.length ? values.map(function v(x) { return x || {}; }) : null);
  } else {
    setMode("total");
    if (/^\d{1,6}$/.test(q.get("c") || "") && /^\d{1,6}$/.test(q.get("n") || "")) {
      totalC.value = q.get("c");
      totalA.value = q.get("n");
    }
  }
  run();
}());
