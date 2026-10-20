/**
 * My progress (/learn/my-progress/): the mock exams finished on this device, what changed since last time, and the trap types that keep catching you.
 * Everything comes from CertShieldLearnStore (this browser's localStorage); nothing is requested from or sent to a server. The learner can download the
 * data as JSON or delete it.
 */
(function () {
  "use strict";

  var honest = window.CertShieldHonest;
  var store = window.CertShieldLearnStore;
  var ui = window.CertShieldLearnUI;
  var host = document.querySelector("[data-progress]");
  if (!honest || !store || !ui || !host) return;

  var el = ui.el;
  var LEARN = ui.LEARN;
  var emptyBox = host.querySelector("[data-empty]");
  var blockedBox = host.querySelector("[data-blocked]");
  var body = host.querySelector("[data-body]");
  var summaryBox = host.querySelector("[data-summary]");
  var signatureBox = host.querySelector("[data-signature]");
  var examsBox = host.querySelector("[data-exams]");
  var statusBox = host.querySelector("[data-status]");

  var types = [];
  var names = {};
  try { types = JSON.parse(document.querySelector("script[data-trap-types]").textContent); } catch (error) { types = []; }
  try { names = JSON.parse(document.querySelector("script[data-exam-names]").textContent); } catch (error) { names = {}; }

  function typeName(id) {
    for (var i = 0; i < types.length; i += 1) if (types[i].id === id) return types[i];
    return { id: id, name: id, short: "" };
  }

  function stat(value, label) {
    var box = el("div", "lx-stat");
    box.appendChild(el("strong", "", value));
    box.appendChild(el("span", "", label));
    return box;
  }

  function signatureRows(trapMaps) {
    return types.map(function row(t) {
      var answered = 0;
      var missed = 0;
      trapMaps.forEach(function add(tr) {
        if (tr && tr[t.id]) { answered += tr[t.id][0]; missed += tr[t.id][1]; }
      });
      return { type: t.id, answered: answered, missed: missed };
    });
  }

  function flaggedList(flagged, rows) {
    var overallAnswered = rows.reduce(function add(n, r) { return n + r.answered; }, 0);
    var overallMissed = rows.reduce(function add(n, r) { return n + r.missed; }, 0);
    var list = el("ul", "lr-sig");
    flagged.forEach(function each(f) {
      var t = typeName(f.type);
      var li = el("li", "lx-t-" + f.type);
      var h = el("h4", "");
      h.appendChild(document.createTextNode(t.name));
      li.appendChild(h);
      li.appendChild(el("p", "", "Missed " + f.missed + " of " + f.answered + " questions of this type (" + Math.round(f.rate * 100) + "%), against " + Math.round((overallMissed / overallAnswered) * 100) + "% overall."));
      if (t.short) li.appendChild(el("p", "", t.short));
      var more = el("p", "");
      more.appendChild(ui.link(LEARN + "/trap-atlas/" + f.type + "/", "How to spot and beat it"));
      li.appendChild(more);
      list.appendChild(li);
    });
    return list;
  }

  function examCard(slug, attempts) {
    var latest = attempts[0];
    var previous = attempts[1] || null;
    var card = el("article", "lx-attempt");
    var h = el("h4", "");
    h.appendChild(ui.link(LEARN + "/exams/" + slug + "/", names[slug] || latest.name || slug));
    card.appendChild(h);
    card.appendChild(el("p", "lx-meta", "Latest attempt " + ui.fullDate(latest.t) + " · " + attempts.length + (attempts.length === 1 ? " attempt" : " attempts") + " saved"));
    var pct = Math.round((latest.k / latest.n) * 100);
    card.appendChild(el("p", "lr-big", latest.k + " of " + latest.n + " right (" + pct + "%)"));
    var weighted = latest.wlo !== null;
    var lo = weighted ? latest.wlo : latest.lo;
    var hi = weighted ? latest.whi : latest.hi;
    card.appendChild(el("p", "lx-meta", (weighted ? "Range on the real exam’s mix of topics: " : "Range for questions like these: ") + honest.rangeText(lo, hi)));
    card.appendChild(ui.rangeBar(lo, hi, pct, "Likely range " + lo + " to " + hi + " percent; your score was " + pct + " percent"));

    if (previous) {
      var prevPct = Math.round((previous.k / previous.n) * 100);
      var diff = pct - prevPct;
      var verdict = honest.compareAttempts({ pooled: { lo: previous.lo, hi: previous.hi } }, { pooled: { lo: latest.lo, hi: latest.hi } }).verdict;
      var points = (diff > 0 ? "up " : diff < 0 ? "down " : "level, ") + (diff === 0 ? "" : Math.abs(diff) + " points ");
      var text = "Since " + ui.fullDate(previous.t) + ": " + points.trim() + ". " +
        (verdict === "up" ? "A real improvement: the two ranges no longer overlap."
          : verdict === "down" ? "A real drop: the two ranges no longer overlap."
          : "The two ranges overlap, so this may only be which questions you got.");
      card.appendChild(el("p", "lx-delta " + (verdict === "up" ? "lx-delta-up" : verdict === "down" ? "lx-delta-down" : ""), text));
    }

    var weakest = latest.d.filter(function has(t) { return t[2] >= 3; }).sort(function byAccuracy(x, y) { return x[1] / x[2] - y[1] / y[2]; })[0];
    if (weakest) card.appendChild(el("p", "lx-meta", "Weakest topic with enough answers: " + weakest[0] + " (" + weakest[1] + " of " + weakest[2] + " right)."));
    var flagged = honest.errorSignature(signatureRows([latest.tr]));
    if (flagged.length) {
      card.appendChild(el("p", "lx-meta", "Traps to watch: " + flagged.map(function n(f) { return typeName(f.type).name; }).join(", ") + "."));
    }
    var actions = el("div", "lx-attempt-actions");
    actions.appendChild(ui.link(LEARN + "/exams/" + slug + "/", "Take it again"));
    card.appendChild(actions);
    return card;
  }

  function render() {
    var data = store.read();
    var slugs = Object.keys(data.exams).sort(function newestFirst(a, b) { return data.exams[b].attempts[0].t - data.exams[a].attempts[0].t; });
    emptyBox.hidden = true;
    blockedBox.hidden = true;
    body.hidden = true;
    if (!store.available()) { blockedBox.hidden = false; return; }
    if (!slugs.length) { emptyBox.hidden = false; return; }
    body.hidden = false;

    var attempts = slugs.reduce(function add(n, s) { return n + data.exams[s].attempts.length; }, 0);
    summaryBox.textContent = "";
    summaryBox.appendChild(stat(String(slugs.length), slugs.length === 1 ? "exam practised" : "exams practised"));
    summaryBox.appendChild(stat(String(attempts), attempts === 1 ? "attempt saved" : "attempts saved"));
    summaryBox.appendChild(stat(ui.fullDate(data.exams[slugs[0]].attempts[0].t), "most recent attempt"));

    var rows = signatureRows(slugs.map(function latest(s) { return data.exams[s].attempts[0].tr; }));
    var flagged = honest.errorSignature(rows);
    signatureBox.textContent = "";
    if (flagged.length) {
      signatureBox.appendChild(el("p", "lr-sub", "Counted across your latest attempt at each exam. These tricks catch you more often than your overall score would predict. It is a pointer, not a diagnosis."));
      signatureBox.appendChild(flaggedList(flagged, rows));
    } else {
      var answered = rows.reduce(function add(n, r) { return n + r.answered; }, 0);
      signatureBox.appendChild(el("p", "lr-note", answered < 20
        ? "Not enough answers yet to spot a pattern across exams. Finish a few more mock exams and it will appear here."
        : "No single trap type stands out across your exams: your misses are spread about evenly."));
    }

    examsBox.textContent = "";
    slugs.forEach(function add(s) { examsBox.appendChild(examCard(s, data.exams[s].attempts)); });
  }

  function say(message) {
    statusBox.textContent = message;
  }

  host.querySelector("[data-export]").addEventListener("click", function exportData() {
    var blob = new Blob([store.exportJson()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "certshield-progress.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function revoke() { URL.revokeObjectURL(url); }, 1000);
    say("Downloaded certshield-progress.json.");
  });

  host.querySelector("[data-wipe]").addEventListener("click", function wipe() {
    if (!window.confirm("Delete the progress saved on this device? This cannot be undone.")) return;
    store.clear();
    render();
    say("Your progress was deleted from this browser.");
  });

  render();
}());
