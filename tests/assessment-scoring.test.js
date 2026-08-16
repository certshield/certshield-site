(function runCertShieldAssessmentScoringTests(globalObject) {
  "use strict";

  var api =
    typeof module === "object" && module.exports
      ? require("../assets/js/core/assessment-scoring.js")
      : globalObject.CertShieldAssessmentScoring;
  var tests = [];
  var results = [];

  function test(name, callback) {
    tests.push({ name: name, callback: callback });
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
  }

  function equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        (message ? message + ": " : "") + "expected " + JSON.stringify(expected) + ", received " + JSON.stringify(actual)
      );
    }
  }

  function question(id, correctAnswers, mode, required, domain, number) {
    return {
      id: id,
      correctAnswers: correctAnswers,
      selectionMode: mode || "single",
      requiredSelections: required || correctAnswers.length,
      domain: domain || "General",
      questionNumber: number || 1
    };
  }

  function buildThirtyQuestionSet(correctCount, domainSpec) {
    // domainSpec: array of [domainName, questionCount]
    var questions = [];
    var answers = {};
    var confidences = {};
    var index = 0;
    var remainingCorrect = correctCount;

    domainSpec.forEach(function (pair) {
      var domain = pair[0];
      var count = pair[1];
      for (var i = 0; i < count; i += 1) {
        index += 1;
        var id = "q" + index;
        questions.push(question(id, ["C"], "single", 1, domain, index));
        var makeCorrect = remainingCorrect > 0;
        if (makeCorrect) remainingCorrect -= 1;
        answers[id] = makeCorrect ? ["C"] : ["A"];
      }
    });
    return { questions: questions, answers: answers, confidences: confidences };
  }

  // ---------------------------------------------------------------- scoring

  test("scoreQuestion: exact-set MCQ correct", function () {
    var result = api.scoreQuestion(question("q1", ["C"]), ["C"]);
    equal(result.state, "correct");
  });

  test("scoreQuestion: MSQ with extra selection is incorrect (no partial credit)", function () {
    var q = question("q1", ["B", "E"], "multiple", 2);
    var result = api.scoreQuestion(q, ["B", "E", "A"]);
    // extra selection beyond required count means never "answered" as-required
    assert(result.state !== "correct", "extra selection must not score correct");
  });

  test("scoreQuestion: MSQ with missing selection is unanswered, not incorrect-with-partial", function () {
    var q = question("q1", ["B", "E"], "multiple", 2);
    var result = api.scoreQuestion(q, ["B"]);
    equal(result.state, "unanswered");
  });

  test("scoreQuestion: empty selection is unanswered", function () {
    var result = api.scoreQuestion(question("q1", ["C"]), []);
    equal(result.state, "unanswered");
  });

  test("scoreQuestion: wrong single answer is incorrect", function () {
    var result = api.scoreQuestion(question("q1", ["C"]), ["A"]);
    equal(result.state, "incorrect");
  });

  test("exactSetEqual: order-independent, duplicate-insensitive", function () {
    assert(api.exactSetEqual(["B", "E"], ["E", "B"]));
    assert(api.exactSetEqual(["B", "B", "E"], ["B", "E"]));
    assert(!api.exactSetEqual(["B"], ["B", "E"]));
  });

  // ------------------------------------------------------- readiness bands

  test("getReadinessBand: fixed 30-question boundaries", function () {
    equal(api.getReadinessBand(30).key, "strong");
    equal(api.getReadinessBand(26).key, "strong");
    equal(api.getReadinessBand(25).key, "targeted");
    equal(api.getReadinessBand(21).key, "targeted");
    equal(api.getReadinessBand(20).key, "developing");
    equal(api.getReadinessBand(17).key, "developing");
    equal(api.getReadinessBand(16).key, "foundation");
    equal(api.getReadinessBand(0).key, "foundation");
  });

  // ------------------------------------------------------------ safeguards

  test("safeguard: strong band with an unanswered question is downgraded and explained", function () {
    var set = buildThirtyQuestionSet(28, [["Domain A", 30]]);
    // leave one question unanswered
    var lastId = set.questions[set.questions.length - 1].id;
    delete set.answers[lastId];
    var scoreResult = api.scoreAssessment(set.questions, set.answers, set.confidences);
    var safeguards = api.applyReadinessSafeguards(scoreResult);
    equal(safeguards.initialBand.key, "strong");
    assert(safeguards.downgraded, "strong band must downgrade when not all 30 are answered");
    equal(safeguards.finalBand.key, "targeted");
    assert(safeguards.triggeredSafeguards.length >= 1);
  });

  test("safeguard: domain below 50% with >=3 questions triggers exactly one downgrade", function () {
    // 22 correct overall (targeted band), one domain of 4 scored 0/4 (below 50%, sufficient evidence)
    var set = buildThirtyQuestionSet(22, [["Weak Domain", 4], ["Strong Domain", 26]]);
    // Force the weak domain's 4 questions to be the incorrect ones explicitly
    set.questions.slice(0, 4).forEach(function (q) { set.answers[q.id] = ["A"]; });
    set.questions.slice(4).forEach(function (q) { set.answers[q.id] = ["C"]; });
    var scoreResult = api.scoreAssessment(set.questions, set.answers, set.confidences);
    var safeguards = api.applyReadinessSafeguards(scoreResult);
    assert(safeguards.downgraded, "weak domain with sufficient evidence must trigger a downgrade");
    equal(safeguards.finalBand.rank, safeguards.initialBand.rank - 1);
  });

  test("safeguard: domain with fewer than 3 questions cannot cause a downgrade by itself", function () {
    // 28 correct overall (strong band, all answered), one domain of 2 scored 0/2 (limited evidence)
    var set = buildThirtyQuestionSet(28, [["Tiny Domain", 2], ["Rest", 28]]);
    set.questions.slice(0, 2).forEach(function (q) { set.answers[q.id] = ["A"]; });
    var scoreResult = api.scoreAssessment(set.questions, set.answers, set.confidences);
    var tinyDomain = scoreResult.domains.filter(function (d) { return d.domain === "Tiny Domain"; })[0];
    assert(tinyDomain.evidenceLimited, "a 2-question domain must be marked limited evidence");
    var safeguards = api.applyReadinessSafeguards(scoreResult);
    // 28 correct + all answered should remain strong; the limited-evidence
    // domain alone must not trigger the weak-domain safeguard.
    var weakDomainTriggered = safeguards.triggeredSafeguards.some(function (item) { return item.key === "weak_domain"; });
    assert(!weakDomainTriggered, "limited-evidence domain must not trigger a downgrade");
  });

  test("safeguard: at most one downgrade is ever applied even with multiple triggers", function () {
    // Deliberately land exactly on the strong-band boundary (26/30) while
    // simultaneously satisfying both other triggers, so both fire at once:
    //  - Weak Domain: 3 questions (sufficient evidence), all wrong -> 0%.
    //  - Rest: 27 questions, 26 correct + 1 unanswered (keeps total at 26,
    //    the strong-band floor, while leaving a question unanswered).
    var questions = [];
    var answers = {};
    for (var w = 1; w <= 3; w += 1) {
      questions.push(question("weak" + w, ["C"], "single", 1, "Weak Domain", w));
      answers["weak" + w] = ["A"];
    }
    for (var r = 1; r <= 27; r += 1) {
      questions.push(question("rest" + r, ["C"], "single", 1, "Rest", 3 + r));
      answers["rest" + r] = r === 27 ? [] : ["C"];
    }
    var scoreResult = api.scoreAssessment(questions, answers, {});
    equal(scoreResult.correct, 26);
    equal(scoreResult.unanswered, 1);

    var safeguards = api.applyReadinessSafeguards(scoreResult);
    equal(safeguards.initialBand.key, "strong");
    assert(safeguards.triggeredSafeguards.length >= 2, "expected both safeguards to fire");
    equal(safeguards.initialBand.rank - safeguards.finalBand.rank, 1, "only one band level may ever be lost");
  });

  // --------------------------------------------------------- confidence

  test("classifyConfidence: full calibration matrix", function () {
    equal(api.classifyConfidence("correct", "sure"), "stable");
    equal(api.classifyConfidence("correct", "unsure"), "fragile");
    equal(api.classifyConfidence("correct", "guessing"), "fragile");
    equal(api.classifyConfidence("incorrect", "sure"), "misconception");
    equal(api.classifyConfidence("incorrect", "unsure"), "gap");
    equal(api.classifyConfidence("incorrect", "guessing"), "gap");
    equal(api.classifyConfidence("correct", ""), "unclassified");
  });

  test("classifyConfidence never changes the raw score", function () {
    var q = question("q1", ["C"]);
    var withConfidence = api.scoreAssessment([q], { q1: ["C"] }, { q1: "guessing" });
    var withoutConfidence = api.scoreAssessment([q], { q1: ["C"] }, {});
    equal(withConfidence.correct, withoutConfidence.correct);
  });

  // ------------------------------------------------------------- ranking

  test("rankDomainsForReview: misconceptions outrank plain incorrect rate", function () {
    var questions = [
      question("q1", ["C"], "single", 1, "Domain A", 1),
      question("q2", ["C"], "single", 1, "Domain A", 2),
      question("q3", ["C"], "single", 1, "Domain B", 3),
      question("q4", ["C"], "single", 1, "Domain B", 4)
    ];
    // Domain A: both wrong, one marked "sure" (misconception). Domain B: both wrong, no confidence.
    var answers = { q1: ["A"], q2: ["A"], q3: ["A"], q4: ["A"] };
    var confidences = { q1: "sure" };
    var scoreResult = api.scoreAssessment(questions, answers, confidences);
    var ranked = api.rankDomainsForReview(scoreResult);
    equal(ranked[0].domain, "Domain A");
    equal(ranked[0].priority, 1);
  });

  // --------------------------------------------------------------- CTA

  test("resolveCta: active coupon window wins", function () {
    var cta = api.resolveCta(
      { courseId: "1", couponUrl: "https://u/coupon", instructorReferralUrl: "https://u/ref", startAt: "2020-01-01T00:00:00Z", endAt: "2099-01-01T00:00:00Z" },
      Date.parse("2026-01-01T00:00:00Z")
    );
    equal(cta.available, true);
    equal(cta.kind, "coupon");
  });

  test("resolveCta: falls back to locked referral outside the coupon window", function () {
    var cta = api.resolveCta(
      { courseId: "1", couponUrl: "https://u/coupon", instructorReferralUrl: "https://u/ref", startAt: "2099-01-01T00:00:00Z", endAt: "2099-06-01T00:00:00Z" },
      Date.parse("2026-01-01T00:00:00Z")
    );
    equal(cta.available, true);
    equal(cta.kind, "referral");
    equal(cta.url, "https://u/ref");
  });

  test("resolveCta: no coupon, no referral -> unavailable, never a guessed link", function () {
    var cta = api.resolveCta({ courseId: "1" }, Date.now());
    equal(cta.available, false);
    equal(cta.url, null);
  });

  test("resolveCta: never combines a coupon URL with a referral code", function () {
    var cta = api.resolveCta(
      { courseId: "1", couponUrl: "https://u/coupon?couponCode=X", instructorReferralUrl: "https://u/ref?referralCode=Y", startAt: "2020-01-01T00:00:00Z", endAt: "2099-01-01T00:00:00Z" },
      Date.parse("2026-01-01T00:00:00Z")
    );
    assert(cta.url.indexOf("referralCode") === -1);
  });

  // ---------------------------------------------------------- study actions

  test("computeStudyActions: always returns up to three deterministic actions", function () {
    var set = buildThirtyQuestionSet(22, [["Domain A", 30]]);
    var scoreResult = api.scoreAssessment(set.questions, set.answers, set.confidences);
    var safeguards = api.applyReadinessSafeguards(scoreResult);
    var ranked = api.rankDomainsForReview(scoreResult);
    var actions1 = api.computeStudyActions(scoreResult, ranked, safeguards);
    var actions2 = api.computeStudyActions(scoreResult, ranked, safeguards);
    assert(actions1.length > 0 && actions1.length <= 3);
    equal(JSON.stringify(actions1), JSON.stringify(actions2), "study actions must be deterministic for the same attempt");
  });

  // --------------------------------------------------------------- run all

  tests.forEach(function execute(testCase) {
    try {
      testCase.callback();
      results.push({ name: testCase.name, passed: true });
    } catch (error) {
      results.push({ name: testCase.name, passed: false, error: error && error.stack ? error.stack : String(error) });
    }
  });

  var failures = results.filter(function (result) { return !result.passed; });
  var summary = (results.length - failures.length) + "/" + results.length + " assessment-scoring tests passed";

  if (globalObject.document) {
    var output = globalObject.document.createElement("pre");
    output.id = "assessment-scoring-test-results";
    output.setAttribute("data-failures", String(failures.length));
    output.textContent = summary + "\n" + results.map(function (r) {
      return (r.passed ? "PASS " : "FAIL ") + r.name + (r.error ? "\n" + r.error : "");
    }).join("\n");
    globalObject.document.body.appendChild(output);
  }

  if (typeof console !== "undefined" && console.log) {
    console.log(summary);
    failures.forEach(function (r) { console.error("FAIL " + r.name + "\n" + r.error); });
  }

  globalObject.__CERTSHIELD_ASSESSMENT_SCORING_TEST_RESULTS__ = results;
  if (typeof process !== "undefined" && process) {
    process.exitCode = failures.length ? 1 : 0;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
