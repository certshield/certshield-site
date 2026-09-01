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
  function scrollToElement(element, options) {
    if (!element) return;
    // "instant" is for exit/escape actions (e.g. "back to results" from deep
    // inside a long review list) where a multi-second smooth journey back
    // through everything just scrolled past works against the point of the
    // button - the user asked to leave, not to re-watch the scroll. Simply
    // passing behavior:"auto" is not enough: per spec "auto" defers to the
    // scrolling box's own `scroll-behavior` CSS property, and this site sets
    // `html { scroll-behavior: smooth }` globally - so it still animates
    // unless that CSS property is overridden for the moment of the jump.
    var instant = Boolean(options && options.instant) || prefersReducedMotion();
    if (instant) {
      var root = document.documentElement;
      var previous = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      element.scrollIntoView({ behavior: "auto", block: "start" });
      root.style.scrollBehavior = previous;
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "start" });
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

  /**
   * " - <amount> <ISO currency code>" for a genuinely priced offer, else "".
   * Never shown for a free coupon (discountPrice "0") so a fully-free offer
   * is never mislabeled as paid. No assumed currency symbol, since a
   * source-market price isn't necessarily the visitor's local price.
   * Mirrors price_suffix() in scripts/render_site.py exactly - keep both in
   * sync if this changes. Shared here since both runners show a CTA price.
   */
  function priceSuffix(offer) {
    offer = offer || {};
    var offerType = offer.offerType || "";
    var price = String(offer.discountPrice || "").trim();
    var currency = String(offer.currency || "").trim();
    var showsPrice = (offerType === "best_price" || offerType === "custom_price") && price && price !== "0";
    return showsPrice ? " — " + price + " " + currency : "";
  }

  /**
   * Offer-type vocabulary shared with the friendly badge labels on the
   * Offers page and homepage preview (render_site.py OFFER_TYPE_LABELS /
   * OFFER_TYPE_BADGE_CLASS) - keep both in sync if this changes.
   */
  var OFFER_TYPE_LABELS = {
    free_targeted: "Community Free Access",
    free_open: "Flash Free Access",
    best_price: "Current Udemy Best Price",
    custom_price: "Instructor Special Price"
  };
  var OFFER_TYPE_BADGE_CLASS = {
    free_targeted: "badge-free-targeted",
    free_open: "badge-free-open",
    best_price: "badge-best-price",
    custom_price: "badge-custom-price"
  };

  function isFreeOfferType(offerType) {
    return offerType === "free_open" || offerType === "free_targeted";
  }

  /** True only for a real, finite maximumRedemptions - never inferred, never fabricated. */
  function offerIsCapped(offer) {
    var redemptions = String((offer || {}).maximumRedemptions || "").trim();
    return Boolean(redemptions) && redemptions.toLowerCase() !== "unlimited";
  }

  function formatOfferEndDate(endAt) {
    if (!endAt) return "";
    var date = new Date(endAt);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  /** Shared CTA microcopy - mirrors cta_button_label() in scripts/render_site.py. */
  function ctaButtonLabel(offer, kind) {
    if (kind !== "coupon") return "Start Full Practice on Udemy";
    return isFreeOfferType((offer || {}).offerType) ? "Claim Your Free Seat" : "Claim Today's Offer" + priceSuffix(offer);
  }

  /** The same green/amber/orange offer-type pill used on the Offers page and
   * homepage preview, reused here so a learner learns the color once and
   * recognizes it everywhere. Returns null (append nothing) when there's no
   * active coupon to badge. */
  function offerBadgeEl(offer, kind) {
    if (kind !== "coupon") return null;
    var offerType = (offer || {}).offerType || "";
    var label = OFFER_TYPE_LABELS[offerType];
    if (!label) return null;
    return el("p", "offer-badge badge " + (OFFER_TYPE_BADGE_CLASS[offerType] || ""), label);
  }

  /**
   * Honest urgency line: the real redemption cap for a free+capped offer,
   * otherwise the real campaign end date. Never fabricates a claimed-seats
   * counter - only maximumRedemptions and endAt from the coupon export are
   * ever shown. Returns null when there's nothing true to say.
   */
  function offerUrgencyEl(offer, kind) {
    if (kind !== "coupon") return null;
    offer = offer || {};
    var endText = formatOfferEndDate(offer.endAt);
    if (isFreeOfferType(offer.offerType) && offerIsCapped(offer)) {
      var p = el("p", "offer-urgency");
      var strong = document.createElement("strong");
      strong.textContent = "Only " + offer.maximumRedemptions + " free seats";
      p.appendChild(strong);
      if (endText) p.appendChild(document.createTextNode(" — through " + endText));
      return p;
    }
    if (endText) {
      return el("p", "offer-urgency", "Instructor pricing confirmed through " + endText + ".");
    }
    return null;
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
    labelForOption: labelForOption,
    priceSuffix: priceSuffix,
    isFreeOfferType: isFreeOfferType,
    offerIsCapped: offerIsCapped,
    formatOfferEndDate: formatOfferEndDate,
    ctaButtonLabel: ctaButtonLabel,
    offerBadgeEl: offerBadgeEl,
    offerUrgencyEl: offerUrgencyEl
  };
})(typeof window !== "undefined" ? window : this);
