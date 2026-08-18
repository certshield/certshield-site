/**
 * Entry point for [data-assessment-runner] roots. Renders the Diagnostic
 * Mode vs Study Mode choice, then hands off to whichever runner class the
 * learner picks (assessment-runner.js / study-mode-runner.js). Neither
 * runner self-initializes — this file is the single place that decides
 * which one to instantiate, so both can share one mode-choice screen
 * instead of each owning a competing entry point.
 */
(function () {
  "use strict";

  var domUtils = window.CertShieldDomUtils;
  if (!domUtils) return;
  var el = domUtils.el;

  function renderModeChoice(root) {
    var chooser = el("div", "mode-select");
    chooser.appendChild(el("p", "mode-select-eyebrow", "Choose how you want to practice"));

    var grid = el("div", "mode-select-grid");

    var diagnosticCard = el("div", "mode-select-card");
    diagnosticCard.appendChild(el("h3", "", "Diagnostic Mode"));
    diagnosticCard.appendChild(
      el("p", "", "Answer all questions blind, then get an honest, evidence-based readiness signal. Timed or untimed.")
    );
    var diagnosticButton = el("button", "button button-primary", "Take the Diagnostic");
    diagnosticButton.type = "button";
    diagnosticCard.appendChild(diagnosticButton);

    var studyCard = el("div", "mode-select-card");
    studyCard.appendChild(el("h3", "", "Study Mode"));
    studyCard.appendChild(
      el("p", "", "See the explanation instantly after each question. No score, no pressure — just learning.")
    );
    var studyButton = el("button", "button button-secondary", "Start Studying");
    studyButton.type = "button";
    studyCard.appendChild(studyButton);

    grid.appendChild(diagnosticCard);
    grid.appendChild(studyCard);
    chooser.appendChild(grid);
    root.appendChild(chooser);

    diagnosticButton.addEventListener("click", function () {
      var RunnerModule = window.CertShieldAssessmentRunner;
      if (!RunnerModule) return;
      new RunnerModule.AssessmentRunner(root);
    });
    studyButton.addEventListener("click", function () {
      var RunnerModule = window.CertShieldStudyModeRunner;
      if (!RunnerModule) return;
      new RunnerModule.StudyModeRunner(root);
    });
  }

  function initAll() {
    Array.from(document.querySelectorAll("[data-assessment-runner]")).forEach(function initOne(root) {
      if (root.getAttribute("data-assessment-initialized") === "true") return;
      root.setAttribute("data-assessment-initialized", "true");
      renderModeChoice(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
}());
