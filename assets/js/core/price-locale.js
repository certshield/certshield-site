/* CertShield price locale: rupee prices are shown only to visitors in India.
 *
 * The coupon export prices in rupees. To a global audience "₹479" means nothing (and Udemy shows every visitor their
 * own currency at checkout), so the pages carry NO rupee amount in their text. They carry hidden placeholders instead:
 *   <span data-in-price="479" data-currency="INR" data-in-format=": {p}" hidden></span>   -> ": ₹479" for India, nothing else
 *   <p data-in-text="Reference price in INR - ...">Udemy shows the price in your own currency at checkout.</p>
 *                                                                                           -> the longer line for India
 * "In India" = the browser's time zone is Asia/Kolkata (or Asia/Calcutta), or one of its preferred languages has the
 * region IN (en-IN, hi-IN, ...). It is a convenience, never a gate: a wrong guess costs a visitor one extra, clearly
 * labelled "reference price" or one missing number. Prices in any other currency are printed for everyone by the server.
 * Mirrors price_reveal() / offer_row_price_html() in scripts/render_site.py. */
(function (globalObject) {
  "use strict";

  var cached = null;

  function isIndia() {
    if (cached !== null) return cached;
    cached = false;
    try {
      var zone = (Intl.DateTimeFormat().resolvedOptions().timeZone || "");
      if (zone === "Asia/Kolkata" || zone === "Asia/Calcutta") cached = true;
    } catch (error) { /* no Intl: fall through to the language check */ }
    if (!cached) {
      var languages = [];
      try { languages = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language]; } catch (error) { languages = []; }
      for (var i = 0; i < languages.length; i += 1) {
        if (/^[a-z]{2,3}-IN\b/i.test(String(languages[i] || ""))) { cached = true; break; }
      }
    }
    return cached;
  }

  /** "₹479" for rupees, "12 USD" for anything else - the same text as offer_price_text() on the server. */
  function format(amount, currency) {
    var code = String(currency || "").trim();
    var value = String(amount || "").trim();
    return code.toUpperCase() === "INR" ? "\u20B9" + value : (value + " " + code).trim();
  }

  /** True when this offer's price is shown only to visitors in India (a rupee price, which is the only one gated). */
  function isGated(currency) {
    return String(currency || "").trim().toUpperCase() === "INR";
  }

  /** " — ₹479" (or " — 12 USD") for a genuinely priced offer when it may be shown to this visitor, else "". */
  function suffix(offer) {
    offer = offer || {};
    var price = String(offer.discountPrice || "").trim();
    var priced = (offer.offerType === "best_price" || offer.offerType === "custom_price") && price && price !== "0";
    if (!priced) return "";
    if (isGated(offer.currency) && !isIndia()) return "";
    return " \u2014 " + format(price, offer.currency);
  }

  function apply(root) {
    var scope = root || document;
    var india = isIndia();
    var prices = scope.querySelectorAll("[data-in-price]");
    for (var i = 0; i < prices.length; i += 1) {
      var node = prices[i];
      if (india) {
        var template = node.getAttribute("data-in-format") || "{p}";
        node.textContent = template.replace("{p}", format(node.getAttribute("data-in-price"), node.getAttribute("data-currency")));
        node.hidden = false;
      } else {
        node.textContent = "";
        node.hidden = true;
      }
    }
    var texts = scope.querySelectorAll("[data-in-text]");
    for (var j = 0; j < texts.length; j += 1) {
      var holder = texts[j];
      if (holder.getAttribute("data-global-text") === null) holder.setAttribute("data-global-text", holder.textContent);
      holder.textContent = india ? holder.getAttribute("data-in-text") : holder.getAttribute("data-global-text");
    }
  }

  globalObject.CertShieldPrice = { isIndia: isIndia, format: format, suffix: suffix, apply: apply };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { apply(document); });
    else apply(document);
  }
})(typeof window !== "undefined" ? window : this);
