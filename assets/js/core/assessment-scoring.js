/**
 * CertShield diagnostic-assessment pure scoring/readiness engine.
 *
 * Scoring model: the learner can submit at any time. Only questions actually
 * answered are scored — accuracy = correct / attempted, never penalized by
 * questions left unanswered. Coverage (attempted / total) is tracked
 * separately and moderates how confidently a readiness band is claimed: a
 * high accuracy on a handful of questions reads as promising, not "exam
 * ready" — that claim needs real breadth of evidence too.
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

  var READINESS_BANDS = [
    {
      key: "ready",
      rank: 3,
      label: "You're Exam Ready",
      shortLabel: "Exam Ready",
      headline: "Your accuracy shows real command of this material.",
      narrative:
        "This is exactly the kind of readiness signal that means you're prepared to sit the real exam with confidence. Lock it in with full-length, timed practice before exam day.",
      ctaLabel: "Validate With the Full Practice Exam",
      ctaFramingByKind: {
        coupon: "Claim today's offer and simulate the real exam before you sit it.",
        referral: "Simulate the real exam under timed conditions before you sit it."
      }
    },
    {
      key: "momentum",
      rank: 2,
      label: "You're Building Real Momentum",
      shortLabel: "Building Momentum",
      headline: "You're getting most of this right — the fundamentals are there.",
      narrative:
        "A focused pass through your weakest domain and a full-length timed mock will close the gap fast. You're closer than this snapshot might feel.",
      ctaLabel: "Close the Gap With Full Practice",
      ctaFramingByKind: {
        coupon: "Today's offer is the fastest way to turn this into exam-day confidence.",
        referral: "The full practice course drills exactly the domains you need."
      }
    },
    {
      key: "developing",
      rank: 1,
      label: "You're Developing — Right Where Practice Pays Off",
      shortLabel: "Developing",
      headline: "This diagnostic just showed you exactly where to focus.",
      narrative:
        "That's valuable information, not a bad grade. Structured, explanation-led practice is the fastest way to convert this into real readiness.",
      ctaLabel: "Build Your Foundation With Guided Practice",
      ctaFramingByKind: {
        coupon: "Today's offer gives you the full explanation-led course to build from here.",
        referral: "The full course walks through every concept with worked explanations."
      }
    },
    {
      key: "foundation",
      rank: 0,
      label: "Every Expert Started Exactly Here",
      shortLabel: "Foundation Building",
      headline: "You now know precisely which concepts to learn first.",
      narrative:
        "That clarity is worth more than a score. The full practice course is built to take you from here to exam-ready, one concept at a time.",
      ctaLabel: "Start Your Structured Path to Mastery",
      ctaFramingByKind: {
        coupon: "Today's offer unlocks the complete guided course to build real command of this material.",
        referral: "The full course is built to take you from here to exam-ready."
      }
    }
  ];

  var COVERAGE_TIERS = [
    { key: "full", min: 0.8, note: null },
    {
      key: "partial",
      min: 0.5,
      note: "Based on more than half the assessment — answer the rest for a fuller picture."
    },
    {
      key: "limited",
      min: 0,
      note: "Based on a partial attempt — this is an early signal, not a complete readiness picture."
    }
  ];

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

  /** Score one question. A question not fully answered is simply "unanswered" — never wrong. */
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

  /**
   * Score whatever was submitted. Unanswered questions are excluded from
   * accuracy entirely (never treated as incorrect) and tracked separately
   * as coverage. Domain "evidence" is judged by how many of that domain's
   * questions were actually attempted, not the domain's full size.
   */
  function scoreAssessment(questions, answers, confidences) {
    var safeQuestions = Array.isArray(questions) ? questions : [];
    var details = [];
    var correct = 0;
    var incorrect = 0;
    var unanswered = 0;
    var domainMap = new Map();

    safeQuestions.forEach(function scoreCurrent(question, index) {
      var questionId = toCleanString(question && question.id) || "question-" + (index + 1);
      var selected = answers && (answers[questionId] || (answers.get && answers.get(questionId)));
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
        domainMap.set(domain, { domain: domain, total: 0, correct: 0, attempted: 0, misconceptionCount: 0 });
      }
      var domainEntry = domainMap.get(domain);
      domainEntry.total += 1;
      if (result.answered) domainEntry.attempted += 1;
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
      var accuracy = entry.attempted ? entry.correct / entry.attempted : null;
      var evidenceLimited = entry.attempted < 3;
      return {
        domain: entry.domain,
        total: entry.total,
        correct: entry.correct,
        attempted: entry.attempted,
        unanswered: entry.total - entry.attempted,
        accuracy: accuracy,
        percentage: accuracy === null ? null : Math.round(accuracy * 100),
        evidenceLabel: entry.attempted === 0 ? "Not attempted" : evidenceLimited ? "Limited evidence" : "Sufficient evidence",
        evidenceLimited: evidenceLimited,
        misconceptionCount: entry.misconceptionCount
      };
    });

    var total = safeQuestions.length;
    var attempted = correct + incorrect;
    var accuracy = attempted ? correct / attempted : 0;
    var coverage = total ? attempted / total : 0;

    return {
      total: total,
      attempted: attempted,
      correct: correct,
      incorrect: incorrect,
      unanswered: unanswered,
      accuracy: accuracy,
      accuracyPercentage: Math.round(accuracy * 100),
      coverage: coverage,
      coveragePercentage: Math.round(coverage * 100),
      details: details,
      domains: domains
    };
  }

  function bandByKey(key) {
    for (var index = 0; index < READINESS_BANDS.length; index += 1) {
      if (READINESS_BANDS[index].key === key) return READINESS_BANDS[index];
    }
    return READINESS_BANDS[READINESS_BANDS.length - 1];
  }

  function bandByRank(rank) {
    for (var index = 0; index < READINESS_BANDS.length; index += 1) {
      if (READINESS_BANDS[index].rank === rank) return READINESS_BANDS[index];
    }
    return READINESS_BANDS[0];
  }

  function coverageTierFor(coverage) {
    for (var index = 0; index < COVERAGE_TIERS.length; index += 1) {
      if (coverage >= COVERAGE_TIERS[index].min) return COVERAGE_TIERS[index];
    }
    return COVERAGE_TIERS[COVERAGE_TIERS.length - 1];
  }

  /**
   * Readiness band from accuracy, moderated by coverage: a limited-coverage
   * attempt can never claim the top two bands, however high its accuracy —
   * there simply isn't enough evidence yet. Always explains why, in plain
   * language, never a hidden penalty.
   */
  function computeReadinessResult(scoreResult) {
    if (scoreResult.attempted === 0) {
      return {
        band: bandByKey("foundation"),
        capped: false,
        coverageTier: coverageTierFor(0),
        note: "Answer at least one question to get your readiness signal."
      };
    }

    var accuracy = scoreResult.accuracy;
    var rawBand =
      accuracy >= 0.85 ? bandByKey("ready") :
      accuracy >= 0.70 ? bandByKey("momentum") :
      accuracy >= 0.55 ? bandByKey("developing") :
      bandByKey("foundation");

    var coverageTier = coverageTierFor(scoreResult.coverage);
    var finalBand = rawBand;
    var capped = false;

    if (coverageTier.key === "limited" && rawBand.rank > bandByKey("developing").rank) {
      finalBand = bandByKey("developing");
      capped = true;
    }

    return {
      band: finalBand,
      rawBand: rawBand,
      capped: capped,
      coverageTier: coverageTier,
      note: coverageTier.note
    };
  }

  /**
   * Transparent review ranking: domains actually attempted, ranked by
   * high-confidence errors, then accuracy (lowest first), then evidence
   * depth. Domains never attempted are surfaced separately, not ranked
   * alongside real evidence.
   */
  function rankDomainsForReview(scoreResult) {
    var fragileByDomain = {};
    scoreResult.details.forEach(function tally(detail) {
      if (detail.confidenceClass === "fragile") {
        fragileByDomain[detail.domain] = (fragileByDomain[detail.domain] || 0) + 1;
      }
    });

    var attemptedDomains = scoreResult.domains.filter(function hasAttempts(domain) {
      return domain.attempted > 0;
    });
    var unattemptedDomains = scoreResult.domains.filter(function noAttempts(domain) {
      return domain.attempted === 0;
    });

    var ranked = attemptedDomains.slice().sort(function compare(left, right) {
      var missedLeft = left.attempted - left.correct;
      var missedRight = right.attempted - right.correct;
      var fragileLeft = fragileByDomain[left.domain] || 0;
      var fragileRight = fragileByDomain[right.domain] || 0;

      return (
        right.misconceptionCount - left.misconceptionCount ||
        left.accuracy - right.accuracy ||
        missedRight - missedLeft ||
        fragileRight - fragileLeft ||
        right.attempted - left.attempted ||
        left.domain.localeCompare(right.domain)
      );
    }).map(function withPriority(domain, index) {
      return Object.assign({ priority: index + 1 }, domain);
    });

    return { ranked: ranked, unattempted: unattemptedDomains };
  }

  /** Up to three deterministic study actions derived from the actual attempt. */
  function computeStudyActions(scoreResult, rankedResult, readinessResult) {
    var actions = [];
    var ranked = rankedResult.ranked;
    var weakest = ranked.find(function hasMisses(domain) {
      return domain.correct < domain.attempted;
    });

    if (weakest) {
      actions.push({
        key: "review_weakest_domain",
        text: "Focus on \"" + weakest.domain + "\" first — " + (weakest.attempted - weakest.correct) +
          " of " + weakest.attempted + " attempted questions there were missed."
      });
    } else if (ranked.length) {
      actions.push({
        key: "maintain_strength",
        text: "Every domain you attempted was fully correct — revisit the official references to lock it in."
      });
    }

    if (rankedResult.unattempted.length) {
      var names = rankedResult.unattempted.map(function name(domain) { return domain.domain; }).slice(0, 3).join(", ");
      actions.push({
        key: "cover_remaining_domains",
        text: "You haven't attempted " + rankedResult.unattempted.length + " domain" +
          (rankedResult.unattempted.length === 1 ? "" : "s") + " yet (" + names +
          (rankedResult.unattempted.length > 3 ? ", …" : "") + ") — a retake covering these will sharpen your signal."
      });
    }

    var misconceptionCount = scoreResult.details.filter(function isMisconception(detail) {
      return detail.confidenceClass === "misconception";
    }).length;
    if (misconceptionCount > 0) {
      actions.push({
        key: "resolve_misconceptions",
        text: "Revisit the " + misconceptionCount + " question" + (misconceptionCount === 1 ? "" : "s") +
          " you got wrong while feeling \"Sure\" — these usually point to one specific misconception worth clearing up."
      });
    }

    if (!actions.length || actions.length < 2) {
      actions.push({
        key: "simulate_full_length",
        text: readinessResult.band.key === "ready"
          ? "Retake in timed mode to confirm your pacing before exam day."
          : "Use untimed practice mode next so you can reason through each question without exam-pace pressure."
      });
    }

    return actions.slice(0, 3);
  }

  function compareToPreviousAttempt(current, previous) {
    if (!previous) return null;
    return {
      previousCorrect: previous.correct,
      previousAccuracyPercentage: previous.accuracyPercentage,
      previousBandKey: previous.bandKey,
      correctDelta: current.correct - previous.correct,
      accuracyDelta: current.accuracyPercentage - previous.accuracyPercentage,
      bandChanged: current.bandKey !== previous.bandKey
    };
  }

  /**
   * Revenue-aware CTA routing: the coupon URL only while genuinely within
   * its scheduled window, otherwise the locked referral URL, otherwise no
   * link at all. Never fabricates or guesses a destination.
   */
  function resolveCta(offer, nowMs) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    if (!offer || !offer.courseId) {
      return { available: false, reason: "no_course_mapping", url: null, kind: null };
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
    return { available: false, reason: "missing_mapping", url: null, kind: null };
  }

  // ------------------------------------------------------------------
  // Study Mode: attempt-then-reveal learning, no readiness band. These
  // functions are pure and deliberately separate from the Diagnostic Mode
  // functions above — Study Mode never computes or implies a readiness
  // signal, only a coverage/accuracy summary, so the two experiences can
  // never be confused with each other.
  // ------------------------------------------------------------------

  var STUDY_NUDGE_MIN_QUESTIONS = 3; // don't nudge before the learner has found their footing
  var STUDY_NUDGE_COOLDOWN = 5; // minimum questions between any two nudges

  /**
   * Decide whether to show an inline conversion nudge after this question's
   * reveal, and which one. Responds to real signal (a real milestone with a
   * real coupon deadline outranks everything; a wrong answer or a streak
   * outranks a generic reminder) rather than firing on a flat timer alone.
   * Returns null when nothing should show. Pure — the caller owns all
   * cooldown/streak state and passes it in.
   *
   * context: {
   *   questionsAnswered, totalQuestions, questionsSinceLastNudge,
   *   lastState ('correct'|'incorrect'), streak (consecutive correct),
   *   offer ({ startAt, endAt } or falsy)
   * }
   */
  function selectStudyNudge(context) {
    var answered = context.questionsAnswered || 0;
    var total = context.totalQuestions || 0;
    if (answered < STUDY_NUDGE_MIN_QUESTIONS || total === 0) return null;

    var milestoneHit = isAtCoverageMilestone(answered, total);
    var offerNote = milestoneHit ? realOfferDeadlineNote(context.offer) : null;
    if (milestoneHit && offerNote) {
      return {
        key: "milestone",
        headline: "You're " + Math.round((answered / total) * 100) + "% through the free set.",
        body: offerNote
      };
    }

    if (context.questionsSinceLastNudge < STUDY_NUDGE_COOLDOWN) return null;

    if (context.lastState === "incorrect") {
      return {
        key: "need",
        headline: "Right where practice pays off.",
        body: "This is exactly the kind of scenario the full course drills — a worked explanation for every question, not just this free set."
      };
    }
    if ((context.streak || 0) >= 3) {
      return {
        key: "confidence",
        headline: "You're on a roll.",
        body: "You clearly get this pattern — see it applied across the full course's complete question bank."
      };
    }
    return {
      key: "generic",
      headline: "Enjoying the explanations?",
      body: "This free set is a preview — the full course goes much deeper on every domain."
    };
  }

  function isAtCoverageMilestone(answered, total) {
    var third = Math.round(total / 3);
    var twoThirds = Math.round((total * 2) / 3);
    return answered === third || answered === twoThirds;
  }

  /** Only ever states a real, already-known coupon deadline — never invents urgency. */
  function realOfferDeadlineNote(offer) {
    if (!offer || !offer.endAt) return null;
    var end = new Date(offer.endAt);
    if (isNaN(end.getTime())) return null;
    var now = new Date();
    var daysLeft = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 0) return null;
    return "Today's offer on the full course ends in " + daysLeft + " day" + (daysLeft === 1 ? "" : "s") + ".";
  }

  /**
   * A warm, factual close-out for a Study Mode session — coverage and
   * accuracy only, never a readiness label, so it can never be mistaken
   * for the Diagnostic Mode's honest readiness signal.
   */
  function summarizeStudySession(scoreResult) {
    var accuracy = scoreResult.accuracyPercentage;
    var ctaFraming =
      scoreResult.attempted === 0
        ? "start"
        : accuracy >= 70
        ? "strong"
        : "building";
    return {
      attempted: scoreResult.attempted,
      correct: scoreResult.correct,
      total: scoreResult.total,
      accuracyPercentage: accuracy,
      coveragePercentage: scoreResult.coveragePercentage,
      ctaFraming: ctaFraming
    };
  }

  var STUDY_CTA_COPY = {
    start: {
      heading: "Ready to go deeper?",
      body: "The full course walks through every domain with the same worked explanations, at your own pace."
    },
    building: {
      heading: "You now know exactly what to study next.",
      body: "That clarity is the hard part. The full course is built to take you from here to exam-ready, one concept at a time."
    },
    strong: {
      heading: "You're picking this up fast.",
      body: "Keep the momentum going — the full course has the complete question bank and every domain in depth."
    }
  };

  return {
    READINESS_BANDS: READINESS_BANDS,
    normalizeAnswerSet: normalizeAnswerSet,
    exactSetEqual: exactSetEqual,
    scoreQuestion: scoreQuestion,
    scoreAssessment: scoreAssessment,
    classifyConfidence: classifyConfidence,
    computeReadinessResult: computeReadinessResult,
    rankDomainsForReview: rankDomainsForReview,
    computeStudyActions: computeStudyActions,
    compareToPreviousAttempt: compareToPreviousAttempt,
    resolveCta: resolveCta,
    bandByKey: bandByKey,
    bandByRank: bandByRank,
    selectStudyNudge: selectStudyNudge,
    summarizeStudySession: summarizeStudySession,
    STUDY_CTA_COPY: STUDY_CTA_COPY
  };
});
