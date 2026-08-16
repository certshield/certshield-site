/**
 * CertShield diagnostic-assessment runner UI.
 *
 * DOM contract
 * ------------
 * Root: [data-assessment-runner] containing a JSON payload script:
 *   <script type="application/json" data-assessment-payload>{...}</script>
 *
 * Payload shape: { slug, contentVersion, courseId, offer, meta, questions[] }
 * (see scripts/render_site.py `build_assessment_payload` for the exact
 * shape). Only the pre-sanitized *Html fields produced at build time by
 * scripts/import/markdown_assessment.py are ever set via innerHTML; every
 * other value is set via textContent. No network requests are made and no
 * question, answer, confidence or personal data ever leaves the browser.
 *
 * Depends on window.CertShieldAssessmentScoring (assets/js/core/assessment-scoring.js).
 */
(function () {
  "use strict";

  var scoring = window.CertShieldAssessmentScoring;
  if (!scoring) return;

  var STORAGE_PREFIX = "certshield.assessment.v1.";
  var HISTORY_PREFIX = "certshield.assessment.history.v1.";
  var MAX_HISTORY = 3;
  var CONFIDENCE_OPTIONS = ["sure", "unsure", "guessing"];
  var CONFIDENCE_LABELS = { sure: "Sure", unsure: "Unsure", guessing: "Guessing" };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text !== "undefined") node.textContent = text;
    return node;
  }

  function html(node, htmlString) {
    node.innerHTML = htmlString || "";
    return node;
  }

  function formatClock(totalSeconds) {
    var seconds = Math.max(0, Math.round(totalSeconds));
    var minutes = Math.floor(seconds / 60);
    var remainder = seconds % 60;
    return String(minutes) + ":" + (remainder < 10 ? "0" : "") + String(remainder);
  }

  function parseDurationMinutes(text) {
    var match = /(\d+)\s*minute/i.exec(text || "");
    return match ? Number(match[1]) : 60;
  }

  function safeStorage() {
    try {
      var testKey = "__certshield_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch (error) {
      return null;
    }
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
      "This 30-question diagnostic estimates readiness; it is not an official score or pass prediction. Domains with fewer than three questions carry limited evidence."
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
  };

  AssessmentRunner.prototype.buildRunnerChrome = function buildRunnerChrome() {
    var self = this;
    this.runnerPanel.innerHTML = "";

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

    this.questionHost = el("div", "assessment-question-host");
    this.runnerPanel.appendChild(this.questionHost);

    this.validationPanel = el("div", "assessment-validation");
    this.validationPanel.hidden = true;
    this.validationPanel.setAttribute("role", "alert");
    this.runnerPanel.appendChild(this.validationPanel);

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

    this.submitButton = el("button", "button button-primary", "Submit Assessment");
    this.submitButton.type = "button";
    this.submitButton.addEventListener("click", function () {
      self.requestSubmit(false);
    });
    navRow.appendChild(this.submitButton);

    this.restartLink = el("button", "button button-text", "Clear progress and start over");
    this.restartLink.type = "button";
    this.restartLink.addEventListener("click", function () {
      if (window.confirm("Clear your current progress and start over?")) {
        self.clearSavedAttempt();
        window.location.reload();
      }
    });
    navRow.appendChild(this.restartLink);

    this.runnerPanel.appendChild(navRow);
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
        self.requestSubmit(true);
      }
    }, 1000);
  };

  AssessmentRunner.prototype.updateTimerText = function updateTimerText() {
    if (!this.timerText) return;
    this.timerText.textContent = "Time remaining: " + formatClock(this.remainingSeconds);
  };

  AssessmentRunner.prototype.toggleFlag = function toggleFlag() {
    var question = this.questions[this.currentIndex];
    this.flags[question.id] = !this.flags[question.id];
    this.updateNavigatorStates();
    this.updateFlagButton();
    this.saveAttempt();
  };

  AssessmentRunner.prototype.updateFlagButton = function updateFlagButton() {
    var question = this.questions[this.currentIndex];
    var flagged = Boolean(this.flags[question.id]);
    this.flagButton.textContent = flagged ? "Unflag this question" : "Flag for review";
    this.flagButton.setAttribute("aria-pressed", String(flagged));
  };

  AssessmentRunner.prototype.goTo = function goTo(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    this.renderQuestion();
    this.saveAttempt();
  };

  AssessmentRunner.prototype.renderQuestion = function renderQuestion() {
    var self = this;
    var question = this.questions[this.currentIndex];
    this.questionHost.innerHTML = "";

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

    this.questionHost.appendChild(article);

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
    this.submitButton.hidden = this.currentIndex !== this.questions.length - 1;
    this.updateFlagButton();
    this.updateNavigatorStates();
    this.announce(this.progressText.textContent);
  };

  AssessmentRunner.prototype.handleOptionChange = function handleOptionChange(question, inputType) {
    var inputs = Array.from(this.questionHost.querySelectorAll('input[name="question-' + question.id + '"]'));
    var checked = inputs.filter(function isChecked(input) {
      return input.checked;
    });
    if (inputType === "checkbox" && checked.length > question.requiredSelections) {
      inputs.forEach(function uncheckExtra(input, index) {
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
    if (!this.validationPanel.hidden) this.hideValidation();
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

  AssessmentRunner.prototype.hideValidation = function hideValidation() {
    this.validationPanel.hidden = true;
    this.validationPanel.innerHTML = "";
  };

  AssessmentRunner.prototype.requestSubmit = function requestSubmit(force) {
    var self = this;
    var unansweredCount = this.questions.filter(function isUnanswered(question) {
      return (self.answers[question.id] || []).length !== question.requiredSelections;
    }).length;
    var flaggedCount = Object.keys(this.flags).filter(function isFlagged(id) {
      return self.flags[id];
    }).length;

    if (unansweredCount > 0 && !force) {
      this.validationPanel.innerHTML = "";
      this.validationPanel.appendChild(
        el("p", "", "You have " + unansweredCount + " unanswered question" + (unansweredCount === 1 ? "" : "s") +
          (flaggedCount ? " and " + flaggedCount + " flagged question" + (flaggedCount === 1 ? "" : "s") : "") + ".")
      );
      var reviewButton = el("button", "button button-secondary", "Review unanswered");
      reviewButton.type = "button";
      reviewButton.addEventListener("click", function () {
        var index = self.questions.findIndex(function unansweredIndex(question) {
          return (self.answers[question.id] || []).length !== question.requiredSelections;
        });
        if (index !== -1) self.goTo(index);
        self.hideValidation();
      });
      var anywayButton = el("button", "button button-primary", "Submit anyway");
      anywayButton.type = "button";
      anywayButton.addEventListener("click", function () {
        self.requestSubmit(true);
      });
      this.validationPanel.appendChild(reviewButton);
      this.validationPanel.appendChild(anywayButton);
      this.validationPanel.hidden = false;
      return;
    }

    this.completeAttempt();
  };

  AssessmentRunner.prototype.completeAttempt = function completeAttempt() {
    if (this.timerHandle) window.clearInterval(this.timerHandle);
    this.submitted = true;
    var elapsedMs = Date.now() - (this.startedAt || Date.now());
    var scoreResult = scoring.scoreAssessment(this.questions, this.answers, this.confidences);
    var safeguardResult = scoring.applyReadinessSafeguards(scoreResult);
    var rankedDomains = scoring.rankDomainsForReview(scoreResult);
    var studyActions = scoring.computeStudyActions(scoreResult, rankedDomains, safeguardResult);
    var history = this.readHistory();
    var previous = history[0] || null;
    var comparison = scoring.compareToPreviousAttempt(
      { correct: scoreResult.correct, percentage: scoreResult.percentage, bandKey: safeguardResult.finalBand.key },
      previous
    );

    this.lastResult = {
      scoreResult: scoreResult,
      safeguardResult: safeguardResult,
      rankedDomains: rankedDomains,
      studyActions: studyActions,
      comparison: comparison,
      elapsedMs: elapsedMs
    };

    this.pushHistory({
      completedAt: Date.now(),
      correct: scoreResult.correct,
      total: scoreResult.total,
      percentage: scoreResult.percentage,
      bandKey: safeguardResult.finalBand.key,
      contentVersion: this.contentVersion
    });
    this.clearSavedAttempt();

    this.runnerPanel.hidden = true;
    this.renderResults();
  };

  // ---------------------------------------------------------------- results

  AssessmentRunner.prototype.renderResults = function renderResults() {
    var self = this;
    var result = this.lastResult;
    var scoreResult = result.scoreResult;
    var safeguardResult = result.safeguardResult;

    this.resultsPanel.innerHTML = "";
    this.resultsPanel.hidden = false;

    var heading = el("h2", "", safeguardResult.finalBand.label);
    this.resultsPanel.appendChild(heading);

    if (safeguardResult.downgraded) {
      var downgradeNote = el("div", "assessment-safeguard-note");
      downgradeNote.appendChild(
        el("p", "", "Your initial band (" + safeguardResult.initialBand.label + ") was adjusted down by one level because:")
      );
      var list = document.createElement("ul");
      safeguardResult.triggeredSafeguards.forEach(function addSafeguard(item) {
        list.appendChild(el("li", "", item.message));
      });
      downgradeNote.appendChild(list);
      this.resultsPanel.appendChild(downgradeNote);
    }

    var statGrid = el("div", "assessment-summary-grid");
    [
      ["Score", scoreResult.correct + " / " + scoreResult.total],
      ["Percentage", scoreResult.percentage + "%"],
      ["Time taken", formatClock(result.elapsedMs / 1000)],
      ["Unanswered", String(scoreResult.unanswered)]
    ].forEach(function addStat(pair) {
      var tile = el("div", "assessment-stat");
      tile.appendChild(el("span", "", pair[0]));
      tile.appendChild(el("strong", "", pair[1]));
      statGrid.appendChild(tile);
    });
    this.resultsPanel.appendChild(statGrid);
    this.resultsPanel.appendChild(
      el(
        "p",
        "assessment-limitation-note",
        "This raw percentage describes only this 30-question diagnostic. It is not an official psychometric score or pass prediction."
      )
    );

    // domain evidence matrix
    this.resultsPanel.appendChild(el("h3", "", "Domain evidence matrix"));
    var table = document.createElement("table");
    table.className = "assessment-domain-table";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Domain", "Correct / Total", "Attempted", "Unanswered", "Percentage", "Evidence", "Priority"].forEach(function (label) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = document.createElement("tbody");
    result.rankedDomains.forEach(function addRow(domain) {
      var row = document.createElement("tr");
      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = domain.domain;
      row.appendChild(th);
      [
        domain.correct + " / " + domain.total,
        String(domain.attempted),
        String(domain.unanswered),
        domain.percentage + "%",
        domain.evidenceLabel,
        String(domain.priority)
      ].forEach(function addCell(value) {
        var td = document.createElement("td");
        td.textContent = value;
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    this.resultsPanel.appendChild(table);

    // confidence calibration
    var calibrationCounts = { stable: 0, fragile: 0, misconception: 0, gap: 0, guessing: 0, unclassified: 0 };
    scoreResult.details.forEach(function tally(detail) {
      calibrationCounts[detail.confidenceClass] = (calibrationCounts[detail.confidenceClass] || 0) + 1;
    });
    this.resultsPanel.appendChild(el("h3", "", "Confidence calibration"));
    var calibrationList = document.createElement("ul");
    calibrationList.className = "assessment-calibration-list";
    [
      ["stable", "Stable knowledge (correct + sure)"],
      ["fragile", "Fragile knowledge (correct + unsure/guessing)"],
      ["misconception", "Likely misconception (incorrect + sure)"],
      ["gap", "Knowledge gap (incorrect + unsure/guessing)"],
      ["guessing", "Guessing"],
      ["unclassified", "No confidence selected"]
    ].forEach(function addRow(pair) {
      calibrationList.appendChild(el("li", "", pair[1] + ": " + calibrationCounts[pair[0]]));
    });
    this.resultsPanel.appendChild(calibrationList);

    // study actions
    this.resultsPanel.appendChild(el("h3", "", "What to do next"));
    var actionsList = document.createElement("ol");
    result.studyActions.forEach(function addAction(action) {
      actionsList.appendChild(el("li", "", action.text));
    });
    this.resultsPanel.appendChild(actionsList);

    // comparison
    if (result.comparison) {
      var comparison = result.comparison;
      var deltaText = (comparison.correctDelta >= 0 ? "+" : "") + comparison.correctDelta;
      this.resultsPanel.appendChild(
        el(
          "p",
          "assessment-comparison-note",
          "Personal progress vs. your last completed attempt: " + deltaText + " correct (" +
            (comparison.percentageDelta >= 0 ? "+" : "") + comparison.percentageDelta + " percentage points)."
        )
      );
    }

    this.renderCta(safeguardResult.finalBand.key);

    var actionsRow = el("div", "assessment-results-actions");
    var reviewButton = el("button", "button button-primary", "Review all answers");
    reviewButton.type = "button";
    reviewButton.addEventListener("click", function () {
      self.renderReview("all");
    });
    actionsRow.appendChild(reviewButton);

    var printButton = el("button", "button button-secondary", "Print this report");
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

    this.announce("Assessment submitted. Score " + scoreResult.correct + " out of " + scoreResult.total + ".");
  };

  AssessmentRunner.prototype.renderCta = function renderCta(bandKey) {
    var offer = this.payload.offer || {};
    var cta = scoring.resolveCta(offer, Date.now());
    var wrapper = el("div", "assessment-cta");
    wrapper.appendChild(el("h3", "", "Continue your preparation"));
    wrapper.appendChild(el("p", "", scoring.ctaGuidanceForBand(bandKey)));

    if (cta.available) {
      var link = document.createElement("a");
      link.className = "button button-primary";
      link.href = cta.url;
      link.target = "_blank";
      link.rel = cta.kind === "coupon" ? "sponsored noopener" : "noopener";
      link.textContent = cta.kind === "coupon" ? "Claim current offer" : "View full-length practice course";
      wrapper.appendChild(link);
      wrapper.appendChild(
        el(
          "p",
          "assessment-cta-disclosure",
          "This links to an instructor-authored Udemy course. Enrollment may generate instructor revenue."
        )
      );
    } else {
      wrapper.appendChild(
        el("p", "assessment-cta-missing", "A verified course link is not yet configured for this assessment.")
      );
    }
    this.resultsPanel.appendChild(wrapper);
  };

  // ----------------------------------------------------------------- review

  AssessmentRunner.prototype.renderReview = function renderReview(filterKey) {
    var self = this;
    var scoreResult = this.lastResult.scoreResult;
    this.reviewHost.innerHTML = "";

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
    this.reviewHost.appendChild(filterBar);

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
        ? detail.selectedAnswers.map(function labelFor(id) {
            var option = question.options.find(function findOption(candidate) {
              return candidate.id === id;
            });
            return option ? option.id + ". " + option.text : id;
          }).join("; ")
        : "Not answered";
      var correctAnswer = detail.correctAnswers.map(function labelFor(id) {
        var option = question.options.find(function findOption(candidate) {
          return candidate.id === id;
        });
        return option ? option.id + ". " + option.text : id;
      }).join("; ");

      article.appendChild(el("p", "", "Your answer: " + yourAnswer));
      article.appendChild(el("p", "", "Correct answer: " + correctAnswer));
      article.appendChild(
        el("p", "assessment-review-state", detail.state + " · confidence: " + detail.confidenceClass)
      );

      var sectionOrder = [
        ["examReasoningExplanation", "Exam Reasoning Explanation"],
        ["keyExamClues", "Key Exam Clues"],
        ["whyThisIsCorrect", "Why This Is Correct"],
        ["whyOtherOptionsAreNotBestFit", "Why the Other Options Are Not the Best Fit"],
        ["examTrap", "Exam Trap"],
        ["foundationConcept", "Foundation Concept"],
        ["realWorldConnection", "Real-World Connection"],
        ["memoryHook", "Memory Hook"],
        ["thirtySecondTakeaway", "30-Second Exam Takeaway"]
      ];
      sectionOrder.forEach(function addSection(pair) {
        var body = question.sections && question.sections[pair[0]];
        if (!body) return;
        article.appendChild(el("h5", "", pair[1]));
        var container = el("div", "");
        html(container, body);
        article.appendChild(container);
      });

      if (question.officialReferences && question.officialReferences.length) {
        article.appendChild(el("h5", "", "Official References"));
        var refList = document.createElement("ul");
        question.officialReferences.forEach(function addRef(reference) {
          var li = document.createElement("li");
          var link = document.createElement("a");
          link.href = reference.url;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = reference.title;
          li.appendChild(link);
          refList.appendChild(li);
        });
        article.appendChild(refList);
      }

      self.reviewHost.appendChild(article);
    });
  };

  function initAll() {
    Array.from(document.querySelectorAll("[data-assessment-runner]")).forEach(function initOne(root) {
      if (root.getAttribute("data-assessment-initialized") === "true") return;
      root.setAttribute("data-assessment-initialized", "true");
      new AssessmentRunner(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  window.CertShieldAssessmentRunner = { AssessmentRunner: AssessmentRunner, initAll: initAll };
}());
