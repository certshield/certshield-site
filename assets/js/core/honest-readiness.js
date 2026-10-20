/**
 * CertShield "Honest Score" maths for the free study layer (/learn/). Pure functions: no DOM, no storage, no network.
 *
 * A practice score is an estimate, so it is shown as a range, never as a falsely precise number:
 *   - pooled range: the Wilson score interval for "correct out of attempted", at 90 %.
 *   - blueprint-weighted range: every exam topic gets a Beta(correct + 1/2, wrong + 1/2) posterior (Jeffreys prior, so a topic with no answers is
 *     honestly uncertain instead of silently ignored), the posteriors are combined with the exam's published topic weights, and the 5th to 95th
 *     percentile of 20,000 seeded draws is reported. The seed comes from the inputs, so the same answers always give the same range.
 * Ranges are rounded outward (low end down, high end up). Nothing here is a probability of passing: a pass mark is a scaled score on a different
 * scale, so no such number is claimed.
 *
 * scripts/learn/stats.py is the same algorithm in Python; tests/test_learn.py runs the two against each other.
 * Exposed as window.CertShieldHonest in browsers and module.exports in CommonJS runners.
 */
(function attachCertShieldHonest(globalObject, factory) {
  "use strict";

  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalObject) {
    globalObject.CertShieldHonest = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createHonestApi() {
  "use strict";

  var Z90 = 1.6448536269514722;
  var PRIOR = 0.5;
  var DRAWS = 20000;
  var LEVEL = 0.9;
  var EPS = 1e-9; // in percent units: float noise must never widen a range by a whole point

  var SIGNATURE_MIN_ANSWERED = 4;
  var SIGNATURE_MIN_MISSED = 2;
  var SIGNATURE_MARGIN = 0.2;
  var SIGNATURE_SHOW = 3;

  function floorPct(x) {
    return Math.floor(x * 100 + EPS);
  }

  function ceilPct(x) {
    return Math.ceil(x * 100 - EPS);
  }

  /** Wilson score interval for k successes out of n, as proportions; null when nothing was answered. */
  function wilson(k, n, z) {
    if (!(n > 0)) return null;
    var zz = typeof z === "number" ? z : Z90;
    var p = k / n;
    var z2 = zz * zz;
    var denom = 1 + z2 / n;
    var centre = (p + z2 / (2 * n)) / denom;
    var half = (zz * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
    return { lo: k === 0 ? 0 : Math.max(0, centre - half), hi: k === n ? 1 : Math.min(1, centre + half) }; // a score of none or all has an exact end
  }

  /** The same interval in whole percent, rounded outward. */
  function wilsonPct(k, n) {
    var w = wilson(k, n);
    if (!w) return null;
    return { lo: w.lo, hi: w.hi, loPct: Math.max(0, floorPct(w.lo)), hiPct: Math.min(100, ceilPct(w.hi)) };
  }

  // ---------------------------------------------------------------- seeded randomness

  function mulberry32(seed) {
    var a = seed | 0;
    return function next() {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fnv1a(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function normaliseWeights(weights) {
    var total = 0;
    var i;
    for (i = 0; i < weights.length; i += 1) total += weights[i];
    var out = [];
    for (i = 0; i < weights.length; i += 1) out.push(weights[i] / total);
    return out;
  }

  /** domains: [{c, a, w}] with normalised weights. Weights enter the seed as integer millionths, so no float formatting is involved. */
  function seedFromDomains(domains) {
    var parts = [];
    for (var i = 0; i < domains.length; i += 1) {
      parts.push(domains[i].c + "/" + domains[i].a + "@" + Math.round(domains[i].w * 1e6));
    }
    return fnv1a(parts.join("|"));
  }

  function normalSample(rng) {
    var u1 = 1 - rng(); // in (0, 1], so the logarithm is finite
    var u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Marsaglia and Tsang (2000); for shape below 1 the standard boost Gamma(shape + 1) * U^(1/shape). */
  function gammaSample(rng, shape) {
    if (shape < 1) {
      var boost = rng();
      return gammaSample(rng, shape + 1) * Math.pow(boost, 1 / shape);
    }
    var d = shape - 1 / 3;
    var c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var x;
      var v;
      do {
        x = normalSample(rng);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      var u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  function betaSample(rng, a, b) {
    var x = gammaSample(rng, a);
    var y = gammaSample(rng, b);
    return x / (x + y);
  }

  function quantile(sorted, q) {
    var pos = q * (sorted.length - 1);
    var i = Math.floor(pos);
    var f = pos - i;
    if (i + 1 >= sorted.length) return sorted[i];
    return sorted[i] + f * (sorted[i + 1] - sorted[i]);
  }

  function checkDomain(d) {
    var ok = d && Number.isInteger(d.c) && Number.isInteger(d.a) && d.a >= 0 && d.c >= 0 && d.c <= d.a;
    if (!ok) throw new RangeError("Each topic needs whole numbers with 0 <= correct <= attempted.");
  }

  /**
   * Blueprint-weighted range. domains: [{c, a, w}] (w: any positive weights; normalised here).
   * Returns null when no question at all was answered.
   */
  function blueprintRange(domains, options) {
    var opts = options || {};
    var draws = opts.draws || DRAWS;
    var level = typeof opts.level === "number" ? opts.level : LEVEL;
    var i;
    var attempted = 0;
    for (i = 0; i < domains.length; i += 1) {
      checkDomain(domains[i]);
      if (!(domains[i].w > 0)) throw new RangeError("Every topic needs a positive weight.");
      attempted += domains[i].a;
    }
    if (!domains.length || attempted === 0) return null;

    var raw = [];
    for (i = 0; i < domains.length; i += 1) raw.push(domains[i].w);
    var ws = normaliseWeights(raw);
    var doms = [];
    for (i = 0; i < domains.length; i += 1) doms.push({ c: domains[i].c, a: domains[i].a, w: ws[i] });

    var rng = mulberry32(seedFromDomains(doms));
    var sums = new Float64Array(draws);
    for (var n = 0; n < draws; n += 1) {
      var s = 0;
      for (i = 0; i < doms.length; i += 1) {
        s += doms[i].w * betaSample(rng, doms[i].c + PRIOR, doms[i].a - doms[i].c + PRIOR);
      }
      sums[n] = s;
    }
    sums.sort();
    var lo = quantile(sums, (1 - level) / 2);
    var hi = quantile(sums, (1 + level) / 2);
    var mean = 0;
    for (i = 0; i < doms.length; i += 1) mean += (doms[i].w * (doms[i].c + PRIOR)) / (doms[i].a + 2 * PRIOR);
    return { lo: lo, hi: hi, mean: mean, loPct: Math.max(0, floorPct(lo)), hiPct: Math.min(100, ceilPct(hi)), draws: draws };
  }

  /**
   * Everything the results and the calculator show. topics: [{name, c, a, n, w}] where n is the number of questions in the topic (optional)
   * and w its exam weight or null. The weighted range exists only when every topic has a weight.
   */
  function summarise(topics) {
    var correct = 0;
    var attempted = 0;
    var i;
    for (i = 0; i < topics.length; i += 1) {
      checkDomain(topics[i]);
      correct += topics[i].c;
      attempted += topics[i].a;
    }
    var allWeighted = topics.length > 0;
    for (i = 0; i < topics.length; i += 1) {
      if (!(typeof topics[i].w === "number" && topics[i].w > 0)) allWeighted = false;
    }
    var pooled = wilsonPct(correct, attempted);
    var weighted = null;
    if (allWeighted && attempted > 0) {
      weighted = blueprintRange(
        topics.map(function pick(t) { return { c: t.c, a: t.a, w: t.w }; })
      );
    }
    var untouched = topics.filter(function none(t) { return t.a === 0; });
    var untouchedWeight = null;
    if (allWeighted) {
      var totalWeight = 0;
      var missing = 0;
      for (i = 0; i < topics.length; i += 1) {
        totalWeight += topics[i].w;
        if (topics[i].a === 0) missing += topics[i].w;
      }
      untouchedWeight = missing / totalWeight;
    }
    return {
      correct: correct,
      attempted: attempted,
      pct: attempted ? (correct / attempted) * 100 : null,
      pooled: pooled,
      weighted: weighted,
      untouched: untouched,
      untouchedWeight: untouchedWeight
    };
  }

  /** "54%–82%" (an en dash, no spaces); "100%" when the range is a single point. */
  function rangeText(loPct, hiPct) {
    return loPct === hiPct ? loPct + "%" : loPct + "%–" + hiPct + "%";
  }

  /**
   * Is the change since the last attempt larger than the noise? Compares the two pooled 90 % ranges: if they do not overlap the difference is
   * called real, otherwise it is within the noise. Conservative on purpose.
   */
  function compareAttempts(previous, current) {
    if (!previous || !current || !previous.pooled || !current.pooled) return null;
    var up = current.pooled.lo > previous.pooled.hi;
    var down = current.pooled.hi < previous.pooled.lo;
    return { verdict: up ? "up" : down ? "down" : "noise" };
  }

  // ---------------------------------------------------------------- error signature

  /**
   * rows: [{type, answered, missed}] in atlas order. Returns the trap types worth a look, strongest first. A type is flagged when the learner
   * answered at least 4 of its questions, missed at least 2, and missed a share at least 20 points above their overall share.
   */
  function errorSignature(rows) {
    var answered = 0;
    var missed = 0;
    var i;
    for (i = 0; i < rows.length; i += 1) {
      answered += rows[i].answered;
      missed += rows[i].missed;
    }
    if (answered === 0) return [];
    var overall = missed / answered;
    var flagged = [];
    for (i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      if (r.answered < SIGNATURE_MIN_ANSWERED || r.missed < SIGNATURE_MIN_MISSED) continue;
      var rate = r.missed / r.answered;
      if (rate - overall >= SIGNATURE_MARGIN - 1e-12) {
        flagged.push({ type: r.type, answered: r.answered, missed: r.missed, rate: rate, gap: rate - overall, order: i });
      }
    }
    flagged.sort(function byStrength(a, b) {
      return b.gap - a.gap || b.missed - a.missed || a.order - b.order;
    });
    return flagged.slice(0, SIGNATURE_SHOW);
  }

  return {
    Z90: Z90,
    DRAWS: DRAWS,
    LEVEL: LEVEL,
    wilson: wilson,
    wilsonPct: wilsonPct,
    floorPct: floorPct,
    ceilPct: ceilPct,
    mulberry32: mulberry32,
    fnv1a: fnv1a,
    normaliseWeights: normaliseWeights,
    seedFromDomains: seedFromDomains,
    blueprintRange: blueprintRange,
    summarise: summarise,
    rangeText: rangeText,
    compareAttempts: compareAttempts,
    errorSignature: errorSignature,
    SIGNATURE: { minAnswered: SIGNATURE_MIN_ANSWERED, minMissed: SIGNATURE_MIN_MISSED, margin: SIGNATURE_MARGIN, show: SIGNATURE_SHOW }
  };
});
