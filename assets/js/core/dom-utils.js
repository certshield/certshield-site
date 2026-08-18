/**
 * Small, shared DOM/storage helpers used by every runner UI module
 * (assessment-runner.js, study-mode-runner.js, assessment-mode-select.js).
 * Kept dependency-free and framework-free, matching the rest of this site.
 */
(function attachCertShieldDomUtils(globalObject) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

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

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function setAttr(key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function prefersReducedMotion() {
    return Boolean(globalObject.matchMedia && globalObject.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /** So the learner never has to hunt for the question or the next action. */
  function scrollToElement(element) {
    if (!element) return;
    element.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function formatClock(totalSeconds) {
    var seconds = Math.max(0, Math.round(totalSeconds));
    var minutes = Math.floor(seconds / 60);
    var remainder = seconds % 60;
    return String(minutes) + ":" + (remainder < 10 ? "0" : "") + String(remainder);
  }

  function safeStorage() {
    try {
      var testKey = "__certshield_test__";
      globalObject.localStorage.setItem(testKey, "1");
      globalObject.localStorage.removeItem(testKey);
      return globalObject.localStorage;
    } catch (error) {
      return null;
    }
  }

  var EXPLANATION_SECTION_ORDER = [
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

  /**
   * Appends a question's full ten-section explanation (the same
   * pre-sanitized *Html content produced at build time by
   * scripts/import/markdown_assessment.py) to a container — used
   * identically by Diagnostic Mode's post-submission review and Study
   * Mode's per-question reveal, so the teaching content is one shared
   * rendering path, not two.
   */
  function appendExplanationSections(container, question) {
    EXPLANATION_SECTION_ORDER.forEach(function addSection(pair) {
      var body = question.sections && question.sections[pair[0]];
      if (!body) return;
      container.appendChild(el("h5", "", pair[1]));
      var body_el = el("div", "");
      html(body_el, body);
      container.appendChild(body_el);
    });

    if (question.officialReferences && question.officialReferences.length) {
      container.appendChild(el("h5", "", "Official References"));
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
      container.appendChild(refList);
    }
  }

  function labelForOption(question, optionId) {
    var option = (question.options || []).find(function findOption(candidate) {
      return candidate.id === optionId;
    });
    return option ? option.id + ". " + option.text : optionId;
  }

  globalObject.CertShieldDomUtils = {
    el: el,
    html: html,
    svgEl: svgEl,
    prefersReducedMotion: prefersReducedMotion,
    scrollToElement: scrollToElement,
    formatClock: formatClock,
    safeStorage: safeStorage,
    appendExplanationSections: appendExplanationSections,
    labelForOption: labelForOption
  };
})(typeof window !== "undefined" ? window : this);
