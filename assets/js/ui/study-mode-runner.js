/**
 * CertShield Study Mode runner UI — attempt-then-reveal learning.
 *
 * Distinct from Diagnostic Mode (assessment-runner.js) by design: no timer,
 * no confidence capture, no readiness band. Selecting a complete answer
 * immediately locks the question and reveals correct/incorrect state plus
 * the full explanation, so the "testing effect" (attempt before you see the
 * answer) is preserved while the experience stays low-friction. The
 * learner can stop and see their session summary at any point — same
 * "never gate on completion" philosophy as Diagnostic Mode, translated to
 * a learning context.
 *
 * Instantiated on demand by assessment-mode-select.js once the learner
 * picks Study Mode. DOM contract, payload shape and safety rules are the
 * same as assessment-runner.js. Depends on window.CertShieldAssessmentScoring
 * and window.CertShieldDomUtils.
 */
(function () {
  "use strict";

  var scoring = window.CertShieldAssessmentScoring;
  var domUtils = window.CertShieldDomUtils;
  if (!scoring || !domUtils) return;

  var el = domUtils.el;
  var html = domUtils.html;
  var scrollToElement = domUtils.scrollToElement;
  var safeStorage = domUtils.safeStorage;
  var appendExplanationSections = domUtils.appendExplanationSections;
  var labelForOption = domUtils.labelForOption;

  var STORAGE_PREFIX = "certshield.study.v1.";
  var FLAG_ICON_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="1" width="1.6" height="14" rx="0.4"></rect>' +
    '<path d="M4.6 2h8.4l-2.6 3 2.6 3H4.6z"></path>' +
    "</svg>";

  /**
   * A concrete price reduces CTA friction more than a vague "claim offer"
   * label. Only shown for genuinely priced offer types (never "0", which
   * would misrepresent a fully-free coupon as a paid one) and formatted as
   * "<amount> <ISO currency code>" -- no assumed symbol -- matching the
   * source-market framing already used on the Offers page
   * (render_site.py's offer-card renderer), since a hardcoded currency
   * symbol could misstate the learner's actual local price.
   */
  function priceSuffix(offer) {
    var offerType = offer.offerType || "";
    var price = String(offer.discountPrice || "").trim();
    var currency = String(offer.currency || "").trim();
    var showsPrice = (offerType === "best_price" || offerType === "custom_price") && price && price !== "0";
    return showsPrice ? " — " + price + " " + currency : "";
  }

  function StudyModeRunner(root) {
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

    this.answers = Object.create(null); // questionId -> selected option ids
    this.revealed = Object.create(null); // questionId -> true once locked+revealed
    this.flags = Object.create(null);
    this.currentIndex = 0;
    this.streak = 0;
    this.questionsSinceLastNudge = 0;
    this.finished = false;

    this.buildShell();
    this.renderIntro();
  }

  StudyModeRunner.prototype.buildShell = function buildShell() {
    this.root.innerHTML = "";
    this.introPanel = el("div", "study-intro");
    this.runnerPanel = el("div", "assessment-runner-panel");
    this.runnerPanel.hidden = true;
    this.summaryPanel = el("div", "assessment-results-panel");
    this.summaryPanel.hidden = true;
    this.liveRegion = el("div", "");
    this.liveRegion.setAttribute("aria-live", "polite");
    this.liveRegion.setAttribute("aria-atomic", "true");
    this.liveRegion.style.position = "absolute";
    this.liveRegion.style.width = "1px";
    this.liveRegion.style.height = "1px";
    this.liveRegion.style.overflow = "hidden";
    this.liveRegion.style.clip = "rect(0,0,0,0)";
    this.root.appendChild(this.introPanel);
    this.root.appendChild(this.runnerPanel);
    this.root.appendChild(this.summaryPanel);
    this.root.appendChild(this.liveRegion);
  };

  StudyModeRunner.prototype.announce = function announce(message) {
    var region = this.liveRegion;
    region.textContent = "";
    window.setTimeout(function () {
      region.textContent = message;
    }, 0);
  };

  StudyModeRunner.prototype.readSaved = function readSaved() {
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

  StudyModeRunner.prototype.save = function save() {
    if (!this.storage || this.finished) return;
    var payload = {
      contentVersion: this.contentVersion,
      currentIndex: this.currentIndex,
      answers: this.answers,
      revealed: this.revealed,
      flags: this.flags,
      streak: this.streak,
      questionsSinceLastNudge: this.questionsSinceLastNudge
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(payload));
    } catch (error) {
      /* in-memory session still works even if persistence fails */
    }
  };

  StudyModeRunner.prototype.clearSaved = function clearSaved() {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.storageKey);
    } catch (error) {
      /* ignore */
    }
  };

  // ------------------------------------------------------------------ intro

  StudyModeRunner.prototype.renderIntro = function renderIntro() {
    var self = this;
    var meta = this.payload.meta || {};
    this.introPanel.innerHTML = "";
    this.introPanel.hidden = false;
    this.runnerPanel.hidden = true;
    this.summaryPanel.hidden = true;

    var summary = el("div", "assessment-summary-grid");
    [
      ["Questions", String(this.questions.length)],
      ["How it works", "Answer, then see the explanation instantly"],
      ["Pace", "Entirely self-paced — no timer"],
      ["Domains", (meta.domains || []).length + " domains"]
    ].forEach(function addStat(pair) {
      var tile = el("div", "assessment-stat");
      tile.appendChild(el("span", "", pair[0]));
      tile.appendChild(el("strong", "", pair[1]));
      summary.appendChild(tile);
    });
    this.introPanel.appendChild(summary);

    this.introPanel.appendChild(
      el(
        "p",
        "assessment-limitation-note",
        "This is a learning mode, not a test — there's no readiness score here. Switch back to the diagnostic when you want an honest readiness signal."
      )
    );

    var saved = this.readSaved();
    var actions = el("div", "assessment-landing-actions");
    if (saved) {
      var resumeButton = el("button", "button button-primary", "Resume studying");
      resumeButton.type = "button";
      resumeButton.addEventListener("click", function () {
        self.restore(saved);
        self.start();
      });
      actions.appendChild(resumeButton);

      var restartButton = el("button", "button button-secondary", "Start over");
      restartButton.type = "button";
      restartButton.addEventListener("click", function () {
        self.clearSaved();
        self.start();
      });
      actions.appendChild(restartButton);
    } else {
      var startButton = el("button", "button button-primary", "Begin Studying");
      startButton.type = "button";
      startButton.addEventListener("click", function () {
        self.start();
      });
      actions.appendChild(startButton);
    }
    this.introPanel.appendChild(actions);
  };

  StudyModeRunner.prototype.restore = function restore(saved) {
    this.currentIndex = Number(saved.currentIndex) || 0;
    this.answers = saved.answers || Object.create(null);
    this.revealed = saved.revealed || Object.create(null);
    this.flags = saved.flags || Object.create(null);
    this.streak = Number(saved.streak) || 0;
    this.questionsSinceLastNudge = Number(saved.questionsSinceLastNudge) || 0;
  };

  // ----------------------------------------------------------------- runner

  StudyModeRunner.prototype.start = function start() {
    this.introPanel.hidden = true;
    this.runnerPanel.hidden = false;
    this.buildRunnerChrome();
    this.renderQuestion();
    this.save();
    scrollToElement(this.runnerPanel);
  };

  StudyModeRunner.prototype.buildRunnerChrome = function buildRunnerChrome() {
    var self = this;
    this.runnerPanel.innerHTML = "";

    this.progressBar = el("div", "assessment-progress-bar");
    this.progressFill = el("div", "assessment-progress-fill");
    this.progressBar.appendChild(this.progressFill);
    this.runnerPanel.appendChild(this.progressBar);

    var statusRow = el("div", "assessment-status-row");
    this.progressText = el("p", "assessment-progress-text");
    statusRow.appendChild(this.progressText);
    this.scoreText = el("p", "study-running-score");
    statusRow.appendChild(this.scoreText);
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

    this.finishButton = el("button", "button button-primary", "Finish & See Summary");
    this.finishButton.type = "button";
    this.finishButton.addEventListener("click", function () {
      self.finishSession();
    });
    navRow.appendChild(this.finishButton);

    this.runnerPanel.appendChild(navRow);

    var footerRow = el("div", "assessment-nav-row assessment-nav-row-secondary");
    footerRow.appendChild(
      el("p", "assessment-submit-anytime-note", "Stop and see your summary whenever you like — there's no need to finish all 30.")
    );
    this.restartLink = el("button", "button button-text", "Clear progress and start over");
    this.restartLink.type = "button";
    this.restartLink.addEventListener("click", function () {
      if (window.confirm("Clear your current study progress and start over?")) {
        self.clearSaved();
        window.location.reload();
      }
    });
    footerRow.appendChild(this.restartLink);
    this.runnerPanel.appendChild(footerRow);
  };

  StudyModeRunner.prototype.updateScoreText = function updateScoreText() {
    var ids = Object.keys(this.revealed);
    var correct = 0;
    var self = this;
    ids.forEach(function tally(id) {
      var question = self.questions.find(function match(q) { return q.id === id; });
      if (question && scoring.scoreQuestion(question, self.answers[id]).correct) correct += 1;
    });
    this.scoreText.textContent = ids.length ? correct + " of " + ids.length + " correct so far" : "Answer a question to start your score";
  };

  StudyModeRunner.prototype.toggleFlag = function toggleFlag() {
    var question = this.questions[this.currentIndex];
    this.flags[question.id] = !this.flags[question.id];
    this.updateNavigatorStates();
    this.updateFlagButton();
    this.updateFlaggedJumpControl();
    this.save();
  };

  StudyModeRunner.prototype.updateFlagButton = function updateFlagButton() {
    var question = this.questions[this.currentIndex];
    var flagged = Boolean(this.flags[question.id]);
    this.flagButton.textContent = flagged ? "Unflag this question" : "Flag for review";
    this.flagButton.setAttribute("aria-pressed", String(flagged));
  };

  StudyModeRunner.prototype.flaggedIndexes = function flaggedIndexes() {
    var self = this;
    var indexes = [];
    this.questions.forEach(function collect(question, index) {
      if (self.flags[question.id]) indexes.push(index);
    });
    return indexes;
  };

  StudyModeRunner.prototype.updateFlaggedJumpControl = function updateFlaggedJumpControl() {
    if (!this.flaggedJumpButton) return;
    var count = this.flaggedIndexes().length;
    this.flaggedJumpButton.hidden = count === 0;
    if (count === 0) return;
    var label = this.flaggedJumpButton.querySelector(".assessment-flagged-jump-label");
    if (label) label.textContent = count === 1 ? "1 flagged — jump to it" : count + " flagged — jump to next";
  };

  StudyModeRunner.prototype.jumpToNextFlagged = function jumpToNextFlagged() {
    var indexes = this.flaggedIndexes();
    if (!indexes.length) return;
    var next = indexes.find(function isAfterCurrent(index) { return index > this.currentIndex; }, this);
    this.goTo(typeof next === "number" ? next : indexes[0]);
  };

  StudyModeRunner.prototype.goTo = function goTo(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    this.renderQuestion();
    this.save();
    scrollToElement(this.questionHost);
  };

  StudyModeRunner.prototype.updateNavigatorStates = function updateNavigatorStates() {
    var self = this;
    Array.from(this.navigator.children).forEach(function updateButton(button, index) {
      var question = self.questions[index];
      var isRevealed = Boolean(self.revealed[question.id]);
      var correct = isRevealed && scoring.scoreQuestion(question, self.answers[question.id]).correct;
      var flagged = Boolean(self.flags[question.id]);
      button.classList.toggle("is-current", index === self.currentIndex);
      button.classList.toggle("is-answered", isRevealed && correct);
      button.classList.toggle("is-incorrect", isRevealed && !correct);
      button.classList.toggle("is-flagged", flagged);
      button.setAttribute(
        "aria-label",
        "Question " + (index + 1) +
          (isRevealed ? (correct ? ", answered correctly" : ", answered incorrectly") : ", not yet answered") +
          (flagged ? ", flagged" : "")
      );
    });
  };

  // -------------------------------------------------------------- question

  StudyModeRunner.prototype.renderQuestion = function renderQuestion() {
    var self = this;
    var question = this.questions[this.currentIndex];
    this.questionHost.innerHTML = "";

    var card = el("div", "assessment-question-card");
    var article = el("fieldset", "assessment-question");
    var legend = document.createElement("legend");
    html(legend, question.stemHtml);
    article.appendChild(legend);

    if (question.cardinalityInstruction) {
      article.appendChild(el("p", "assessment-cardinality", question.cardinalityInstruction));
    }

    var isRevealed = Boolean(this.revealed[question.id]);
    var inputType = question.selectionMode === "multiple" ? "checkbox" : "radio";
    var selected = this.answers[question.id] || [];
    var correctSet = question.correctAnswers || [];

    question.options.forEach(function addOption(option) {
      var label = el("label", "assessment-option");
      var isPicked = selected.indexOf(option.id) !== -1;
      var isCorrectOption = correctSet.indexOf(option.id) !== -1;
      if (isRevealed) {
        if (isCorrectOption) label.classList.add("is-correct-reveal");
        else if (isPicked) label.classList.add("is-incorrect-reveal");
      }
      var input = document.createElement("input");
      input.type = inputType;
      input.name = "study-question-" + question.id;
      input.value = option.id;
      input.checked = isPicked;
      input.disabled = isRevealed;
      if (!isRevealed) {
        input.addEventListener("change", function () {
          self.handleOptionChange(question, inputType);
        });
      }
      label.appendChild(input);
      var text = el("span", "");
      html(text, option.textHtml);
      label.appendChild(text);
      if (isRevealed && (isCorrectOption || isPicked)) {
        label.appendChild(el("span", "study-option-tag", isCorrectOption ? "Correct" : "Your answer"));
      }
      article.appendChild(label);
    });

    card.appendChild(article);
    this.questionHost.appendChild(card);

    if (isRevealed) {
      this.renderRevealPanel(question);
    }

    this.progressText.textContent = "Question " + (this.currentIndex + 1) + " of " + this.questions.length;
    this.prevButton.hidden = this.currentIndex === 0;
    this.updateFlagButton();
    this.updateNavigatorStates();
    this.updateFlaggedJumpControl();
    this.updateScoreText();
    if (this.progressFill) {
      this.progressFill.style.width = ((this.currentIndex + 1) / this.questions.length) * 100 + "%";
    }
    this.announce(this.progressText.textContent + (isRevealed ? ", already answered" : ""));
  };

  StudyModeRunner.prototype.handleOptionChange = function handleOptionChange(question, inputType) {
    var inputs = Array.from(this.questionHost.querySelectorAll('input[name="study-question-' + question.id + '"]'));
    var checked = inputs.filter(function isChecked(input) { return input.checked; });
    if (inputType === "checkbox" && checked.length > question.requiredSelections) {
      inputs.forEach(function uncheckExtra(input) {
        if (input === checked[checked.length - 1]) input.checked = false;
      });
      this.announce("Choose exactly " + question.requiredSelections + " answers for this question.");
      checked = inputs.filter(function isChecked(input) { return input.checked; });
    }
    var selectedIds = checked.map(function value(input) { return input.value; });
    this.answers[question.id] = selectedIds;

    if (selectedIds.length === question.requiredSelections) {
      this.reveal(question);
    }
  };

  /** The core attempt-then-reveal moment: lock the question, show the
   * result, update the running score/streak, and — if the moment is
   * right — surface one contextual conversion nudge. */
  StudyModeRunner.prototype.reveal = function reveal(question) {
    this.revealed[question.id] = true;
    var result = scoring.scoreQuestion(question, this.answers[question.id]);
    this.streak = result.correct ? this.streak + 1 : 0;
    this.questionsSinceLastNudge += 1;
    this.save();
    this.renderQuestion();

    var nudge = scoring.selectStudyNudge({
      questionsAnswered: Object.keys(this.revealed).length,
      totalQuestions: this.questions.length,
      questionsSinceLastNudge: this.questionsSinceLastNudge,
      lastState: result.state,
      streak: this.streak,
      offer: this.payload.offer
    });
    if (nudge) {
      this.questionsSinceLastNudge = 0;
      this.save();
      this.renderNudge(nudge);
    }

    this.announce(result.correct ? "Correct." : "Not quite — see the explanation below.");
  };

  StudyModeRunner.prototype.renderRevealPanel = function renderRevealPanel(question) {
    var result = scoring.scoreQuestion(question, this.answers[question.id]);
    var panel = el("div", "study-explanation-panel is-" + result.state);
    panel.appendChild(
      el("p", "study-explanation-state", result.correct ? "Correct" : "Not quite — here's why")
    );
    if (!result.correct) {
      var correctLabel = result.correctAnswers.map(function label(id) { return labelForOption(question, id); }).join("; ");
      panel.appendChild(el("p", "", "Correct answer: " + correctLabel));
    }
    appendExplanationSections(panel, question);
    this.questionHost.appendChild(panel);
  };

  StudyModeRunner.prototype.renderNudge = function renderNudge(nudge) {
    var existing = this.questionHost.querySelector(".study-nudge-card");
    if (existing) existing.remove();

    var offer = this.payload.offer || {};
    var cta = scoring.resolveCta(offer, Date.now());
    var card = el("div", "study-nudge-card");
    card.appendChild(el("p", "study-nudge-headline", nudge.headline));
    card.appendChild(el("p", "study-nudge-body", nudge.body));
    if (cta.available) {
      var link = document.createElement("a");
      link.className = "button button-secondary study-nudge-cta";
      link.href = cta.url;
      link.target = "_blank";
      link.rel = cta.kind === "coupon" ? "sponsored noopener" : "noopener";
      link.textContent = cta.kind === "coupon" ? "See Today's Offer ↗" : "See the Full Course ↗";
      card.appendChild(link);
    }
    var dismiss = el("button", "study-nudge-dismiss", "Dismiss");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss this suggestion");
    dismiss.addEventListener("click", function () {
      card.remove();
    });
    card.appendChild(dismiss);
    this.questionHost.appendChild(card);
  };

  // ---------------------------------------------------------------- finish

  StudyModeRunner.prototype.finishSession = function finishSession() {
    this.finished = true;
    var answeredIds = Object.keys(this.revealed);
    var scoreResult = scoring.scoreAssessment(
      this.questions.filter(function wasRevealed(q) { return answeredIds.indexOf(q.id) !== -1; }),
      this.answers,
      {}
    );
    var summary = scoring.summarizeStudySession(scoreResult);
    var rankedResult = scoring.rankDomainsForReview(scoreResult);

    this.clearSaved();
    this.runnerPanel.hidden = true;
    this.renderSummary(summary, rankedResult);
  };

  StudyModeRunner.prototype.renderSummary = function renderSummary(summary, rankedResult) {
    var meta = this.payload.meta || {};
    var copy = scoring.STUDY_CTA_COPY[summary.ctaFraming];

    this.summaryPanel.innerHTML = "";
    this.summaryPanel.hidden = false;

    var hero = el("div", "assessment-results-hero");
    hero.appendChild(el("p", "assessment-results-eyebrow", "Your study session"));
    hero.appendChild(
      el(
        "h2",
        "assessment-results-headline",
        summary.attempted === 0 ? "Ready when you are." : summary.correct + " of " + summary.attempted + " correct"
      )
    );
    hero.appendChild(
      el(
        "p",
        "assessment-results-narrative",
        summary.attempted === 0
          ? "You didn't answer any questions this session — jump back in whenever you're ready."
          : "You explored " + summary.attempted + " of " + summary.total + " questions (" + summary.coveragePercentage + "% coverage) at " +
            summary.accuracyPercentage + "% accuracy."
      )
    );
    this.summaryPanel.appendChild(hero);

    if (rankedResult.ranked.length) {
      this.summaryPanel.appendChild(el("h3", "", "Where you focused"));
      var table = document.createElement("table");
      table.className = "assessment-domain-table";
      var head = document.createElement("thead");
      var headRow = document.createElement("tr");
      ["Domain", "Correct / Attempted", "Accuracy"].forEach(function addHeader(label) {
        var th = document.createElement("th");
        th.scope = "col";
        th.textContent = label;
        headRow.appendChild(th);
      });
      head.appendChild(headRow);
      table.appendChild(head);
      var body = document.createElement("tbody");
      rankedResult.ranked.forEach(function addRow(domain) {
        var row = document.createElement("tr");
        var th = document.createElement("th");
        th.scope = "row";
        th.textContent = domain.domain;
        row.appendChild(th);
        [domain.correct + " / " + domain.attempted, domain.percentage + "%"].forEach(function addCell(value) {
          var td = document.createElement("td");
          td.textContent = value;
          row.appendChild(td);
        });
        body.appendChild(row);
      });
      table.appendChild(body);
      var tableScroll = el("div", "assessment-table-scroll");
      tableScroll.appendChild(table);
      this.summaryPanel.appendChild(tableScroll);
    }

    this.renderSummaryCta(copy, meta);

    var actionsRow = el("div", "assessment-results-actions");
    var continueButton = el("button", "button button-secondary", "Keep studying");
    continueButton.type = "button";
    continueButton.addEventListener("click", function () {
      window.location.reload();
    });
    actionsRow.appendChild(continueButton);
    this.summaryPanel.appendChild(actionsRow);

    scrollToElement(this.summaryPanel);
  };

  /** The richest, highest-intent CTA moment: primary is whichever URL
   * resolveCta picks (coupon while genuinely active, else the referral),
   * with the referral surfaced as a clearly-framed secondary option
   * whenever a coupon is primary and a distinct referral URL exists —
   * "skip the free-seat cap, start immediately" is a real, honest reason
   * for a learner to prefer it, not a revenue pitch. */
  StudyModeRunner.prototype.renderSummaryCta = function renderSummaryCta(copy, meta) {
    var offer = this.payload.offer || {};
    var cta = scoring.resolveCta(offer, Date.now());
    var wrapper = el("div", "assessment-cta");
    wrapper.appendChild(el("p", "assessment-cta-eyebrow", "Your natural next step"));
    wrapper.appendChild(el("h3", "assessment-cta-heading", copy.heading));
    wrapper.appendChild(el("p", "assessment-cta-body", copy.body));

    if (cta.available) {
      var link = document.createElement("a");
      link.className = "button button-primary assessment-cta-button";
      link.href = cta.url;
      link.target = "_blank";
      link.rel = cta.kind === "coupon" ? "sponsored noopener" : "noopener";
      link.textContent =
        cta.kind === "coupon" ? "Claim Today's Offer" + priceSuffix(offer) + " ↗" : "Start Full Practice on Udemy ↗";
      wrapper.appendChild(link);

      var referralUrl = offer.instructorReferralUrl;
      if (cta.kind === "coupon" && referralUrl && referralUrl !== cta.url) {
        var secondary = document.createElement("a");
        secondary.className = "button button-text assessment-cta-secondary";
        secondary.href = referralUrl;
        secondary.target = "_blank";
        secondary.rel = "noopener";
        secondary.textContent = "Prefer to skip the free-seat cap? Enroll directly ↗";
        wrapper.appendChild(secondary);
      }
    } else {
      wrapper.appendChild(el("p", "assessment-cta-missing", "A verified course link isn't configured for this assessment yet."));
    }

    var mainSiteUrl = this.payload.mainSiteUrl;
    if (mainSiteUrl) {
      var details = document.createElement("a");
      details.className = "button button-text assessment-cta-secondary";
      details.href = mainSiteUrl;
      details.target = "_blank";
      details.rel = "noopener";
      details.textContent = "See full details on CertShield ↗";
      wrapper.appendChild(details);
    }

    this.summaryPanel.appendChild(wrapper);
  };

  window.CertShieldStudyModeRunner = { StudyModeRunner: StudyModeRunner };
}());
