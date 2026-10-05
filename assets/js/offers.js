(function () {
  'use strict';

  const OFFER_COPY = Object.freeze({
    free_targeted: {
      label: 'Community Free Access',
      cta: 'Claim Community Seat',
      defaultLimit: 'Up to 100 free enrollments',
      note: 'Selected as part of CertShield\'s community initiative.'
    },
    free_open: {
      label: 'Flash Free Access',
      cta: 'Claim Free Seat',
      defaultLimit: 'Up to 10 free enrollments',
      note: 'Very limited community release.'
    },
    best_price: {
      label: 'Best Available Udemy Price',
      cta: 'Get Best Price',
      defaultLimit: 'Limited-time instructor offer',
      note: 'Udemy displays the applicable price for your market.'
    },
    custom_price: {
      label: 'CertShield Instructor Special',
      cta: 'View Special Offer',
      defaultLimit: 'Extended instructor offer',
      note: 'Udemy displays the applicable price for your market.'
    }
  });

  const FALLBACK_COPY = Object.freeze({
    label: 'Full Practice Exam',
    cta: 'View Current Course',
    note: 'No special offer is currently active for this course.'
  });

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isOfferActive(offer, now) {
    const current = now instanceof Date ? now : new Date(now || Date.now());
    const start = parseDate(offer.startAt);
    const end = parseDate(offer.endAt);
    return Boolean(
      OFFER_COPY[offer.offerType] &&
      offer.couponUrl &&
      start &&
      end &&
      start.getTime() <= current.getTime() &&
      current.getTime() < end.getTime()
    );
  }

  function formatExpiry(value) {
    const date = parseDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('en', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(date);
  }

  function offerFromCard(card) {
    const cta = card.querySelector('[data-offer-cta]');
    return {
      offerType: card.getAttribute('data-offer-type') || '',
      couponUrl: card.getAttribute('data-coupon-url') || (cta ? cta.getAttribute('href') : ''),
      startAt: card.getAttribute('data-start-at') || '',
      endAt: card.getAttribute('data-end-at') || '',
      redemptionLimit: Number(card.getAttribute('data-redemption-limit')) || null,
      displayPriceText: card.getAttribute('data-display-price-text') || ''
    };
  }

  function setText(root, selector, text) {
    const element = root.querySelector(selector);
    if (element && text) element.textContent = text;
  }

  function renderActiveCard(card, offer) {
    const copy = OFFER_COPY[offer.offerType];
    const expiry = formatExpiry(offer.endAt);
    const cta = card.querySelector('[data-offer-cta]');
    const limit = offer.offerType === 'free_targeted' || offer.offerType === 'free_open'
      ? 'Up to ' + String(offer.redemptionLimit || (offer.offerType === 'free_targeted' ? 100 : 10)) + ' free enrollments'
      : (offer.displayPriceText || copy.defaultLimit);

    card.setAttribute('data-runtime-expired', 'false');
    card.removeAttribute('hidden');
    setText(card, '[data-offer-badge]', copy.label);
    setText(card, '[data-offer-limit]', limit);
    setText(card, '[data-offer-note]', copy.note);
    if (expiry) {
      const expiryText = (offer.offerType === 'free_targeted' || offer.offerType === 'free_open')
        ? 'Available until ' + expiry + ' or until Udemy\'s redemption limit is reached.'
        : 'Available until ' + expiry + '.';
      setText(card, '[data-offer-expiry]', expiryText);
    }
    if (cta) {
      cta.textContent = copy.cta;
      cta.setAttribute('href', offer.couponUrl);
      cta.setAttribute('data-offer-type', offer.offerType);
    }
  }

  function renderFallback(card) {
    const fallbackUrl = card.getAttribute('data-fallback-url');
    const mainSiteUrl = card.getAttribute('data-main-site-url');
    const cta = card.querySelector('[data-offer-cta]');
    const expiry = card.querySelector('[data-offer-expiry]');
    const limit = card.querySelector('[data-offer-limit]');

    card.setAttribute('data-runtime-expired', 'true');
    setText(card, '[data-offer-badge]', FALLBACK_COPY.label);
    setText(card, '[data-offer-note]', FALLBACK_COPY.note);
    if (expiry) expiry.textContent = '';
    if (limit) limit.textContent = '';
    if (cta) {
      cta.textContent = FALLBACK_COPY.cta;
      cta.setAttribute('href', fallbackUrl || mainSiteUrl || 'assessments/');
      cta.removeAttribute('data-offer-type');
    }
  }

  // --- Offers page: one row per offer window (Live / Scheduled / Expired) ---
  // The page is static HTML rendered at build time, so each row carries its
  // own UTC start/end stamps and is re-evaluated here against the visitor's
  // clock. That is what lets Scheduled -> Live -> Expired flip on schedule
  // with no rebuild. Mirrors offers_page_status() and the card/row ordering
  // in scripts/render_site.py - keep both in sync if either changes.

  const OFFER_ROW_RANK = Object.freeze({ live: 0, scheduled: 1, expired: 2 });
  const OFFER_ROW_STATUS_LABEL = Object.freeze({ live: 'Live', scheduled: 'Scheduled', expired: 'Expired' });
  const OFFER_ROW_LIVE_LABEL = 'Enroll on Udemy';

  function offerRowStatus(startAt, endAt, now) {
    const current = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
    const start = parseDate(startAt);
    const end = parseDate(endAt);
    if (start && end && start.getTime() <= current && current < end.getTime()) return 'live';
    if (start && current < start.getTime()) return 'scheduled';
    return 'expired';
  }

  function compareNumbers(a, b) {
    return a === b ? 0 : (a < b ? -1 : 1);
  }

  function offerRowTimes(row) {
    const start = parseDate(row.getAttribute('data-start-at'));
    const end = parseDate(row.getAttribute('data-end-at'));
    return {
      rank: OFFER_ROW_RANK[row.getAttribute('data-status')],
      start: start ? start.getTime() : Infinity,
      end: end ? end.getTime() : Infinity
    };
  }

  function setOfferRowAction(row, status) {
    const slot = row.querySelector('[data-offer-action]');
    if (!slot) return;
    const couponUrl = row.getAttribute('data-coupon-url') || '';
    let control;

    if (status === 'live' && couponUrl.indexOf('https://') === 0) {
      control = document.createElement('a');
      control.className = 'button offer-cta';
      control.setAttribute('href', couponUrl);
      control.setAttribute('target', '_blank');
      control.setAttribute('rel', 'noopener sponsored');
      control.textContent = OFFER_ROW_LIVE_LABEL;
      const courseId = row.getAttribute('data-course-id');
      if (courseId) {
        control.setAttribute('data-ga-cta', '1');
        control.setAttribute('data-cta-kind', 'coupon');
        control.setAttribute('data-offer-type', row.getAttribute('data-offer-type') || '');
        control.setAttribute('data-course-id', courseId);
      }
    } else {
      control = document.createElement('button');
      control.type = 'button';
      control.className = 'button offer-cta offer-cta-disabled';
      control.disabled = true;
      if (status === 'scheduled') {
        control.textContent = row.getAttribute('data-label-scheduled') || 'Scheduled';
      } else {
        control.textContent = status === 'live' ? 'Unavailable' : 'Expired';
      }
    }

    while (slot.firstChild) slot.removeChild(slot.firstChild);
    slot.appendChild(control);
  }

  function offerCardKey(card) {
    const rows = Array.from(card.querySelectorAll('[data-offer-row]')).map(offerRowTimes);
    const best = rows.reduce(function (rank, row) { return Math.min(rank, row.rank); }, 2);
    const group = rows.filter(function (row) { return row.rank === best; });
    let when;
    if (best === OFFER_ROW_RANK.live) {
      when = group.reduce(function (value, row) { return Math.min(value, row.end); }, Infinity);
    } else if (best === OFFER_ROW_RANK.scheduled) {
      when = group.reduce(function (value, row) { return Math.min(value, row.start); }, Infinity);
    } else {
      when = -group.reduce(function (value, row) { return Math.max(value, row.end); }, -Infinity);
    }
    return { rank: best, when: when, name: (card.getAttribute('data-course-name') || '').toLowerCase() };
  }

  function refreshOfferRows(root, now) {
    const scope = root || document;
    const current = now instanceof Date ? now : new Date(now || Date.now());
    let changed = false;

    scope.querySelectorAll('[data-offer-row]').forEach(function (row) {
      const status = offerRowStatus(row.getAttribute('data-start-at'), row.getAttribute('data-end-at'), current);
      if (row.getAttribute('data-status') === status) return;
      changed = true;
      row.setAttribute('data-status', status);
      setText(row, '[data-offer-status]', OFFER_ROW_STATUS_LABEL[status]);
      setOfferRowAction(row, status);
    });
    if (!changed) return false;

    // Live -> Scheduled -> Expired inside every card, then earliest start.
    scope.querySelectorAll('[data-offer-row-list]').forEach(function (list) {
      Array.from(list.querySelectorAll('[data-offer-row]'))
        .sort(function (a, b) {
          const left = offerRowTimes(a);
          const right = offerRowTimes(b);
          return compareNumbers(left.rank, right.rank) || compareNumbers(left.start, right.start);
        })
        .forEach(function (row) { list.appendChild(row); });
    });

    const counts = { live: 0, scheduled: 0 };
    scope.querySelectorAll('.offer-card').forEach(function (card) {
      const statuses = [];
      card.querySelectorAll('[data-offer-row]').forEach(function (row) {
        const status = row.getAttribute('data-status');
        if (statuses.indexOf(status) === -1) statuses.push(status);
      });
      statuses.sort(function (a, b) { return OFFER_ROW_RANK[a] - OFFER_ROW_RANK[b]; });
      card.setAttribute('data-status', statuses.join('|'));
      if (statuses.indexOf('live') !== -1) counts.live += 1;
      if (statuses.indexOf('scheduled') !== -1) counts.scheduled += 1;
    });

    // Best status first across cards, so Live offers always lead the grid.
    scope.querySelectorAll('[data-offer-grid]').forEach(function (grid) {
      Array.from(grid.querySelectorAll('.offer-card'))
        .map(function (card) { return { card: card, key: offerCardKey(card) }; })
        .sort(function (a, b) {
          return compareNumbers(a.key.rank, b.key.rank) ||
            compareNumbers(a.key.when, b.key.when) ||
            compareNumbers(a.key.name, b.key.name);
        })
        .forEach(function (entry) { grid.appendChild(entry.card); });
    });

    ['live', 'scheduled'].forEach(function (key) {
      scope.querySelectorAll('[data-offers-stat="' + key + '"]').forEach(function (stat) {
        setText(stat, '.offer-stat-value', String(counts[key]));
        stat.hidden = counts[key] === 0;
      });
    });
    return true;
  }

  // --- Assessment pages: never leave an expired coupon showing as live ---
  // The offer card on an assessment page is a build-time snapshot. Once its
  // live window has closed this hides every coupon-specific element (and the
  // hero "currently free" line), keeps the referral link as a plain course
  // link, and sends the visitor to /offers/, which is always current.
  function expireStaleAssessmentOffers(root, now) {
    const scope = root || document;
    const current = now instanceof Date ? now : new Date(now || Date.now());
    scope.querySelectorAll('[data-offer-live-until]').forEach(function (card) {
      const until = parseDate(card.getAttribute('data-offer-live-until'));
      if (!until || current.getTime() < until.getTime() || card.hasAttribute('data-offer-ended')) return;
      card.setAttribute('data-offer-ended', 'true');

      card.querySelectorAll(
        '.offer-badge, .offer-urgency, .offer-tier-list, .assessment-cta-disclosure, a.button-primary'
      ).forEach(function (node) { node.hidden = true; });
      scope.querySelectorAll('.hero-offer-note').forEach(function (node) { node.hidden = true; });

      const referral = card.querySelector('[data-cta-kind="referral"]');
      if (referral) referral.textContent = 'View the full course on Udemy ↗';

      const note = document.createElement('p');
      note.className = 'offer-urgency';
      note.textContent = 'The offer shown here has ended. ';
      const link = document.createElement('a');
      link.setAttribute('href', card.getAttribute('data-offers-url') || '../../offers/');
      link.textContent = 'See current offers and dates';
      note.appendChild(link);
      const heading = card.querySelector('h3');
      card.insertBefore(note, heading ? heading.nextSibling : card.firstChild);
    });
  }

  function refreshOffers(root, now) {
    const scope = root || document;
    const cards = Array.from(scope.querySelectorAll('[data-offer-card]'));
    let activeListings = 0;

    cards.forEach(function (card) {
      const offer = offerFromCard(card);
      const active = isOfferActive(offer, now);
      const listing = card.getAttribute('data-offer-scope') === 'listing';

      if (active) {
        renderActiveCard(card, offer);
        if (listing) activeListings += 1;
      } else if (listing) {
        card.setAttribute('data-runtime-expired', 'true');
        card.hidden = true;
      } else {
        renderFallback(card);
      }
    });

    scope.querySelectorAll('[data-no-active-offers]').forEach(function (empty) {
      empty.hidden = activeListings !== 0;
    });
    scope.querySelectorAll('[data-filter-root]').forEach(function (filterRoot) {
      filterRoot.dispatchEvent(new CustomEvent('certshield:offers-updated', {
        detail: { activeListings: activeListings }
      }));
    });
    return activeListings;
  }

  function initialise() {
    // Rows first: refreshOffers() then notifies the filter engine, which
    // re-reads each card's (possibly just-updated) data-status.
    expireStaleAssessmentOffers(document, new Date());
    refreshOfferRows(document, new Date());
    refreshOffers(document, new Date());

    // Keep an open tab honest when a window opens or closes while it is read.
    if (document.querySelector('[data-offer-row], [data-offer-live-until]')) {
      window.setInterval(function () {
        const now = new Date();
        expireStaleAssessmentOffers(document, now);
        if (!refreshOfferRows(document, now)) return;
        document.querySelectorAll('[data-filter-root]').forEach(function (filterRoot) {
          filterRoot.dispatchEvent(new CustomEvent('certshield:offers-updated', { detail: {} }));
        });
      }, 60000);
    }
  }

  window.CertShieldOffers = {
    copy: OFFER_COPY,
    fallbackCopy: FALLBACK_COPY,
    isOfferActive: isOfferActive,
    formatExpiry: formatExpiry,
    offerRowStatus: offerRowStatus,
    refreshOfferRows: refreshOfferRows,
    expireStaleAssessmentOffers: expireStaleAssessmentOffers,
    refreshOffers: refreshOffers
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise);
  } else {
    initialise();
  }
}());
