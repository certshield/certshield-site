(function () {
  'use strict';

  const SELECTORS = {
    navToggle: '[data-nav-toggle]',
    nav: '[data-site-nav]',
    courseSearch: '[data-course-search]',
    courseSearchResults: '[data-course-search-results]',
    filterRoot: '[data-filter-root]',
    filterItem: '[data-filter-item]'
  };

  function normalise(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, ' ')
      .trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[character];
    });
  }

  function getCatalog() {
    const candidates = [
      window.CERTSHIELD_DATA,
      window.CertShieldData,
      window.certShieldData,
      window.CERTSHIELD_CATALOG
    ];
    const source = candidates.find(Boolean) || {};
    if (Array.isArray(source)) return source;
    return Array.isArray(source.courses) ? source.courses : [];
  }

  function searchText(course) {
    return normalise([
      course.certificationName,
      course.shortName,
      course.vendor,
      course.examCode,
      course.category,
      course.subcategory,
      ...(Array.isArray(course.aliases) ? course.aliases : [])
    ].join(' '));
  }

  function rankCourse(course, query) {
    const text = searchText(course);
    const words = normalise(query).split(/\s+/).filter(Boolean);
    if (!words.length || !words.every(function (word) { return text.includes(word); })) return -1;

    const code = normalise(course.examCode);
    const shortName = normalise(course.shortName);
    const name = normalise(course.certificationName);
    const compactQuery = normalise(query);
    let score = course.featured ? 4 : 0;
    if (code && compactQuery === code) score += 100;
    if (shortName && compactQuery === shortName) score += 80;
    if (name.startsWith(compactQuery)) score += 45;
    if (shortName.startsWith(compactQuery)) score += 35;
    if (code && code.includes(compactQuery)) score += 30;
    if (course.practiceAvailable) score += 8;
    score += Math.max(0, 12 - name.length / 15);
    return score;
  }

  function addMainSiteTracking(url, course, campaign) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.hostname !== 'certshield.co.in' && parsed.hostname !== 'www.certshield.co.in') return url;
      parsed.searchParams.set('utm_source', 'certshield_practice');
      parsed.searchParams.set('utm_medium', 'referral');
      parsed.searchParams.set('utm_campaign', campaign || 'certification_search');
      parsed.searchParams.set('utm_content', course.slug || course.courseId || 'course');
      return parsed.toString();
    } catch (error) {
      return url;
    }
  }

  function courseDestination(course) {
    if (course.practiceAvailable && course.practicePageUrl) return course.practicePageUrl;
    if (course.mainSiteUrl) return addMainSiteTracking(course.mainSiteUrl, course, 'certification_search');
    return course.udemyReferralUrl || 'assessments/';
  }

  function renderSearchResults(container, courses, query) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    const matches = courses
      .map(function (course) { return { course: course, score: rankCourse(course, cleanQuery) }; })
      .filter(function (entry) { return entry.score >= 0; })
      .sort(function (left, right) {
        return right.score - left.score || String(left.course.certificationName).localeCompare(String(right.course.certificationName));
      })
      .slice(0, 8);

    container.hidden = false;
    if (!matches.length) {
      container.innerHTML = '<div class="empty-state" role="status"><strong>No matching CertShield practice set found.</strong>' +
        '<p>Try a vendor, certification name, or exam code. You can also browse the complete directory.</p>' +
        '<div class="card-actions"><a class="button button-secondary" href="assessments/">Browse all assessments</a>' +
        '<a class="button button-text" href="https://certshield.co.in/?utm_source=certshield_practice&amp;utm_medium=referral&amp;utm_campaign=certification_search">Explore full practice exams</a></div></div>';
      return;
    }

    container.innerHTML = matches.map(function (entry) {
      const course = entry.course;
      const meta = [course.vendor, course.examCode, course.category].filter(Boolean).join(' · ');
      const availability = course.practiceAvailable
        ? String(course.practiceQuestionCount || '') + (Number(course.practiceQuestionCount) === 1 ? ' free question' : ' free questions')
        : 'Free practice coming soon';
      const cta = course.practiceAvailable ? 'Practice Free' : 'View Full Practice Exam';
      return '<article class="search-result">' +
        '<div><strong>' + escapeHtml(course.certificationName || course.shortName) + '</strong>' +
        '<span>' + escapeHtml(meta) + ' · ' + escapeHtml(availability) + '</span></div>' +
        '<a class="button button-secondary" href="' + escapeHtml(courseDestination(course)) + '" data-course-id="' + escapeHtml(course.courseId) + '" data-cta-location="certification_search" data-page-type="search">' + escapeHtml(cta) + '</a>' +
        '</article>';
    }).join('');
  }

  function initialiseCourseSearch() {
    const input = document.querySelector(SELECTORS.courseSearch);
    const results = document.querySelector(SELECTORS.courseSearchResults);
    if (!input || !results) return;

    const courses = getCatalog();
    const form = input.closest('form');
    let timer;

    function update() {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        renderSearchResults(results, courses, input.value);
      }, 90);
    }

    input.addEventListener('input', update);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        input.value = '';
        renderSearchResults(results, courses, '');
      }
    });
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        renderSearchResults(results, courses, input.value);
        const firstLink = results.querySelector('a');
        if (firstLink) firstLink.focus();
      });
    }

    const query = new URLSearchParams(window.location.search).get('q');
    if (query) {
      input.value = query;
      renderSearchResults(results, courses, query);
    }
  }

  function initialiseFilters(root) {
    const search = root.querySelector('[data-filter-search]');
    const items = Array.from(root.querySelectorAll(SELECTORS.filterItem));
    const groups = Array.from(root.querySelectorAll('[data-filter-group]'));
    const count = root.querySelector('[data-result-count]');
    const empty = root.querySelector('[data-filter-empty]');
    const state = {};

    groups.forEach(function (group) {
      const name = group.getAttribute('data-filter-group');
      state[name] = 'all';
      group.addEventListener('click', function (event) {
        const button = event.target.closest('[data-filter-value]');
        if (!button) return;
        state[name] = button.getAttribute('data-filter-value') || 'all';
        group.querySelectorAll('[data-filter-value]').forEach(function (candidate) {
          candidate.setAttribute('aria-pressed', String(candidate === button));
        });
        apply();
      });
    });

    function apply() {
      const queryWords = normalise(search ? search.value : '').split(/\s+/).filter(Boolean);
      const isActiveSearch = queryWords.length > 0 || Object.keys(state).some(function (name) { return state[name] && state[name] !== 'all'; });
      let visible = 0;
      let runtimeAvailable = 0;

      items.forEach(function (item) {
        if (item.getAttribute('data-runtime-expired') !== 'true') runtimeAvailable += 1;
        const text = normalise(item.getAttribute('data-search') || item.textContent);
        const matchesText = queryWords.every(function (word) { return text.includes(word); });
        const matchesGroups = Object.keys(state).every(function (name) {
          const expected = state[name];
          if (!expected || expected === 'all') return true;
          const actualValues = String(item.getAttribute('data-' + name) || '')
            .split('|')
            .map(normalise)
            .filter(Boolean);
          return actualValues.includes(normalise(expected));
        });
        const show = matchesText && matchesGroups && item.getAttribute('data-runtime-expired') !== 'true';
        item.hidden = !show;
        if (show) {
          visible += 1;
          // Only auto-open for a genuine active search/filter match inside a
          // collapsed <details> (e.g. the "coming soon" disclosure) - a
          // closed <details> hides its content regardless of the item's own
          // hidden state, so a real match must still reach the person who
          // searched for it. With no active search, "visible" just means
          // "not filtered out", which must NOT force every disclosure open
          // on a plain page load. Never auto-closes: opening is a one-way
          // reveal so nothing collapses while someone's reading it.
          if (isActiveSearch) {
            const details = item.closest('details');
            if (details && !details.open) details.open = true;
          }
        }
      });

      if (count) count.textContent = visible + (visible === 1 ? ' result' : ' results');
      if (empty) empty.hidden = visible !== 0 || runtimeAvailable === 0;
      root.dispatchEvent(new CustomEvent('certshield:filter-updated', { detail: { visible: visible } }));
    }

    if (search) {
      const query = new URLSearchParams(window.location.search).get('q');
      if (query) search.value = query;
      search.addEventListener('input', apply);
    }
    root.addEventListener('certshield:offers-updated', apply);
    apply();
  }

  function initialiseNavigation() {
    const toggle = document.querySelector(SELECTORS.navToggle);
    const nav = document.querySelector(SELECTORS.nav);
    if (!toggle || !nav) return;

    function close() {
      nav.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function () {
      const open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!open));
      toggle.setAttribute('aria-expanded', String(!open));
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
    const desktopMedia = window.matchMedia('(min-width: 62.01rem)');
    if (typeof desktopMedia.addEventListener === 'function') desktopMedia.addEventListener('change', close);
    else if (typeof desktopMedia.addListener === 'function') desktopMedia.addListener(close);
  }

  function initialiseYears() {
    document.querySelectorAll('[data-current-year]').forEach(function (element) {
      element.textContent = String(new Date().getFullYear());
    });
  }

  function initialise() {
    initialiseNavigation();
    initialiseYears();
    initialiseCourseSearch();
    document.querySelectorAll(SELECTORS.filterRoot).forEach(initialiseFilters);
    document.documentElement.classList.add('js-ready');
  }

  window.CertShieldSite = {
    normalise: normalise,
    rankCourse: rankCourse,
    addMainSiteTracking: addMainSiteTracking,
    initialiseFilters: initialiseFilters
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise);
  } else {
    initialise();
  }
}());
