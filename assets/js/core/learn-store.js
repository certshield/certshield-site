/**
 * Local-only progress store for the free study layer (/learn/). Nothing here touches the network: a finished mock exam is summarised into a small
 * record and kept in this browser's localStorage under one key, so the "My progress" page can show it and the next attempt can be compared with it.
 *
 * Shape: { v: 1, exams: { "<slug>": { attempts: [ newest first, at most MAX_ATTEMPTS ] } } }
 * An attempt: { t, name, k, n, total, lo, hi, wlo, whi, d: [[topic, correct, attempted, weight|null]], tr: { "<trap type>": [answered, missed] } }
 * Everything read back is validated and rebuilt field by field, so a damaged or hand-edited value can never break a page or inject markup.
 */
(function attachCertShieldLearnStore(globalObject) {
  "use strict";

  var KEY = "certshield.learn.progress.v1";
  var MAX_ATTEMPTS = 5;
  var MAX_EXAMS = 120;
  var MAX_TOPICS = 40;

  function storage() {
    try {
      var probe = "__certshield_test__";
      globalObject.localStorage.setItem(probe, "1");
      globalObject.localStorage.removeItem(probe);
      return globalObject.localStorage;
    } catch (error) {
      return null;
    }
  }

  function isCount(x) {
    return typeof x === "number" && isFinite(x) && Math.floor(x) === x && x >= 0 && x <= 100000;
  }

  function isPct(x) {
    return isCount(x) && x <= 100;
  }

  function text(x, max) {
    return typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  function cleanAttempt(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!(typeof raw.t === "number" && isFinite(raw.t) && raw.t > 0)) return null;
    if (!isCount(raw.k) || !isCount(raw.n) || !isCount(raw.total) || raw.k > raw.n || raw.n > raw.total) return null;
    if (!isPct(raw.lo) || !isPct(raw.hi) || raw.lo > raw.hi) return null;
    var wlo = raw.wlo === null || raw.wlo === undefined ? null : raw.wlo;
    var whi = raw.whi === null || raw.whi === undefined ? null : raw.whi;
    if ((wlo === null) !== (whi === null)) return null;
    if (wlo !== null && (!isPct(wlo) || !isPct(whi) || wlo > whi)) return null;
    var topics = [];
    if (Array.isArray(raw.d)) {
      raw.d.slice(0, MAX_TOPICS).forEach(function eachTopic(row) {
        if (!Array.isArray(row) || row.length < 3) return;
        var name = text(row[0], 160);
        var weight = row[3] === null || row[3] === undefined ? null : row[3];
        if (!name || !isCount(row[1]) || !isCount(row[2]) || row[1] > row[2]) return;
        if (weight !== null && !(typeof weight === "number" && isFinite(weight) && weight > 0 && weight <= 100)) return;
        topics.push([name, row[1], row[2], weight]);
      });
    }
    var traps = {};
    if (raw.tr && typeof raw.tr === "object") {
      Object.keys(raw.tr).slice(0, 20).forEach(function eachTrap(id) {
        var pair = raw.tr[id];
        if (!/^[a-z-]{2,40}$/.test(id) || !Array.isArray(pair) || !isCount(pair[0]) || !isCount(pair[1]) || pair[1] > pair[0]) return;
        traps[id] = [pair[0], pair[1]];
      });
    }
    return { t: raw.t, name: text(raw.name, 160), k: raw.k, n: raw.n, total: raw.total, lo: raw.lo, hi: raw.hi, wlo: wlo, whi: whi, d: topics, tr: traps };
  }

  function empty() {
    return { v: 1, exams: {} };
  }

  /** The whole store, validated. Never throws; an unreadable value reads as an empty store. */
  function read() {
    var store = storage();
    if (!store) return empty();
    var raw;
    try {
      raw = JSON.parse(store.getItem(KEY) || "null");
    } catch (error) {
      return empty();
    }
    var out = empty();
    if (!raw || raw.v !== 1 || !raw.exams || typeof raw.exams !== "object") return out;
    Object.keys(raw.exams).slice(0, MAX_EXAMS).forEach(function eachExam(slug) {
      if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(slug)) return;
      var list = raw.exams[slug] && Array.isArray(raw.exams[slug].attempts) ? raw.exams[slug].attempts : [];
      var attempts = list.slice(0, MAX_ATTEMPTS).map(cleanAttempt).filter(Boolean);
      if (attempts.length) out.exams[slug] = { attempts: attempts };
    });
    return out;
  }

  function write(data) {
    var store = storage();
    if (!store) return false;
    try {
      store.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Adds an attempt (newest first, oldest dropped beyond MAX_ATTEMPTS). Returns false when storage is unavailable or the attempt is invalid. */
  function recordAttempt(slug, attempt) {
    var clean = cleanAttempt(attempt);
    if (!clean || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(slug)) return false;
    var data = read();
    var entry = data.exams[slug] || { attempts: [] };
    entry.attempts.unshift(clean);
    entry.attempts = entry.attempts.slice(0, MAX_ATTEMPTS);
    data.exams[slug] = entry;
    return write(data);
  }

  /** The most recent stored attempt for one exam, or null. Read before recording the new attempt to compare with it. */
  function lastAttempt(slug) {
    var entry = read().exams[slug];
    return entry && entry.attempts.length ? entry.attempts[0] : null;
  }

  function clear() {
    var store = storage();
    if (!store) return false;
    try {
      store.removeItem(KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  function exportJson() {
    return JSON.stringify(read(), null, 2);
  }

  globalObject.CertShieldLearnStore = {
    KEY: KEY,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    available: function available() { return storage() !== null; },
    read: read,
    recordAttempt: recordAttempt,
    lastAttempt: lastAttempt,
    clear: clear,
    exportJson: exportJson,
    cleanAttempt: cleanAttempt
  };
})(typeof window !== "undefined" ? window : this);
