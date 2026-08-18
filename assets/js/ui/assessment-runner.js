/**
 * CertShield diagnostic-assessment runner UI ("Diagnostic Mode").
 *
 * DOM contract
 * ------------
 * Instantiated on demand by assets/js/ui/assessment-mode-select.js once the
 * learner picks Diagnostic Mode (never self-initializes on page load — the
 * mode selector owns that). Root: [data-assessment-runner] containing a
 * JSON payload script:
 *   <script type="application/json" data-assessment-payload>{...}</script>
 *
 * Payload shape: { slug, contentVersion, courseId, offer, meta, questions[] }
 * (see scripts/render_site.py `build_assessment_payload`). Only the
 * pre-sanitized *Html fields produced at build time by
 * scripts/import/markdown_assessment.py are ever set via innerHTML; every
 * other value is set via textContent. No network requests are made and no
 * question, answer, confidence or personal data ever leaves the browser.
 *
 * Submission model: the learner can submit at any time, from any point in
 * the assessment. Only questions actually answered are scored — there is no
 * "you must finish" gate. Depends on window.CertShieldAssessmentScoring
 * (assets/js/core/assessment-scoring.js) and window.CertShieldDomUtils
 * (assets/js/core/dom-utils.js).
 */
(function () {
  "use strict";

  var scoring = window.CertShieldAssessmentScoring;
  var domUtils = window.CertShieldDomUtils;
  if (!scoring || !domUtils) return;

  var el = domUtils.el;
  var html = domUtils.html;
  var svgEl = domUtils.svgEl;
  var scrollToElement = domUtils.scrollToElement;
  var formatClock = domUtils.formatClock;
  var safeStorage = domUtils.safeStorage;

  var STORAGE_PREFIX = "certshield.assessment.v2.";
  var HISTORY_PREFIX = "certshield.assessment.history.v2.";
  var MAX_HISTORY = 3;
  var CONFIDENCE_OPTIONS = ["sure", "unsure", "guessing"];
  var CONFIDENCE_LABELS = { sure: "Sure", unsure: "Unsure", guessing: "Guessing" };

  // Shared flag glyph: reused on the navigator's flagged badge (as a CSS
  // background, see site.css .assessment-nav-item.is-flagged::before) and
  // inline here on the jump control, so "flagged" reads as one consistent
  // icon everywhere rather than two different visual languages.
  var FLAG_ICON_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="1" width="1.6" height="14" rx="0.4"></rect>' +
    '<path d="M4.6 2h8.4l-2.6 3 2.6 3H4.6z"></path>' +
    "</svg>";

  var CONFIDENCE_DISPLAY = {
    stable: { label: "Stable knowledge", hint: "Correct, and you knew it", status: "good" },
    fragile: { label: "Fragile knowledge", hint: "Correct, but not confident", status: "warning" },
    misconception: { label: "Likely misconception", hint: "Wrong, while feeling sure", status: "critical" },
    gap: { label: "Knowledge gap", hint: "Wrong, and you knew you weren't sure", status: "serious" },
    guessing: { label: "Guessing", hint: "No real signal yet", status: "muted" },
    unclassified: { label: "No confidence given", hint: "Confidence wasn't marked", status: "muted" }
  };

  function parseDurationMinutes(text) {
    var match = /(\d+)\s*minute/i.exec(text || "");
    return match ? Number(match[1]) : 60;
  }

  function AssessmentRunner(root) {
    this.root = root;
    this.storage = safeStorage();
    var payloadNode = root.querySelector("[data-assessment-payload]");
    if (!payloadNode) return;
    try {
      this.payload = JSON.parse(payloadNode.textContent);
    } catch (error) {
      return;
    }
    this.slug = this.payload.slug;
    this.contentVersion = this.payload.contentVersion;
    this.questions = this.payload.questions || [];
    this.storageKey = STORAGE_PREFIX + this.slug;
    this.historyKey = HISTORY_PREFIX + this.slug;
    this.mode = "untimed";
    this.timedSeconds = parseDurationMinutes(this.payload.meta && this.payload.meta.estimatedDuration) * 60;
    this.answers = Object.create(null);
    this.confidences = Object.create(null);
    this.flags = Object.create(null);
    this.currentIndex = 0;
    this.submitted = false;
    this.timerHandle = null;
    this.remainingSeconds = this.timedSeconds;

    this.buildShell();
    this.renderLanding();
  }

  AssessmentRunner.prototype.buildShell = function buildShell() {
    this.root.innerHTML = "";
    this.landing = el("div", "assessment-landing");
    this.runnerPanel = el("div", "assessment-runner-panel");
    this.runnerPanel.hidden = true;
    this.resultsPanel = el("div", "assessment-results-panel");
    this.resultsPanel.hidden = true;
    this.liveRegion = el("div", "");
    this.liveRegion.setAttribute("aria-live", "polite");
    this.liveRegion.setAttribute("aria-atomic", "true");
    this.liveRegion.style.position = "absolute";
    this.liveRegion.style.width = "1px";
    this.liveRegion.style.height = "1px";
    this.liveRegion.style.overflow = "hidden";
    this.liveRegion.style.clip = "rect(0,0,0,0)";
    this.root.appendChild(this.landing);
    this.root.appendChild(this.runnerPanel);
    this.root.appendChild(this.resultsPanel);
    this.root.appendChild(this.liveRegion);
  };

  AssessmentRunner.prototype.announce = function announce(message) {
    var region = this.liveRegion;
    region.textContent = "";
    window.setTimeout(function () {
      region.textContent = message;
    }, 0);
  };

  AssessmentRunner.prototype.readSavedAttempt = function readSavedAttempt() {
    if (!this.storage) return null;
    try {
      var raw = this.storage.getItem(this.storageKey);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || saved.contentVersion !== this.contentVersion) return null;
      return saved;
    } catch (error) {
      return null;
    }
  };

  AssessmentRunner.prototype.hasStaleAttempt = function hasStaleAttempt() {
    if (!this.storage) return false;
    try {
      var raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      return Boolean(saved) && saved.contentVersion !== this.contentVersion;
    } catch (error) {
      return false;
    }
  };

  AssessmentRunner.prototype.saveAttempt = function saveAttempt() {
    if (!this.storage || this.submitted) return;
    var payload = {
      contentVersion: this.contentVersion,
      mode: this.mode,
      currentIndex: this.currentIndex,
      answers: this.answers,
      confidences: this.confidences,
      flags: this.flags,
      remainingSeconds: this.remainingSeconds,
      startedAt: this.startedAt || Date.now()
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(payload));
    } catch (error) {
      /* storage may be unavailable or full; in-memory attempt still works */
    }
  };

  AssessmentRunner.prototype.clearSavedAttempt = function clearSavedAttempt() {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.storageKey);
    } catch (error) {
      /* ignore */
    }
  };

  AssessmentRunner.prototype.readHistory = function readHistory() {
    if (!this.storage) return [];
    try {
      var raw = this.storage.getItem(this.historyKey);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  };

  AssessmentRunner.prototype.pushHistory = function pushHistory(summary) {
    if (!this.storage) return;
    var history = this.readHistory();
    history.unshift(summary);
    history = history.slice(0, MAX_HISTORY);
    try {
      this.storage.setItem(this.historyKey, JSON.stringify(history));
    } catch (error) {
      /* ignore */
    }
  };

  // ---------------------------------------------------------------- landing

  AssessmentRunner.prototype.renderLanding = function renderLanding() {
    var self = this;
    var meta = this.payload.meta || {};
    this.landing.innerHTML = "";
    this.landing.hidden = false;
    this.runnerPanel.hidden = true;
    this.resultsPanel.hidden = true;

    if (this.hasStaleAttempt()) {
      var staleNotice = el(
        "div",
        "assessment-notice",
        "This assessment was updated since your last unfinished attempt. Starting a fresh attempt."
      );
      this.landing.appendChild(staleNotice);
      this.clearSavedAttempt();
    }

    var summary = el("div", "assessment-summary-grid");
    var stats = [
      ["Questions", String(this.questions.length)],
      ["Format", meta.mcqCount + " single-answer, " + meta.msqCount + " multi-answer"],
      ["Domains sampled", (meta.domains || []).length + " domains"],
      ["Estimated duration", meta.estimatedDuration || "Not specified"]
    ];
    stats.forEach(function addStat(pair) {
      var tile = el("div", "assessment-stat");
      tile.appendChild(el("span", "", pair[0]));
      tile.appendChild(el("strong", "", pair[1]));
      summary.appendChild(tile);
    });
    this.landing.appendChild(summary);

    var modeFieldset = el("fieldset", "assessment-mode-select");
    modeFieldset.appendChild(el("legend", "", "Choose your practice mode"));
    ["untimed", "timed"].forEach(function addMode(modeKey) {
      var label = el("label", "assessment-mode-option");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "assessment-mode";
      input.value = modeKey;
      input.checked = modeKey === "untimed";
      input.addEventListener("change", function () {
        self.mode = modeKey;
      });
      label.appendChild(input);
      label.appendChild(
        el(
          "span",
          "",
          modeKey === "untimed"
            ? "Untimed — take as long as you need"
            : "Timed — " + (meta.estimatedDuration || "exam-length duration")
        )
      );
      modeFieldset.appendChild(label);
    });
    this.landing.appendChild(modeFieldset);

    var limitation = el(
      "p",
      "assessment-limitation-note",
      "Answer as many or as few questions as you like, then submit whenever you're ready — your results are based on exactly what you answered."
    );
    this.landing.appendChild(limitation);

    var saved = this.readSavedAttempt();
    var actions = el("div", "assessment-landing-actions");
    if (saved) {
      var resumeButton = el("button", "button button-primary", "Resume your attempt");
      resumeButton.type = "button";
      resumeButton.addEventListener("click", function () {
        self.restoreAttempt(saved);
        self.startRunner();
      });
      actions.appendChild(resumeButton);

      var restartButton = el("button", "button button-secondary", "Start over");
      restartButton.type = "button";
      restartButton.addEventListener("click", function () {
        self.clearSavedAttempt();
        self.startRunner();
      });
      actions.appendChild(restartButton);
    } else {
      var startButton = el("button", "button button-primary", "Start Assessment");
      startButton.type = "button";
      startButton.addEventListener("click", function () {
        self.startRunner();
      });
      actions.appendChild(startButton);
    }
    this.landing.appendChild(actions);
  };

  // ----------------------------------------------------------------- runner

  AssessmentRunner.prototype.restoreAttempt = function restoreAttempt(saved) {
    this.mode = saved.mode || "untimed";
    this.currentIndex = Number(saved.currentIndex) || 0;
    this.answers = saved.answers || Object.create(null);
    this.confidences = saved.confidences || Object.create(null);
    this.flags = saved.flags || Object.create(null);
    this.remainingSeconds = Number(saved.remainingSeconds) || this.timedSeconds;
    this.startedAt = Number(saved.startedAt) || Date.now();
  };

  AssessmentRunner.prototype.startRunner = function startRunner() {
    this.startedAt = this.startedAt || Date.now();
    this.landing.hidden = true;
    this.runnerPanel.hidden = false;
    this.buildRunnerChrome();
    this.renderQuestion();
    if (this.mode === "timed") this.startTimer();
    this.saveAttempt();
    scrollToElement(this.runnerPanel);
  };

  AssessmentRunner.prototype.buildRunnerChrome = function buildRunnerChrome() {
    var self = this;
    this.runnerPanel.innerHTML = "";

    this.progressBar = el("div", "assessment-progress-bar");
    this.progressBar.setAttribute("role", "progressbar");
    this.progressBar.setAttribute("aria-valuemin", "0");
    this.progressBar.setAttribute("aria-valuemax", String(this.questions.length));
    this.progressFill = el("div", "assessment-progress-fill");
    this.progressBar.appendChild(this.progressFill);
    this.runnerPanel.appendChild(this.progressBar);

    var statusRow = el("div", "assessment-status-row");
    this.progressText = el("p", "assessment-progress-text");
    statusRow.appendChild(this.progressText);
    this.timerText = el("p", "assessment-timer-text");
    this.timerText.hidden = this.mode !== "timed";
    statusRow.appendChild(this.timerText);
    this.autosaveText = el("p", "assessment-autosave-text", "Progress saves automatically in this browser.");
    statusRow.appendChild(this.autosaveText);
    this.runnerPanel.appendChild(statusRow);

    this.navigator = el("div", "assessment-navigator");
    this.navigator.setAttribute("role", "group");
    this.navigator.setAttribute("aria-label", "Question navigator");
    this.questions.forEach(function addNavButton(question, index) {
      var button = el("button", "assessment-nav-item", String(index + 1));
      button.type = "button";
      button.addEventListener("click", function () {
        self.goTo(index);
      });
      self.navigator.appendChild(button);
    });
    this.runnerPanel.appendChild(this.navigator);

    this.flaggedJumpButton = el("button", "assessment-flagged-jump");
    this.flaggedJumpButton.type = "button";
    html(this.flaggedJumpButton, FLAG_ICON_SVG + '<span class="assessment-flagged-jump-label"></span>');
    this.flaggedJumpButton.hidden = true;
    this.flaggedJumpButton.addEventListener("click", function () {
      self.jumpToNextFlagged();
    });
    this.runnerPanel.appendChild(this.flaggedJumpButton);

    this.questionHost = el("div", "assessment-question-host");
    this.runnerPanel.appendChild(this.questionHost);

    var navRow = el("div", "assessment-nav-row");
    this.prevButton = el("button", "button button-secondary", "Previous");
    this.prevButton.type = "button";
    this.prevButton.addEventListener("click", function () {
      self.goTo(self.currentIndex - 1);
    });
    navRow.appendChild(this.prevButton);

    this.flagButton = el("button", "button button-text", "Flag for review");
    this.flagButton.type = "button";
    this.flagButton.addEventListener("click", function () {
      self.toggleFlag();
    });
    navRow.appendChild(this.flagButton);

    this.nextButton = el("button", "button button-primary", "Next");
    this.nextButton.type = "button";
    this.nextButton.addEventListener("click", function () {
      self.goTo(self.currentIndex + 1);
    });
    navRow.appendChild(this.nextButton);

    this.submitButton = el("button", "button button-primary assessment-submit-button", "Submit & See My Results");
    this.submitButton.type = "button";
    this.submitButton.addEventListener("click", function () {
      self.completeAttempt();
    });
    navRow.appendChild(this.submitButton);

    this.runnerPanel.appendChild(navRow);

    var footerRow = el("div", "assessment-nav-row assessment-nav-row-secondary");
    var submitAnytimeNote = el(
      "p",
      "assessment-submit-anytime-note",
      "You can submit at any point — only the questions you've answered count toward your result."
    );
    footerRow.appendChild(submitAnytimeNote);

    this.restartLink = el("button", "button button-text", "Clear progress and start over");
    this.restartLink.type = "button";
    this.restartLink.addEventListener("click", function () {
      if (window.confirm("Clear your current progress and start over?")) {
        self.clearSavedAttempt();
        window.location.reload();
      }
    });
    footerRow.appendChild(this.restartLink);
    this.runnerPanel.appendChild(footerRow);
  };

  AssessmentRunner.prototype.startTimer = function startTimer() {
    var self = this;
    this.updateTimerText();
    this.timerHandle = window.setInterval(function tick() {
      self.remainingSeconds -= 1;
      self.updateTimerText();
      if (self.remainingSeconds <= 0) {
        window.clearInterval(self.timerHandle);
        self.announce("Time is up. Submitting your assessment.");
        self.completeAttempt();
      }
    }, 1000);
  };

  AssessmentRunner.prototype.updateTimerText = function updateTimerText() {
    if (!this.timerText) return;
    this.timerText.textContent = "Time remaining: " + formatClock(this.remainingSeconds);
    this.timerText.classList.toggle("is-low-time", this.remainingSeconds <= 60);
  };

  AssessmentRunner.prototype.toggleFlag = function toggleFlag() {
    var question = this.questions[this.currentIndex];
    this.flags[question.id] = !this.flags[question.id];
    this.updateNavigatorStates();
    this.updateFlagButton();
    this.updateFlaggedJumpControl();
    this.saveAttempt();
  };

  AssessmentRunner.prototype.updateFlagButton = function updateFlagButton() {
    var question = this.questions[this.currentIndex];
    var flagged = Boolean(this.flags[question.id]);
    this.flagButton.textContent = flagged ? "Unflag this question" : "Flag for review";
    this.flagButton.setAttribute("aria-pressed", String(flagged));
  };

  AssessmentRunner.prototype.flaggedIndexes = function flaggedIndexes() {
    var self = this;
    var indexes = [];
    this.questions.forEach(function collect(question, index) {
      if (self.flags[question.id]) indexes.push(index);
    });
    return indexes;
  };

  /** Keeps the "Flagged (N)" jump control in sync with real flag state —
   * called after every toggle and every render, so it stays correct
   * whether flags changed here, via resume, or on first load. */
  AssessmentRunner.prototype.updateFlaggedJumpControl = function updateFlaggedJumpControl() {
    if (!this.flaggedJumpButton) return;
    var count = this.flaggedIndexes().length;
    this.flaggedJumpButton.hidden = count === 0;
    if (count === 0) return;
    var label = this.flaggedJumpButton.querySelector(".assessment-flagged-jump-label");
    if (label) {
      label.textContent = count === 1 ? "1 flagged — jump to it" : count + " flagged — jump to next";
    }
    this.flaggedJumpButton.setAttribute(
      "aria-label",
      (count === 1 ? "1 question flagged. " : count + " questions flagged. ") + "Jump to next flagged question."
    );
  };

  /** Cycles forward through flagged questions from the current position,
   * wrapping around — a "find next" pattern rather than a one-shot jump. */
  AssessmentRunner.prototype.jumpToNextFlagged = function jumpToNextFlagged() {
    var indexes = this.flaggedIndexes();
    if (!indexes.length) return;
    var next = indexes.find(function isAfterCurrent(index) {
      return index > this.currentIndex;
    }, this);
    var targetIndex = typeof next === "number" ? next : indexes[0];
    this.goTo(targetIndex);
    this.announce("Jumped to flagged question " + (targetIndex + 1) + " of " + this.questions.length + ".");
  };

  AssessmentRunner.prototype.goTo = function goTo(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    this.renderQuestion();
    this.saveAttempt();
    scrollToElement(this.questionHost);
  };

  AssessmentRunner.prototype.renderQuestion = function renderQuestion() {
    var self = this;
    var question = this.questions[this.currentIndex];
    this.questionHost.innerHTML = "";

    // The visual "card" (background/border/padding/shadow) lives on this
    // plain wrapper div, never on the <fieldset> itself: modern browsers
    // deliberately render <legend> straddling the fieldset's border-top,
    // outside its padding box, per the CSS Fieldset/Legend layout spec —
    // no amount of padding/background on the fieldset keeps the question
    // text visually inside it. The fieldset stays for accessibility
    // (grouping the question with its options) but carries zero styling.
    var card = el("div", "assessment-question-card");
    var article = el("fieldset", "assessment-question");
    var legend = document.createElement("legend");
    html(legend, question.stemHtml);
    article.appendChild(legend);

    if (question.cardinalityInstruction) {
      article.appendChild(el("p", "assessment-cardinality", question.cardinalityInstruction));
    }

    var inputType = question.selectionMode === "multiple" ? "checkbox" : "radio";
    var selected = this.answers[question.id] || [];
    question.options.forEach(function addOption(option) {
      var label = el("label", "assessment-option");
      var input = document.createElement("input");
      input.type = inputType;
      input.name = "question-" + question.id;
      input.value = option.id;
      input.checked = selected.indexOf(option.id) !== -1;
      input.addEventListener("change", function () {
        self.handleOptionChange(question, inputType);
      });
      label.appendChild(input);
      var text = el("span", "");
      html(text, option.textHtml);
      label.appendChild(text);
      article.appendChild(label);
    });

    card.appendChild(article);
    this.questionHost.appendChild(card);

    var confidenceGroup = el("div", "assessment-confidence");
    confidenceGroup.appendChild(el("p", "assessment-confidence-label", "How confident are you?"));
    var chipRow = el("div", "assessment-confidence-chips");
    CONFIDENCE_OPTIONS.forEach(function addConfidence(key) {
      var chip = el("button", "assessment-confidence-chip", CONFIDENCE_LABELS[key]);
      chip.type = "button";
      var active = self.confidences[question.id] === key;
      chip.setAttribute("aria-pressed", String(active));
      if (active) chip.classList.add("is-active");
      chip.addEventListener("click", function () {
        self.confidences[question.id] = self.confidences[question.id] === key ? null : key;
        self.renderQuestion();
        self.saveAttempt();
      });
      chipRow.appendChild(chip);
    });
    confidenceGroup.appendChild(chipRow);
    this.questionHost.appendChild(confidenceGroup);

    this.progressText.textContent = "Question " + (this.currentIndex + 1) + " of " + this.questions.length;
    this.prevButton.hidden = this.currentIndex === 0;
    this.nextButton.hidden = this.currentIndex === this.questions.length - 1;
    this.updateFlagButton();
    this.updateNavigatorStates();
    this.updateFlaggedJumpControl();
    if (this.progressFill) {
      var percentage = ((this.currentIndex + 1) / this.questions.length) * 100;
      this.progressFill.style.width = percentage + "%";
      this.progressBar.setAttribute("aria-valuenow", String(this.currentIndex + 1));
    }
    this.announce(this.progressText.textContent);
  };

  AssessmentRunner.prototype.handleOptionChange = function handleOptionChange(question, inputType) {
    var inputs = Array.from(this.questionHost.querySelectorAll('input[name="question-' + question.id + '"]'));
    var checked = inputs.filter(function isChecked(input) {
      return input.checked;
    });
    if (inputType === "checkbox" && checked.length > question.requiredSelections) {
      inputs.forEach(function uncheckExtra(input) {
        if (input === checked[checked.length - 1]) input.checked = false;
      });
      this.announce("Choose exactly " + question.requiredSelections + " answers for this question.");
      checked = inputs.filter(function isChecked(input) {
        return input.checked;
      });
    }
    this.answers[question.id] = checked.map(function value(input) {
      return input.value;
    });
    this.updateNavigatorStates();
    this.saveAttempt();
  };

  AssessmentRunner.prototype.updateNavigatorStates = function updateNavigatorStates() {
    var self = this;
    Array.from(this.navigator.children).forEach(function updateButton(button, index) {
      var question = self.questions[index];
      var answered = (self.answers[question.id] || []).length === question.requiredSelections;
      var flagged = Boolean(self.flags[question.id]);
      button.classList.toggle("is-current", index === self.currentIndex);
      button.classList.toggle("is-answered", answered);
      button.classList.toggle("is-flagged", flagged);
      button.setAttribute(
        "aria-label",
        "Question " + (index + 1) + (answered ? ", answered" : ", unanswered") + (flagged ? ", flagged" : "")
      );
    });
  };

  AssessmentRunner.prototype.completeAttempt = function completeAttempt() {
    if (this.timerHandle) window.clearInterval(this.timerHandle);
    this.submitted = true;
    var elapsedMs = Date.now() - (this.startedAt || Date.now());
    var scoreResult = scoring.scoreAssessment(this.questions, this.answers, this.confidences);
    var readinessResult = scoring.computeReadinessResult(scoreResult);
    var rankedResult = scoring.rankDomainsForReview(scoreResult);
    var studyActions = scoring.computeStudyActions(scoreResult, rankedResult, readinessResult);
    var history = this.readHistory();
    var previous = history[0] || null;
    var comparison = scoring.compareToPreviousAttempt(
      { correct: scoreResult.correct, accuracyPercentage: scoreResult.accuracyPercentage, bandKey: readinessResult.band.key },
      previous
    );

    this.lastResult = {
      scoreResult: scoreResult,
      readinessResult: readinessResult,
      rankedResult: rankedResult,
      studyActions: studyActions,
      comparison: comparison,
      elapsedMs: elapsedMs
    };

    this.pushHistory({
      completedAt: Date.now(),
      correct: scoreResult.correct,
      attempted: scoreResult.attempted,
      total: scoreResult.total,
      accuracyPercentage: scoreResult.accuracyPercentage,
      coveragePercentage: scoreResult.coveragePercentage,
      bandKey: readinessResult.band.key,
      contentVersion: this.contentVersion
    });
    this.clearSavedAttempt();

    this.runnerPanel.hidden = true;
    this.renderResults();
  };

  // ---------------------------------------------------------------- charts

  /** Horizontal accuracy meter: fill carries severity, track is a lighter same-ramp step. */
  function buildMeter(percentage, statusKey) {
    var wrapper = el("div", "assessment-meter assessment-meter-status-" + statusKey);
    var track = el("div", "assessment-meter-track");
    var fill = el("div", "assessment-meter-fill");
    fill.style.width = Math.max(2, Math.min(100, percentage)) + "%";
    track.appendChild(fill);
    wrapper.appendChild(track);
    return wrapper;
  }

  /**
   * Domain accuracy bar chart: one sequential hue, bars capped at 24px thick
   * with a 4px rounded data-end, 2px gaps, direct value labels at the tip.
   * A single series needs no legend box (the chart's own heading names it).
   */
  function buildDomainBarChart(rankedDomains) {
    if (!rankedDomains.length) return null;

    var barHeight = 22;
    var gap = 10;
    var rowHeight = barHeight + gap;
    var width = 560;
    var labelWidth = 190;
    var trackWidth = width - labelWidth - 46;
    var height = rankedDomains.length * rowHeight;

    var svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      role: "img",
      "aria-label": "Domain accuracy chart",
      class: "assessment-domain-chart"
    });

    rankedDomains.forEach(function drawRow(domain, index) {
      var y = index * rowHeight;
      var barY = y + (rowHeight - barHeight) / 2;
      var pct = domain.accuracy === null ? 0 : domain.accuracy;
      var barWidth = Math.max(4, trackWidth * pct);

      var label = svgEl("text", {
        x: 0,
        y: barY + barHeight / 2 + 4,
        class: "assessment-chart-label"
      });
      var domainName = domain.domain.length > 26 ? domain.domain.slice(0, 25) + "…" : domain.domain;
      label.textContent = domainName;
      svg.appendChild(label);

      var track = svgEl("rect", {
        x: labelWidth,
        y: barY,
        width: trackWidth,
        height: barHeight,
        rx: 4,
        class: "assessment-chart-track"
      });
      svg.appendChild(track);

      var bar = svgEl("rect", {
        x: labelWidth,
        y: barY,
        width: barWidth,
        height: barHeight,
        rx: 4,
        class: "assessment-chart-bar"
      });
      svg.appendChild(bar);

      var valueLabel = svgEl("text", {
        x: labelWidth + trackWidth + 10,
        y: barY + barHeight / 2 + 4,
        class: "assessment-chart-value"
      });
      valueLabel.textContent = domain.percentage + "%";
      svg.appendChild(valueLabel);
    });

    return svg;
  }

  // ---------------------------------------------------------------- results

  AssessmentRunner.prototype.renderResults = function renderResults() {
    var self = this;
    var result = this.lastResult;
    var scoreResult = result.scoreResult;
    var readinessResult = result.readinessResult;
    var band = readinessResult.band;
    var meta = this.payload.meta || {};

    this.resultsPanel.innerHTML = "";
    this.resultsPanel.hidden = false;
    this.resultsPanel.classList.remove(
      "band-ready", "band-momentum", "band-developing", "band-foundation"
    );
    this.resultsPanel.classList.add("band-" + band.key);

    var certName = meta.certificationName || "this certification";

    // ---- motivational hero ----
    var hero = el("div", "assessment-results-hero");
    hero.appendChild(el("p", "assessment-results-eyebrow", "Your diagnostic result"));
    hero.appendChild(el("h2", "assessment-results-headline", band.label));
    hero.appendChild(el("p", "assessment-results-narrative", band.headline + " " + band.narrative));
    this.resultsPanel.appendChild(hero);

    // ---- KPI row ----
    var kpiRow = el("div", "assessment-summary-grid assessment-kpi-row");
    [
      ["Score", scoreResult.correct + " / " + scoreResult.attempted + " attempted"],
      ["Accuracy", scoreResult.accuracyPercentage + "%"],
      ["Coverage", scoreResult.coveragePercentage + "% of " + scoreResult.total + " questions"],
      ["Time taken", formatClock(result.elapsedMs / 1000)]
    ].forEach(function addStat(pair) {
      var tile = el("div", "assessment-stat");
      tile.appendChild(el("span", "", pair[0]));
      tile.appendChild(el("strong", "", pair[1]));
      kpiRow.appendChild(tile);
    });
    this.resultsPanel.appendChild(kpiRow);

    // ---- accuracy meter ----
    var meterSection = el("div", "assessment-meter-section");
    var meterHeadingRow = el("div", "assessment-meter-heading-row");
    meterHeadingRow.appendChild(el("h3", "", "Accuracy on questions you answered"));
    meterHeadingRow.appendChild(el("span", "assessment-meter-percentage", scoreResult.accuracyPercentage + "%"));
    meterSection.appendChild(meterHeadingRow);
    meterSection.appendChild(buildMeter(scoreResult.accuracyPercentage, statusKeyForBand(band.key)));
    if (readinessResult.note) {
      meterSection.appendChild(el("p", "assessment-coverage-note", readinessResult.note));
    }
    this.resultsPanel.appendChild(meterSection);

    // ---- domain chart + table ----
    var rankedDomains = result.rankedResult.ranked;
    var unattemptedDomains = result.rankedResult.unattempted;
    if (rankedDomains.length) {
      this.resultsPanel.appendChild(el("h3", "", "Where you're strong, and where to focus"));
      var chart = buildDomainBarChart(rankedDomains);
      if (chart) this.resultsPanel.appendChild(chart);

      var table = document.createElement("table");
      table.className = "assessment-domain-table";
      var head = document.createElement("thead");
      var headRow = document.createElement("tr");
      ["Domain", "Correct / Attempted", "Accuracy", "Evidence"].forEach(function (label) {
        var th = document.createElement("th");
        th.scope = "col";
        th.textContent = label;
        headRow.appendChild(th);
      });
      head.appendChild(headRow);
      table.appendChild(head);
      var body = document.createElement("tbody");
      rankedDomains.forEach(function addRow(domain) {
        var row = document.createElement("tr");
        var th = document.createElement("th");
        th.scope = "row";
        th.textContent = domain.domain;
        row.appendChild(th);
        [domain.correct + " / " + domain.attempted, domain.percentage + "%", domain.evidenceLabel].forEach(function addCell(value) {
          var td = document.createElement("td");
          td.textContent = value;
          row.appendChild(td);
        });
        body.appendChild(row);
      });
      table.appendChild(body);
      var tableScroll = el("div", "assessment-table-scroll");
      tableScroll.appendChild(table);
      this.resultsPanel.appendChild(tableScroll);
    }
    if (unattemptedDomains.length) {
      var names = unattemptedDomains.map(function name(domain) { return domain.domain; }).join(", ");
      this.resultsPanel.appendChild(
        el("p", "assessment-limitation-note", "Not yet attempted: " + names + ".")
      );
    }

    // ---- confidence calibration ----
    var calibrationCounts = {};
    scoreResult.details.forEach(function tally(detail) {
      calibrationCounts[detail.confidenceClass] = (calibrationCounts[detail.confidenceClass] || 0) + 1;
    });
    var calibrationKeys = Object.keys(CONFIDENCE_DISPLAY).filter(function hasCount(key) {
      return calibrationCounts[key] > 0;
    });
    if (calibrationKeys.length) {
      this.resultsPanel.appendChild(el("h3", "", "How well-calibrated is your confidence?"));
      var calibrationRow = el("div", "assessment-calibration-row");
      calibrationKeys.forEach(function addTile(key) {
        var display = CONFIDENCE_DISPLAY[key];
        var tile = el("div", "assessment-calibration-tile status-" + display.status);
        tile.appendChild(el("span", "assessment-calibration-icon", statusIcon(display.status)));
        tile.appendChild(el("strong", "assessment-calibration-count", String(calibrationCounts[key])));
        tile.appendChild(el("span", "assessment-calibration-label", display.label));
        tile.appendChild(el("span", "assessment-calibration-hint", display.hint));
        calibrationRow.appendChild(tile);
      });
      this.resultsPanel.appendChild(calibrationRow);
    }

    // ---- study actions ----
    if (result.studyActions.length) {
      this.resultsPanel.appendChild(el("h3", "", "What to do next"));
      var actionsList = document.createElement("ol");
      actionsList.className = "assessment-actions-list";
      result.studyActions.forEach(function addAction(action) {
        actionsList.appendChild(el("li", "", action.text));
      });
      this.resultsPanel.appendChild(actionsList);
    }

    // ---- comparison ----
    if (result.comparison) {
      var comparison = result.comparison;
      var deltaText = (comparison.correctDelta >= 0 ? "+" : "") + comparison.correctDelta;
      this.resultsPanel.appendChild(
        el(
          "p",
          "assessment-comparison-note",
          "Compared with your last completed attempt: " + deltaText + " correct (" +
            (comparison.accuracyDelta >= 0 ? "+" : "") + comparison.accuracyDelta + " percentage points accuracy)."
        )
      );
    }

    this.renderCta(band, certName);

    var actionsRow = el("div", "assessment-results-actions");
    var reviewButton = el("button", "button button-secondary", "Review all answers");
    reviewButton.type = "button";
    reviewButton.addEventListener("click", function () {
      self.renderReview("all");
      scrollToElement(self.reviewHost);
    });
    actionsRow.appendChild(reviewButton);

    var printButton = el("button", "button button-text", "Print this report");
    printButton.type = "button";
    printButton.addEventListener("click", function () {
      window.print();
    });
    actionsRow.appendChild(printButton);

    var retakeButton = el("button", "button button-text", "Retake assessment");
    retakeButton.type = "button";
    retakeButton.addEventListener("click", function () {
      window.location.reload();
    });
    actionsRow.appendChild(retakeButton);
    this.resultsPanel.appendChild(actionsRow);

    this.reviewHost = el("div", "assessment-review-host");
    this.resultsPanel.appendChild(this.reviewHost);

    this.announce(
      band.label + ". Accuracy " + scoreResult.accuracyPercentage + " percent on " + scoreResult.attempted + " attempted questions."
    );
    scrollToElement(this.resultsPanel);
  };

  function statusKeyForBand(bandKey) {
    return bandKey === "ready" ? "good" : bandKey === "momentum" ? "warning" : bandKey === "developing" ? "serious" : "critical";
  }

  function statusIcon(statusKey) {
    return { good: "✓", warning: "◐", critical: "✕", serious: "△", muted: "–" }[statusKey] || "•";
  }

  AssessmentRunner.prototype.renderCta = function renderCta(band, certName) {
    var offer = this.payload.offer || {};
    var cta = scoring.resolveCta(offer, Date.now());
    var wrapper = el("div", "assessment-cta");
    var framing = (band.ctaFramingByKind && cta.kind && band.ctaFramingByKind[cta.kind]) || band.narrative;

    wrapper.appendChild(el("p", "assessment-cta-eyebrow", "Your natural next step"));
    wrapper.appendChild(el("h3", "assessment-cta-heading", band.ctaLabel));
    wrapper.appendChild(el("p", "assessment-cta-body", framing));

    if (cta.available) {
      var link = document.createElement("a");
      link.className = "button button-primary assessment-cta-button";
      link.href = cta.url;
      link.target = "_blank";
      link.rel = cta.kind === "coupon" ? "sponsored noopener" : "noopener";
      link.textContent =
        cta.kind === "coupon"
          ? "Claim Today's Offer & Start Full Practice" + domUtils.priceSuffix(offer) + " ↗"
          : "Start Full Practice on Udemy ↗";
      wrapper.appendChild(link);

      var referralUrl = offer.instructorReferralUrl;
      if (cta.kind === "coupon" && referralUrl && referralUrl !== cta.url) {
        var referralLink = document.createElement("a");
        referralLink.className = "button button-text assessment-cta-secondary";
        referralLink.href = referralUrl;
        referralLink.target = "_blank";
        referralLink.rel = "noopener";
        referralLink.textContent = "Prefer to skip the free-seat cap? Enroll directly ↗";
        wrapper.appendChild(referralLink);
      }
    } else {
      wrapper.appendChild(
        el("p", "assessment-cta-missing", "A verified course link isn't configured for this assessment yet.")
      );
    }

    var mainSiteUrl = this.payload.mainSiteUrl;
    if (mainSiteUrl) {
      var secondary = document.createElement("a");
      secondary.className = "button button-text assessment-cta-secondary";
      secondary.href = mainSiteUrl;
      secondary.target = "_blank";
      secondary.rel = "noopener";
      secondary.textContent = "See full details on CertShield ↗";
      wrapper.appendChild(secondary);
    }

    this.resultsPanel.appendChild(wrapper);
  };

  // ----------------------------------------------------------------- review

  var REVIEW_EXPLANATION_PROMPTS = {
    correct: "Show full explanation",
    incorrect: "Show full explanation — see where this went wrong",
    unanswered: "Show full explanation — see what you missed"
  };

  /**
   * The review screen holds all 30 questions' full 10-section explanations
   * at once, which made it a very long, one-directional scroll with no way
   * back to the results/CTA short of scrolling all the way up. Two fixes,
   * both reusing patterns already proven elsewhere on this site: each
   * question's explanation collapses behind a <details class="disclosure">
   * (same component as the homepage/directory "coming soon" sections) so
   * the default view is a short, scannable list of just stem + your/correct
   * answer + state; and a sticky toolbar (filters + a live count + a "back
   * to results" exit) stays reachable at any scroll depth, positioned just
   * below the site's own sticky header.
   */
  AssessmentRunner.prototype.renderReview = function renderReview(filterKey) {
    var self = this;
    var scoreResult = this.lastResult.scoreResult;
    this.reviewHost.innerHTML = "";

    var toolbar = el("div", "assessment-review-toolbar");
    var toolbarTop = el("div", "assessment-review-toolbar-row");
    var backButton = el("button", "assessment-review-back", "↑ Back to results");
    backButton.type = "button";
    backButton.addEventListener("click", function () {
      scrollToElement(self.resultsPanel, { instant: true });
    });
    toolbarTop.appendChild(backButton);
    var countText = el("p", "assessment-review-count");
    countText.setAttribute("aria-live", "polite");
    toolbarTop.appendChild(countText);
    toolbar.appendChild(toolbarTop);

    var filterBar = el("div", "assessment-review-filters");
    [
      ["all", "All"],
      ["incorrect", "Incorrect"],
      ["unanswered", "Unanswered"],
      ["flagged", "Flagged"],
      ["high_confidence_incorrect", "High-confidence incorrect"],
      ["correct_unsure", "Correct but unsure"]
    ].forEach(function addFilter(pair) {
      var button = el("button", "assessment-review-filter", pair[1]);
      button.type = "button";
      button.setAttribute("aria-pressed", String(pair[0] === filterKey));
      button.addEventListener("click", function () {
        self.renderReview(pair[0]);
      });
      filterBar.appendChild(button);
    });
    toolbar.appendChild(filterBar);
    this.reviewHost.appendChild(toolbar);

    var details = scoreResult.details.filter(function matches(detail) {
      switch (filterKey) {
        case "incorrect":
          return detail.state === "incorrect";
        case "unanswered":
          return detail.state === "unanswered";
        case "flagged":
          return Boolean(self.flags[detail.id]);
        case "high_confidence_incorrect":
          return detail.confidenceClass === "misconception";
        case "correct_unsure":
          return detail.confidenceClass === "fragile";
        default:
          return true;
      }
    });

    countText.textContent = "Showing " + details.length + " of " + scoreResult.details.length + " questions";

    if (!details.length) {
      this.reviewHost.appendChild(el("p", "", "No questions match this filter."));
      return;
    }

    details.forEach(function addReview(detail) {
      var question = self.questions.find(function matchQuestion(candidate) {
        return candidate.id === detail.id;
      });
      if (!question) return;

      var article = el("article", "assessment-review-item is-" + detail.state);
      var heading = el("h4", "", "Question " + detail.questionNumber + " — " + question.domain);
      article.appendChild(heading);
      var stem = el("p", "");
      html(stem, question.stemHtml);
      article.appendChild(stem);

      var yourAnswer = detail.selectedAnswers.length
        ? detail.selectedAnswers.map(function label(id) { return domUtils.labelForOption(question, id); }).join("; ")
        : "Not answered";
      var correctAnswer = detail.correctAnswers
        .map(function label(id) { return domUtils.labelForOption(question, id); })
        .join("; ");

      var yourAnswerLine = el("p", "assessment-review-answer is-" + detail.state);
      yourAnswerLine.appendChild(el("span", "assessment-review-answer-label", "Your answer:"));
      yourAnswerLine.appendChild(document.createTextNode(" " + yourAnswer));
      article.appendChild(yourAnswerLine);

      var correctAnswerLine = el("p", "assessment-review-answer is-correct");
      correctAnswerLine.appendChild(el("span", "assessment-review-answer-label", "Correct answer:"));
      correctAnswerLine.appendChild(document.createTextNode(" " + correctAnswer));
      article.appendChild(correctAnswerLine);
      article.appendChild(
        el("p", "assessment-review-state", detail.state + " · confidence: " + detail.confidenceClass)
      );

      var explanationDetails = el("details", "disclosure assessment-review-explanation");
      var summary = el("summary");
      summary.appendChild(el("span", "", REVIEW_EXPLANATION_PROMPTS[detail.state] || REVIEW_EXPLANATION_PROMPTS.correct));
      explanationDetails.appendChild(summary);
      var explanationBody = el("div", "disclosure-grid");
      explanationDetails.appendChild(explanationBody);
      domUtils.appendExplanationSections(explanationBody, question);
      article.appendChild(explanationDetails);

      self.reviewHost.appendChild(article);
    });
  };

  // Does not self-initialize: assets/js/ui/assessment-mode-select.js is the
  // single entry point that instantiates this once the learner picks
  // Diagnostic Mode, so both runners can share one mode-choice screen.
  window.CertShieldAssessmentRunner = { AssessmentRunner: AssessmentRunner };
}());
