/**
 * CertShield diagnostic-assessment pure scoring/readiness engine.
 *
 * Implements sections 9-11 of the CertShield Modular Diagnostic Assessment
 * Framework master prompt: exact-set MCQ/MSQ scoring, the fixed 30-question
 * readiness bands, confidence calibration, readiness safeguards (at most one
 * downgrade, fully explained), a transparent (non-composite) review ranking,
 * deterministic study actions and revenue-aware CTA routing.
 *
 * Pure functions only — no DOM access, no storage, no network. Exposed as
 * window.CertShieldAssessmentScoring in browsers and module.exports in
 * CommonJS test runners.
 */
(function attachCertShieldAssessmentScoring(globalObject, factory) {
  "use strict";

  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalObject) {
    globalObject.CertShieldAssessmentScoring = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createScoringApi() {
  "use strict";

  var TOTAL_QUESTIONS = 30;

  var READINESS_BANDS = [
    { key: "strong", label: "Strong readiness signal", min: 26, max: 30, rank: 3 },
    { key: "targeted", label: "Targeted refinement needed", min: 21, max: 25, rank: 2 },
    { key: "developing", label: "Developing readiness", min: 17, max: 20, rank: 1 },
    { key: "foundation", label: "Foundation strengthening recommended", min: 0, max: 16, rank: 0 }
  ];

  var CTA_GUIDANCE = {
    strong: "Validate with a full-length timed mock exam.",
    targeted: "Practise weak domains and review explanations before a full simulation.",
    developing: "Use the full-length course in untimed learning mode first.",
    foundation: "Reinforce foundational concepts before treating a mock as exam simulation."
  };

  function toCleanString(value) {
    return value === null || typeof value === "undefined" ? "" : String(value).trim();
  }

  function uniqueStrings(values) {
    var seen = Object.create(null);
    var result = [];
    (values || []).forEach(function addUnique(value) {
      var clean = toCleanString(value);
      if (clean && !seen[clean]) {
        seen[clean] = true;
        result.push(clean);
      }
    });
    return result;
  }

  function normalizeAnswerSet(value) {
    if (value === null || typeof value === "undefined" || value === "") return [];
    if (Array.isArray(value)) return uniqueStrings(value);
    return uniqueStrings([value]);
  }

  function exactSetEqual(left, right) {
    var leftSet = normalizeAnswerSet(left).slice().sort();
    var rightSet = normalizeAnswerSet(right).slice().sort();
    if (leftSet.length !== rightSet.length) return false;
    return leftSet.every(function sameValue(value, index) {
      return value === rightSet[index];
    });
  }

  /** Score one question. Unanswered (wrong selection count) counts as incorrect. */
  function scoreQuestion(question, selectedAnswers) {
    var selected = normalizeAnswerSet(selectedAnswers);
    var correctAnswers = normalizeAnswerSet(question && question.correctAnswers);
    var required = Number(question && question.requiredSelections) || correctAnswers.length || 1;
    var answered = selected.length === required;
    var correct = answered && exactSetEqual(selected, correctAnswers);
    return {
      answered: answered,
      correct: correct,
      state: !answered ? "unanswered" : correct ? "correct" : "incorrect",
      selectedAnswers: selected,
      correctAnswers: correctAnswers
    };
  }

  /** Raw readiness band from a correct count out of exactly 30 questions. */
  function getReadinessBand(correctCount) {
    var count = Number(correctCount) || 0;
    for (var index = 0; index < READINESS_BANDS.length; index += 1) {
      var band = READINESS_BANDS[index];
      if (count >= band.min && count <= band.max) return band;
    }
    return READINESS_BANDS[READINESS_BANDS.length - 1];
  }

  function bandByRank(rank) {
    for (var index = 0; index < READINESS_BANDS.length; index += 1) {
      if (READINESS_BANDS[index].rank === rank) return READINESS_BANDS[index];
    }
    return READINESS_BANDS[READINESS_BANDS.length - 1];
  }

  /** Classify one question's confidence + correctness into the calibration matrix. */
  function classifyConfidence(state, confidence) {
    var clean = toCleanString(confidence).toLowerCase();
    var isSure = clean === "sure";
    var isUnsureOrGuessing = clean === "unsure" || clean === "guessing";

    if (state === "correct" && isSure) return "stable";
    if (state === "correct" && isUnsureOrGuessing) return "fragile";
    if (state === "incorrect" && isSure) return "misconception";
    if (state === "incorrect" && isUnsureOrGuessing) return "gap";
    if (clean === "guessing") return "guessing";
    return "unclassified";
  }

  /** Score a full 30-question attempt: per-question detail + domain matrix. */
  function scoreAssessment(questions, answers, confidences) {
    var safeQuestions = Array.isArray(questions) ? questions : [];
    var details = [];
    var correct = 0;
    var incorrect = 0;
    var unanswered = 0;
    var domainMap = new Map();

    safeQuestions.forEach(function scoreCurrent(question, index) {
      var questionId = toCleanString(question && question.id) || "question-" + (index + 1);
      var selected = answers && (answers[questionId] || answers.get && answers.get(questionId));
      var result = scoreQuestion(question, selected);
      var confidence = toCleanString(
        confidences && (confidences[questionId] || (confidences.get && confidences.get(questionId)))
      );
      var confidenceClass = classifyConfidence(result.state, confidence);
      var domain = toCleanString(question && question.domain) || "General";

      if (result.state === "correct") correct += 1;
      else if (result.state === "incorrect") incorrect += 1;
      else unanswered += 1;

      if (!domainMap.has(domain)) {
        domainMap.set(domain, { domain: domain, total: 0, correct: 0, attempted: 0, unanswered: 0, misconceptionCount: 0 });
      }
      var domainEntry = domainMap.get(domain);
      domainEntry.total += 1;
      if (result.answered) domainEntry.attempted += 1;
      else domainEntry.unanswered += 1;
      if (result.correct) domainEntry.correct += 1;
      if (confidenceClass === "misconception") domainEntry.misconceptionCount += 1;

      details.push({
        id: questionId,
        questionNumber: Number(question && question.questionNumber) || index + 1,
        domain: domain,
        state: result.state,
        answered: result.answered,
        correct: result.correct,
        selectedAnswers: result.selectedAnswers,
        correctAnswers: result.correctAnswers,
        confidence: confidence || "not_selected",
        confidenceClass: confidenceClass
      });
    });

    var domains = Array.from(domainMap.values()).map(function finishDomain(entry) {
      var percentage = entry.total ? Math.round((entry.correct / entry.total) * 100) : 0;
      var evidenceLimited = entry.total < 3;
      return {
        domain: entry.domain,
        total: entry.total,
        correct: entry.correct,
        attempted: entry.attempted,
        unanswered: entry.unanswered,
        percentage: percentage,
        evidenceLabel: evidenceLimited ? "Limited evidence" : "Sufficient evidence",
        evidenceLimited: evidenceLimited,
        misconceptionCount: entry.misconceptionCount
      };
    });

    var total = safeQuestions.length;
    return {
      total: total,
      correct: correct,
      incorrect: incorrect,
      unanswered: unanswered,
      percentage: total ? Math.round((correct / total) * 100) : 0,
      allAnswered: unanswered === 0 && total === TOTAL_QUESTIONS,
      details: details,
      domains: domains
    };
  }

  /**
   * Apply readiness safeguards (section 9). At most one downgrade is ever
   * applied, and every triggered safeguard is reported so the UI can explain
   * exactly why the band changed.
   */
  function applyReadinessSafeguards(scoreResult) {
    var initialBand = getReadinessBand(scoreResult.correct);
    var triggered = [];

    if (initialBand.key === "strong" && !scoreResult.allAnswered) {
      triggered.push({
        key: "incomplete_attempt",
        message: "Strong readiness requires all 30 questions answered."
      });
    }

    var weakDomain = scoreResult.domains.find(function isWeak(domain) {
      return !domain.evidenceLimited && domain.percentage < 50;
    });
    if (weakDomain) {
      triggered.push({
        key: "weak_domain",
        message: "Domain \"" + weakDomain.domain + "\" scored below 50% with sufficient evidence (" +
          weakDomain.correct + "/" + weakDomain.total + ")."
      });
    }

    var sureIncorrectCount = scoreResult.details.filter(function isSureIncorrect(detail) {
      return detail.state === "incorrect" && detail.confidenceClass === "misconception";
    }).length;
    if (sureIncorrectCount >= 3) {
      triggered.push({
        key: "sure_incorrect",
        message: sureIncorrectCount + " questions were answered incorrectly with \"Sure\" confidence, suggesting a likely misconception."
      });
    }

    var downgraded = triggered.length > 0 && initialBand.rank > 0;
    var finalBand = downgraded ? bandByRank(initialBand.rank - 1) : initialBand;

    return {
      initialBand: initialBand,
      finalBand: finalBand,
      downgraded: downgraded,
      triggeredSafeguards: triggered
    };
  }

  /**
   * Transparent review ranking (section 10): sort domains by high-confidence
   * errors, then incorrect rate, then unanswered count, then fragile-correct
   * count, then evidence count. No composite/pseudo-scientific score.
   */
  function rankDomainsForReview(scoreResult) {
    var fragileByDomain = {};
    scoreResult.details.forEach(function tally(detail) {
      if (detail.confidenceClass === "fragile") {
        fragileByDomain[detail.domain] = (fragileByDomain[detail.domain] || 0) + 1;
      }
    });

    return scoreResult.domains.slice().sort(function compare(left, right) {
      var incorrectRateLeft = left.total ? (left.total - left.correct) / left.total : 0;
      var incorrectRateRight = right.total ? (right.total - right.correct) / right.total : 0;
      var fragileLeft = fragileByDomain[left.domain] || 0;
      var fragileRight = fragileByDomain[right.domain] || 0;

      return (
        right.misconceptionCount - left.misconceptionCount ||
        incorrectRateRight - incorrectRateLeft ||
        right.unanswered - left.unanswered ||
        fragileRight - fragileLeft ||
        right.total - left.total ||
        left.domain.localeCompare(right.domain)
      );
    }).map(function withPriority(domain, index) {
      return Object.assign({ priority: index + 1 }, domain);
    });
  }

  /** Three deterministic study actions derived from the actual attempt. */
  function computeStudyActions(scoreResult, rankedDomains, safeguardResult) {
    var actions = [];
    var topDomain = rankedDomains.find(function hasSignal(domain) {
      return domain.total - domain.correct > 0 || domain.unanswered > 0;
    });

    if (topDomain) {
      actions.push({
        key: "review_top_domain",
        text: "Review \"" + topDomain.domain + "\" first — " + (topDomain.total - topDomain.correct) +
          " of " + topDomain.total + " questions were missed or unanswered there."
      });
    } else {
      actions.push({
        key: "maintain_strength",
        text: "Every domain was fully correct in this attempt — revisit official references to reinforce retention."
      });
    }

    var misconceptionCount = scoreResult.details.filter(function isMisconception(detail) {
      return detail.confidenceClass === "misconception";
    }).length;
    if (misconceptionCount > 0) {
      actions.push({
        key: "resolve_misconceptions",
        text: "Revisit the " + misconceptionCount + " question" + (misconceptionCount === 1 ? "" : "s") +
          " you answered incorrectly while marked \"Sure\" — these usually point to a specific misconception, not a knowledge gap."
      });
    } else {
      var gapCount = scoreResult.details.filter(function isGap(detail) {
        return detail.confidenceClass === "gap";
      }).length;
      actions.push({
        key: "close_gaps",
        text: gapCount > 0
          ? "Study the " + gapCount + " question" + (gapCount === 1 ? "" : "s") + " you were unsure about or guessed on."
          : "Retake this assessment after a study session to confirm your readiness band holds."
      });
    }

    if (safeguardResult.finalBand.key === "foundation" || safeguardResult.finalBand.key === "developing") {
      actions.push({
        key: "untimed_first",
        text: "Use untimed practice mode next so you can reason through each question without exam-pace pressure."
      });
    } else {
      actions.push({
        key: "simulate_timed",
        text: "Retake in timed mode to confirm your pacing matches the " + TOTAL_QUESTIONS + "-question exam simulation."
      });
    }

    return actions.slice(0, 3);
  }

  /** Compare the current attempt to the most recent locally-stored completed attempt. */
  function compareToPreviousAttempt(current, previous) {
    if (!previous) return null;
    return {
      previousCorrect: previous.correct,
      previousPercentage: previous.percentage,
      previousBandKey: previous.bandKey,
      correctDelta: current.correct - previous.correct,
      percentageDelta: current.percentage - previous.percentage,
      bandChanged: current.bandKey !== previous.bandKey
    };
  }

  /**
   * Revenue-aware CTA routing (section 11). Never fabricates a link: renders
   * no commercial button when neither a live coupon nor a locked referral
   * exists for the mapped course.
   */
  function resolveCta(offer, nowMs) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    if (!offer || !offer.courseId) {
      return { available: false, reason: "no_course_mapping", url: null };
    }
    var start = offer.startAt ? new Date(offer.startAt).getTime() : NaN;
    var end = offer.endAt ? new Date(offer.endAt).getTime() : NaN;
    var withinCouponWindow =
      offer.couponUrl && Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;

    if (withinCouponWindow) {
      return { available: true, kind: "coupon", url: offer.couponUrl };
    }
    if (offer.instructorReferralUrl) {
      return { available: true, kind: "referral", url: offer.instructorReferralUrl };
    }
    return { available: false, reason: "missing_mapping", url: null };
  }

  function ctaGuidanceForBand(bandKey) {
    return CTA_GUIDANCE[bandKey] || CTA_GUIDANCE.foundation;
  }

  return {
    TOTAL_QUESTIONS: TOTAL_QUESTIONS,
    READINESS_BANDS: READINESS_BANDS,
    normalizeAnswerSet: normalizeAnswerSet,
    exactSetEqual: exactSetEqual,
    scoreQuestion: scoreQuestion,
    scoreAssessment: scoreAssessment,
    getReadinessBand: getReadinessBand,
    classifyConfidence: classifyConfidence,
    applyReadinessSafeguards: applyReadinessSafeguards,
    rankDomainsForReview: rankDomainsForReview,
    computeStudyActions: computeStudyActions,
    compareToPreviousAttempt: compareToPreviousAttempt,
    resolveCta: resolveCta,
    ctaGuidanceForBand: ctaGuidanceForBand
  };
});
