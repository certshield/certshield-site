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
    refreshOffers(document, new Date());
  }

  window.CertShieldOffers = {
    copy: OFFER_COPY,
    fallbackCopy: FALLBACK_COPY,
    isOfferActive: isOfferActive,
    formatExpiry: formatExpiry,
    refreshOffers: refreshOffers
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise);
  } else {
    initialise();
  }
}());
