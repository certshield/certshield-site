/**
 * Small DOM builders shared by the free study layer's scripts (the mock exam results, the calculator and the My progress page).
 * Everything is built with createElement and textContent. The only markup ever assigned as HTML is a trap type's icon, which is a fixed drawing
 * from our own build, never learner input.
 */
(function attachCertShieldLearnUI(globalObject) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var LEARN = "/learn";
  var ACADEMY_LEARN = "https://certshield.academy/learn";

  function el(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof value !== "undefined") node.textContent = value;
    return node;
  }

  /** The shaded 0 to 100 % track used on the static pages too. point is the observed score in percent, or null. */
  function rangeBar(lo, hi, point, label) {
    var fig = el("figure", "lx-range");
    fig.setAttribute("role", "img");
    fig.setAttribute("aria-label", label);
    var track = el("div", "lx-range-track");
    var fill = el("span", "lx-range-fill");
    fill.style.left = lo + "%";
    fill.style.width = Math.max(hi - lo, 1) + "%";
    track.appendChild(fill);
    if (point !== null && point !== undefined) {
      var tick = el("span", "lx-range-tick");
      tick.style.left = point + "%";
      track.appendChild(tick);
    }
    fig.appendChild(track);
    var scale = el("div", "lx-range-scale");
    scale.setAttribute("aria-hidden", "true");
    ["0%", "50%", "100%"].forEach(function addMark(mark) { scale.appendChild(el("span", "", mark)); });
    fig.appendChild(scale);
    return fig;
  }

  /** A horizontal bar. The number beside it always carries the same information, so the bar itself is hidden from assistive technology. */
  function bar(percent) {
    var outer = el("span", "lx-bar");
    outer.setAttribute("aria-hidden", "true");
    outer.style.setProperty("--w", Math.max(0, Math.min(100, percent)) + "%");
    outer.appendChild(document.createElement("span"));
    return outer;
  }

  function trapIcon(type, size) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 22));
    svg.setAttribute("height", String(size || 22));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "lx-icon");
    svg.innerHTML = type && type.icon ? type.icon : "";
    return svg;
  }

  function link(href, label, external) {
    var a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (external) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    return a;
  }

  function trapChip(type) {
    var p = el("p", "lr-trapchip lx-t-" + type.id);
    p.appendChild(trapIcon(type, 18));
    p.appendChild(document.createTextNode("Trap type: "));
    p.appendChild(link(LEARN + "/trap-atlas/" + type.id + "/", type.name, true));
    return p;
  }

  function fullDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    } catch (error) {
      return "";
    }
  }

  globalObject.CertShieldLearnUI = {
    LEARN: LEARN,
    ACADEMY_LEARN: ACADEMY_LEARN,
    el: el,
    rangeBar: rangeBar,
    bar: bar,
    trapIcon: trapIcon,
    trapChip: trapChip,
    link: link,
    fullDate: fullDate
  };
})(typeof window !== "undefined" ? window : this);
