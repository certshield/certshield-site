/**
 * The free edition of the mock exam runner (/learn/exams/<slug>/).
 *
 * It does not replace assets/js/ui/assessment-runner.js or study-mode-runner.js: it loads after them and, for a payload flagged `learn: true`, swaps
 * three things on their prototypes: the results (an honest range, the result by topic, the Error Signature), the closing block (free next steps
 * instead of anything commercial) and the in-session nudges (none). It also owns the mode choice screen, so the shared mode selector is not loaded.
 *
 * Needs: CertShieldAssessmentScoring, CertShieldDomUtils, CertShieldHonest, CertShieldLearnStore, CertShieldLearnUI and the two runners. Makes no
 * network request; a finished mock exam is summarised into this browser's localStorage (CertShieldLearnStore) for the My progress page and nowhere else.
 */
(function () {
  "use strict";

  var scoring = window.CertShieldAssessmentScoring;
  var domUtils = window.CertShieldDomUtils;
  var honest = window.CertShieldHonest;
  var store = window.CertShieldLearnStore;
  var ui = window.CertShieldLearnUI;
  var RunnerModule = window.CertShieldAssessmentRunner;
  var StudyModule = window.CertShieldStudyModeRunner;
  if (!scoring || !domUtils || !honest || !ui || !RunnerModule || !StudyModule) return;

  var el = domUtils.el;
  var scrollToElement = domUtils.scrollToElement;
  var BaseRunner = RunnerModule.AssessmentRunner;
  var BaseStudy = StudyModule.StudyModeRunner;
  var LEARN = ui.LEARN;
  var ACADEMY_LEARN = ui.ACADEMY_LEARN;

  var CONFIDENCE_DISPLAY = {
    stable: { label: "Stable knowledge", hint: "Right, and you were sure", status: "good", icon: "✓" },
    fragile: { label: "Fragile knowledge", hint: "Right, but not confident", status: "warning", icon: "◐" },
    misconception: { label: "Likely misconception", hint: "Wrong, while feeling sure", status: "critical", icon: "✕" },
    gap: { label: "Knowledge gap", hint: "Wrong, and you knew you weren’t sure", status: "serious", icon: "△" },
    guessing: { label: "Guessing", hint: "No real signal yet", status: "muted", icon: "–" },
    unclassified: { label: "No confidence given", hint: "Confidence wasn’t marked", status: "muted", icon: "–" }
  };

  function isLearn(runner) {
    return Boolean(runner && runner.payload && runner.payload.learn);
  }

  function typeById(payload, id) {
    var list = payload.trapTypes || [];
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return null;
  }

  // ---------------------------------------------------------------- mode choice (replaces assets/js/ui/assessment-mode-select.js)

  function track(name, mode) {
    if (domUtils.trackAssessmentEvent) domUtils.trackAssessmentEvent(name, mode);
  }

  function renderModeChoice(root) {
    var chooser = el("div", "mode-select");
    chooser.appendChild(el("p", "mode-select-eyebrow", "Choose how you want to practise"));
    var grid = el("div", "mode-select-grid");

    var exam = el("div", "mode-select-card");
    exam.appendChild(el("h3", "", "Mock exam"));
    exam.appendChild(el("p", "", "Answer first, then see everything at the end: your score as an honest range, your result for every exam topic and the traps that caught you. Timed or untimed."));
    var examButton = el("button", "button button-primary", "Start the mock exam");
    examButton.type = "button";
    exam.appendChild(examButton);

    var study = el("div", "mode-select-card");
    study.appendChild(el("h3", "", "Study mode"));
    study.appendChild(el("p", "", "See the explanation right after each answer, and the trap type behind it. No score, no pressure: just learning."));
    var studyButton = el("button", "button button-secondary", "Start studying");
    studyButton.type = "button";
    study.appendChild(studyButton);

    grid.appendChild(exam);
    grid.appendChild(study);
    chooser.appendChild(grid);
    root.appendChild(chooser);

    function focusStart() {
      // the chooser removes itself when a mode is picked, so focus goes to the next primary button instead of being dropped on the page
      var next = root.querySelector(".assessment-landing-actions button");
      if (next) next.focus({ preventScroll: true });
    }
    examButton.addEventListener("click", function () {
      track("assessment_start", "diagnostic");
      new BaseRunner(root);
      focusStart();
    });
    studyButton.addEventListener("click", function () {
      track("assessment_start", "study");
      new BaseStudy(root);
      focusStart();
    });
  }

  function initAll() {
    Array.prototype.slice.call(document.querySelectorAll("[data-assessment-runner]")).forEach(function initOne(root) {
      if (root.getAttribute("data-assessment-initialized") === "true") return;
      root.setAttribute("data-assessment-initialized", "true");
      renderModeChoice(root);
    });
  }

  // ---------------------------------------------------------------- the mock exam: landing note, results, review

  var originalLanding = BaseRunner.prototype.renderLanding;
  BaseRunner.prototype.renderLanding = function renderLearnLanding() {
    originalLanding.call(this);
    if (!isLearn(this)) return;
    var actions = this.landing.querySelector(".assessment-landing-actions");
    var note = el("p", "assessment-limitation-note", "At the end you get your score as an honest range, your result for every exam topic, the traps that caught you and an explanation for every answer.");
    if (actions) this.landing.insertBefore(note, actions);
    else this.landing.appendChild(note);
  };

  var originalRenderCta = BaseRunner.prototype.renderCta;
  BaseRunner.prototype.renderCta = function renderLearnCta() {
    if (isLearn(this)) return undefined; // nothing to sell here; the free next steps are part of renderResults
    return originalRenderCta.apply(this, arguments);
  };

  var originalRenderResults = BaseRunner.prototype.renderResults;
  BaseRunner.prototype.renderResults = function renderLearnResults() {
    if (!isLearn(this)) return originalRenderResults.call(this);
    var self = this;
    var payload = this.payload;
    var result = this.lastResult;
    var score = result.scoreResult;
    var meta = payload.meta || {};
    var weights = payload.blueprint && payload.blueprint.weights ? payload.blueprint.weights : null;
    var approx = Boolean(payload.blueprint && payload.blueprint.approximate);
    var panel = this.resultsPanel;
    panel.innerHTML = "";
    panel.hidden = false;
    panel.classList.remove("band-ready", "band-momentum", "band-developing", "band-foundation");

    var topics = score.domains.map(function toTopic(d) {
      return { name: d.domain, c: d.correct, a: d.attempted, n: d.total, w: weights && typeof weights[d.domain] === "number" ? weights[d.domain] : null };
    });
    var sum = honest.summarise(topics);
    var previous = store ? store.lastAttempt(payload.slug) : null; // read before this attempt is saved
    var headline = sum.weighted || sum.pooled;

    // ---- the answer in one glance
    var hero = el("div", "lr-hero");
    hero.appendChild(el("p", "lr-kicker", "Your result"));
    if (!sum.attempted) {
      hero.appendChild(el("p", "lr-range", "No answers yet"));
      hero.appendChild(el("p", "lr-sentence", "Answer at least one question and you will see the range your score supports."));
    } else {
      var shown = Math.round(sum.pct);
      hero.appendChild(el("p", "lr-range", honest.rangeText(headline.loPct, headline.hiPct)));
      hero.appendChild(el("p", "lr-sentence",
        "You got " + sum.correct + " of the " + sum.attempted + " questions you answered right (" + shown + "%). " +
        (sum.weighted
          ? "Counting each topic the way the real exam does, that points to a level of between " + headline.loPct + "% and " + headline.hiPct + "%."
          : "That points to a level of between " + headline.loPct + "% and " + headline.hiPct + "% on questions like these.")));
      hero.appendChild(ui.rangeBar(headline.loPct, headline.hiPct, shown, "Likely range " + headline.loPct + " to " + headline.hiPct + " percent; you scored " + shown + " percent of the questions you answered"));
    }
    panel.appendChild(hero);

    if (sum.attempted) {
      var pair = el("div", "lr-pair");
      var c1 = el("div", "lr-card");
      c1.appendChild(el("h3", "", "Your score"));
      c1.appendChild(el("p", "lr-big", sum.correct + " / " + sum.attempted));
      c1.appendChild(el("p", "", "You answered " + sum.attempted + " of " + score.total + " questions (" + score.coveragePercentage + "%). Skipped questions are not counted against you."));
      pair.appendChild(c1);
      var c2 = el("div", "lr-card");
      c2.appendChild(el("h3", "", "Range for questions like these"));
      c2.appendChild(el("p", "lr-big", honest.rangeText(sum.pooled.loPct, sum.pooled.hiPct)));
      c2.appendChild(el("p", "", "A 90% range from how many questions you answered. Wider means less evidence."));
      pair.appendChild(c2);
      if (sum.weighted) {
        var c3 = el("div", "lr-card");
        c3.appendChild(el("h3", "", "Range on the real exam’s mix of topics"));
        c3.appendChild(el("p", "lr-big", honest.rangeText(sum.weighted.loPct, sum.weighted.hiPct)));
        c3.appendChild(el("p", "", "Each topic counts as much as the exam guide says" + (approx ? " (the vendor’s percentages are approximate or averages)" : "") + "."));
        pair.appendChild(c3);
      }
      panel.appendChild(pair);

      // ---- how far to trust it
      if (score.coverage < 0.5) {
        panel.appendChild(el("p", "lr-note lr-warn", "You answered fewer than half the questions, so the range is wide. Answer more for a firmer picture."));
      } else if (sum.attempted < 10) {
        panel.appendChild(el("p", "lr-note lr-warn", "With fewer than ten answers any range is very wide. Treat this as a first hint."));
      }
      if (sum.untouched.length) {
        var names = sum.untouched.map(function name(t) { return t.name; }).join(", ");
        var share = sum.untouchedWeight !== null ? " They carry about " + Math.round(sum.untouchedWeight * 100) + "% of the real exam." : "";
        panel.appendChild(el("p", "lr-note lr-warn", "You answered nothing in: " + names + "." + share + (sum.weighted ? " They widen the weighted range instead of being ignored." : "")));
      }
      if (!weights) {
        panel.appendChild(el("p", "lr-note", "This exam’s guide does not publish usable topic weights, so only the range for questions like these is shown."));
      }

      // ---- compared with last time
      if (previous) {
        var verdict = honest.compareAttempts({ pooled: { lo: previous.lo, hi: previous.hi } }, { pooled: { lo: sum.pooled.loPct, hi: sum.pooled.hiPct } });
        var tail = verdict.verdict === "up" ? "This is a real improvement: the two ranges no longer overlap."
          : verdict.verdict === "down" ? "This is lower, and the two ranges no longer overlap."
          : "The two ranges overlap, so the difference may only be which questions you got.";
        panel.appendChild(el("p", "lr-note", "Last time (" + ui.fullDate(previous.t) + "): " + previous.k + " of " + previous.n + " right, range " + honest.rangeText(previous.lo, previous.hi) + ". " + tail));
      }
    }

    // ---- by exam topic
    var ranked = result.rankedResult.ranked;
    if (ranked.length) {
      panel.appendChild(el("h3", "lr-h", "Where you are strong, and where to focus"));
      panel.appendChild(el("p", "lr-sub", "Where to focus first is at the top: topics where you were wrong while sure come first, then the lowest accuracy. A topic with fewer than three answers is marked as limited evidence."));
      var list = el("ul", "lx-bars");
      list.setAttribute("aria-label", "Result by exam topic");
      ranked.forEach(function addTopic(d) {
        var weight = weights && typeof weights[d.domain] === "number" ? weights[d.domain] : null;
        var topicRow = el("li", "lx-bar-row");
        var label = el("span", "lx-bar-label");
        label.appendChild(el("span", "", d.domain));
        topicRow.appendChild(label);
        topicRow.appendChild(ui.bar(d.percentage));
        topicRow.appendChild(el("span", "lx-bar-n", d.correct + " of " + d.attempted + " right · " + d.percentage + "%" + (d.evidenceLimited ? " · limited evidence" : "") +
          (weight !== null ? " · " + (approx ? "~" : "") + weight + "% of exam" : "")));
        list.appendChild(topicRow);
      });
      panel.appendChild(list);
    }

    // ---- Error Signature
    var rows = (payload.trapTypes || []).map(function toRow(t) { return { type: t.id, answered: 0, missed: 0 }; });
    var byType = {};
    rows.forEach(function index(r) { byType[r.type] = r; });
    var trapOf = {};
    payload.questions.forEach(function map(q) { trapOf[q.id] = q.trap; });
    score.details.forEach(function tally(d) {
      var t = trapOf[d.id];
      if (!d.answered || !t || !byType[t]) return;
      byType[t].answered += 1;
      if (d.state === "incorrect") byType[t].missed += 1;
    });
    var flagged = honest.errorSignature(rows);
    var labelledAnswered = rows.reduce(function add(n, r) { return n + r.answered; }, 0);
    var labelledMissed = rows.reduce(function add(n, r) { return n + r.missed; }, 0);
    panel.appendChild(el("h3", "lr-h", "Your Error Signature"));
    if (flagged.length) {
      panel.appendChild(el("p", "lr-sub", "These tricks caught you more often than your overall score would predict. It is a pointer, not a diagnosis."));
      var sig = el("ul", "lr-sig");
      flagged.forEach(function addFlag(f) {
        var type = typeById(payload, f.type) || { id: f.type, name: f.type };
        var li = el("li", "lx-t-" + f.type);
        var h = el("h4", "");
        h.appendChild(ui.trapIcon(type, 24));
        h.appendChild(document.createTextNode(type.name));
        li.appendChild(h);
        li.appendChild(el("p", "", "You missed " + f.missed + " of the " + f.answered + " questions of this type (" + Math.round(f.rate * 100) + "%), against " +
          Math.round((labelledMissed / labelledAnswered) * 100) + "% overall."));
        if (type.short) li.appendChild(el("p", "", type.short));
        if (type.tip) li.appendChild(el("p", "", "Try this: " + type.tip));
        var more = el("p", "");
        more.appendChild(ui.link(LEARN + "/trap-atlas/" + f.type + "/", "How to spot and beat it", true));
        li.appendChild(more);
        sig.appendChild(li);
      });
      panel.appendChild(sig);
    } else {
      var maxAnswered = rows.reduce(function max(n, r) { return Math.max(n, r.answered); }, 0);
      var message = !labelledAnswered ? "Answer some questions and this shows which tricks catch you."
        : maxAnswered < honest.SIGNATURE.minAnswered ? "Too few answers to spot a pattern yet. It takes at least " + honest.SIGNATURE.minAnswered + " answered questions of one trap type, with " + honest.SIGNATURE.minMissed + " misses."
        : !labelledMissed ? "You got every question you answered right, so there is nothing to flag."
        : "No single trap type stands out: your misses are spread about evenly.";
      panel.appendChild(el("p", "lr-note", message));
    }
    if (labelledAnswered) {
      var details = el("details", "disclosure");
      var summary = el("summary");
      summary.appendChild(el("span", "", "Every trap type for this attempt"));
      details.appendChild(summary);
      var wrap = el("div", "disclosure-grid");
      var tbl = document.createElement("table");
      tbl.className = "assessment-domain-table";
      var cap = document.createElement("caption");
      cap.textContent = "Questions answered and missed, by main trap type";
      tbl.appendChild(cap);
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      ["Trap type", "Answered", "Missed"].forEach(function head(label) { var th = document.createElement("th"); th.scope = "col"; th.textContent = label; hr.appendChild(th); });
      thead.appendChild(hr);
      tbl.appendChild(thead);
      var tbody = document.createElement("tbody");
      rows.forEach(function addRow(r) {
        var type = typeById(payload, r.type);
        var tr = document.createElement("tr");
        var th = document.createElement("th");
        th.scope = "row";
        th.textContent = type ? type.name : r.type;
        tr.appendChild(th);
        [r.answered, r.missed].forEach(function cell(v) { var td = document.createElement("td"); td.textContent = String(v); tr.appendChild(td); });
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      var scroll = domUtils.makeScrollRegion(el("div", "assessment-table-scroll"), "Trap types for this attempt (scrollable table)");
      scroll.appendChild(tbl);
      wrap.appendChild(scroll);
      details.appendChild(wrap);
      panel.appendChild(details);
    }

    // ---- how sure you were
    var counts = {};
    score.details.forEach(function tally(d) { if (d.answered) counts[d.confidenceClass] = (counts[d.confidenceClass] || 0) + 1; });
    var keys = Object.keys(CONFIDENCE_DISPLAY).filter(function has(k) { return counts[k] > 0; });
    if (keys.length) {
      panel.appendChild(el("h3", "lr-h", "How well-calibrated is your confidence?"));
      var tiles = el("div", "assessment-calibration-row");
      keys.forEach(function addTile(k) {
        var d = CONFIDENCE_DISPLAY[k];
        var tile = el("div", "assessment-calibration-tile status-" + d.status);
        tile.appendChild(el("span", "assessment-calibration-icon", d.icon));
        tile.appendChild(el("strong", "assessment-calibration-count", String(counts[k])));
        tile.appendChild(el("span", "assessment-calibration-label", d.label));
        tile.appendChild(el("span", "assessment-calibration-hint", d.hint));
        tiles.appendChild(tile);
      });
      panel.appendChild(tiles);
    }

    // ---- what to do next, all free
    if (result.studyActions.length) {
      panel.appendChild(el("h3", "lr-h", "What to do next"));
      var ol = document.createElement("ol");
      ol.className = "assessment-actions-list";
      result.studyActions.forEach(function add(a) { ol.appendChild(el("li", "", a.text)); });
      panel.appendChild(ol);
    }
    panel.appendChild(freeNextSteps(payload, flagged));

    // ---- save it on this device, and say so
    var saved = false;
    if (sum.attempted && store && store.available()) {
      saved = store.recordAttempt(payload.slug, {
        t: Date.now(), name: meta.certificationName || payload.slug, k: sum.correct, n: sum.attempted, total: score.total,
        lo: sum.pooled.loPct, hi: sum.pooled.hiPct, wlo: sum.weighted ? sum.weighted.loPct : null, whi: sum.weighted ? sum.weighted.hiPct : null,
        d: topics.map(function pack(t) { return [t.name, t.c, t.a, t.w]; }),
        tr: rows.reduce(function pack(o, r) { if (r.answered) o[r.type] = [r.answered, r.missed]; return o; }, {})
      });
    }
    var savedNote = el("p", "microcopy");
    if (saved) {
      savedNote.appendChild(document.createTextNode("Saved on this device only. "));
      savedNote.appendChild(ui.link(LEARN + "/my-progress/", "See My progress"));
      savedNote.appendChild(document.createTextNode("."));
    } else if (sum.attempted) {
      savedNote.textContent = "Your browser is not allowing this site to store anything, so this result is not saved.";
    }
    panel.appendChild(savedNote);

    // ---- actions and the answer review
    var actionsRow = el("div", "assessment-results-actions");
    var review = el("button", "button button-secondary", "Review all answers");
    review.type = "button";
    review.addEventListener("click", function () { self.renderReview("all"); scrollToElement(self.reviewHost); });
    actionsRow.appendChild(review);
    var print = el("button", "button button-text", "Print this report");
    print.type = "button";
    print.addEventListener("click", function () { window.print(); });
    actionsRow.appendChild(print);
    var retake = el("button", "button button-text", "Retake the mock exam");
    retake.type = "button";
    retake.addEventListener("click", function () { window.location.reload(); });
    actionsRow.appendChild(retake);
    panel.appendChild(actionsRow);
    this.reviewHost = el("div", "assessment-review-host");
    panel.appendChild(this.reviewHost);

    this.learnSummary = sum;
    this.announce(sum.attempted
      ? "Your result: " + sum.correct + " of " + sum.attempted + " right. Likely range " + headline.loPct + " to " + headline.hiPct + " percent."
      : "You have not answered any questions yet.");
    scrollToElement(panel);
    return undefined;
  };

  function freeNextSteps(payload, flagged) {
    var wrap = el("div", "lr-next");
    wrap.appendChild(el("h3", "lr-h", "Keep going, all free"));
    var list = el("ul", "lr-links");
    function add(a) { var li = document.createElement("li"); li.appendChild(a); list.appendChild(li); }
    flagged.forEach(function each(f) {
      var type = typeById(payload, f.type);
      if (type) add(ui.link(LEARN + "/trap-atlas/" + f.type + "/", "Trap Atlas: " + type.name, true));
    });
    if (!flagged.length) add(ui.link(LEARN + "/trap-atlas/", "Browse the Trap Atlas", true));
    add(ui.link(LEARN + "/readiness/", "Check the score of another practice test", true));
    add(ui.link(LEARN + "/my-progress/", "See your progress on this device", true));
    if (payload.academyUrl) add(ui.link(payload.academyUrl, "Exam facts, fees and renewal for this certification ↗", true));
    if (payload.academyId) add(ui.link(ACADEMY_LEARN + "/tools/study-planner/?exam=" + encodeURIComponent(payload.academyId), "Plan your study week by week ↗", true));
    wrap.appendChild(list);
    return wrap;
  }

  // The review lists every question; each gets its trap type under the heading so the pattern is visible while the explanation is open.
  var originalReview = BaseRunner.prototype.renderReview;
  BaseRunner.prototype.renderReview = function renderLearnReview() {
    originalReview.apply(this, arguments);
    if (!isLearn(this) || !this.reviewHost) return;
    var payload = this.payload;
    var byNumber = {};
    this.questions.forEach(function index(q) { byNumber[q.questionNumber] = q; });
    Array.prototype.slice.call(this.reviewHost.querySelectorAll(".assessment-review-item")).forEach(function decorate(article) {
      var heading = article.querySelector("h4");
      var match = heading && /^Question (\d+)/.exec(heading.textContent);
      var q = match ? byNumber[Number(match[1])] : null;
      var type = q && q.trap ? typeById(payload, q.trap) : null;
      if (type) heading.parentNode.insertBefore(ui.trapChip(type), heading.nextSibling);
    });
  };

  // ---------------------------------------------------------------- study mode: no nudges, no closing pitch, the trap type with each explanation

  var originalIntro = BaseStudy.prototype.renderIntro;
  BaseStudy.prototype.renderIntro = function renderLearnIntro() {
    originalIntro.call(this);
    if (!isLearn(this)) return;
    var note = this.introPanel.querySelector(".assessment-limitation-note");
    if (note) note.textContent = "This is a learning mode, not a test: there is no score range here. Choose the mock exam when you want an honest range for your score.";
  };

  var originalNudge = BaseStudy.prototype.renderNudge;
  BaseStudy.prototype.renderNudge = function renderLearnNudge() {
    if (isLearn(this)) return undefined;
    return originalNudge.apply(this, arguments);
  };

  var originalReveal = BaseStudy.prototype.renderRevealPanel;
  BaseStudy.prototype.renderRevealPanel = function renderLearnReveal(question) {
    originalReveal.call(this, question);
    if (!isLearn(this)) return;
    var type = question.trap ? typeById(this.payload, question.trap) : null;
    var panel = this.questionHost.querySelector(".study-explanation-panel");
    if (type && panel) {
      var chip = ui.trapChip(type);
      var state = panel.querySelector(".study-explanation-state");
      panel.insertBefore(chip, state ? state.nextSibling : panel.firstChild);
      if (type.short) chip.appendChild(document.createTextNode(" — " + type.short));
    }
  };

  var originalSummaryCta = BaseStudy.prototype.renderSummaryCta;
  BaseStudy.prototype.renderSummaryCta = function renderLearnSummaryCta() {
    if (!isLearn(this)) return originalSummaryCta.apply(this, arguments);
    this.summaryPanel.appendChild(freeNextSteps(this.payload, []));
    return undefined;
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAll);
  else initAll();
}());
