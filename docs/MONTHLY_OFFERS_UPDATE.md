# Monthly Offers Update

Run when a new `active_coupons_*.csv`/`.xlsx` export is dropped into the
repository root (any filename — it is identified by its headers).

```powershell
python scripts/build.py --task-mode MONTHLY_OFFERS_UPDATE
python -m unittest discover -s tests -v
```

This mode:

1. Discovers and validates the latest coupon export (Input A only — the
   referral sheet, Input B, is **not** required unless a genuinely new
   course ID appears that has no locked referral yet).
2. Replaces `data/offers/current.json` with every valid row from the new
   file and regenerates `/offers/index.html`.
3. Upserts `course_id`/`course_name` into `data/catalog/courses.json` for
   every row (new title text for an existing ID is logged as a title
   change, not treated as a different course).
4. Leaves every other assessment page's `lastReviewed` / `dateModified`
   untouched — a monthly offer rotation is not a content change to any
   assessment.
5. Re-resolves each published assessment's CTA against the new offer
   snapshot (an assessment whose course now has an active coupon will show
   it; one whose coupon just expired falls back to its locked referral URL,
   never a broken or stale coupon link).

## Offer status calculation (Offers page)

For each row, `render_site.py:render_offers_page` computes one of:

| Status | Condition |
|---|---|
| Upcoming | `now < start_date_time` |
| Within scheduled offer window | `start_date_time <= now < end_date_time` |
| Offer window ended | `now >= end_date_time` |
| Date unavailable | either date failed to parse |

`catalog_inputs.parse_iso_offer_datetime` parses the Udemy export's
`YYYY-MM-DD HH:MM <TZ>` format, including `PST`/`PDT`/`EST`/`EDT`/`UTC`/`GMT`
suffixes, into a timezone-aware value — comparisons are never done on naive
local time.

Access resolution mirrors the runtime CTA rule (section 11 of the master
prompt / `assessment-scoring.js:resolveCta`): the coupon URL is shown only
while the offer is within its scheduled window; otherwise the card falls
back to the course's locked referral URL. A coupon URL and a referral code
are never combined, and `maximum_redemptions` is displayed as a stated
maximum only — never as live remaining inventory.

## Friendly offer-type labels

One tested mapping table (`render_site.py:render_offers_page`,
`friendly_labels`): `free_targeted` → "Community Free Access", `free_open` →
"Flash Free Access", `best_price` (and its `current_best_price` alias) →
"Current Udemy Best Price", `custom_price` → "Instructor Special Price". A
`best_price`/`custom_price` row with a real non-zero `discount_price` shows
that price and currency as source-market context instead of an enrollment
count (a ₹0 placeholder or a raw coupon type/code/ID is never shown as a
primary column).
