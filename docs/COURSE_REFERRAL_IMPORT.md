# Course Catalog and Referral Import (Inputs A & B)

## Input A — monthly active-coupons file

Identified by headers (not filename): `course_id, course_name, coupon_type,
maximum_redemptions, coupon_code, start_date_time, end_date_time, currency,
discount_price, course_coupon_url`.

Authoritative for: the current course inventory, current display names, and
the current month's offer rows. Every run **replaces** the current offer
snapshot (`data/offers/current.json`) with every valid row from the latest
file, and **upserts** `course_id`/`course_name` into the persistent catalog
(`data/catalog/courses.json`). A course missing from a later export is never
deleted — it is kept with `presentInLatestCouponExport: false` and simply
omitted from the current-offers listing.

Supported `coupon_type` values: `free_targeted`, `free_open`, `best_price`,
`custom_price` (also accepts the `current_best_price` spelling as an alias of
`best_price` through one tested mapping table — see
`catalog_inputs.OFFER_TYPE_ALIASES`).

## Input B — instructor-referral file

Identified by headers: `course_id, course_name, Referal URL for students`
(the supplied misspelling; `Referral URL for students` is also accepted).
Normalized internally to `instructor_referral_url`.

Authoritative **only** for the stable `course_id -> instructor_referral_url`
map. Rules enforced by `scripts/catalog.py:build_course_catalog`:

- Joined by `course_id` as a string, **never** by course name — the two
  input files can legitimately disagree on a course's display name for the
  same ID (this is a real, currently-live fact in this catalog: course
  `5885448` is `"GCP Professional Cloud Network Engineer Practice Exams
  2026"` in the coupon export and `"Google Cloud Network Engineer
  Certification Tests 2026"` in the referral sheet — informational, not a
  join failure).
- Each referral URL is **locked** after its first successful import.
- A later referral file may append a brand-new course ID.
- If an existing course ID reappears with a *different* URL, that is a
  high-severity conflict: it is reported in the run's import report and the
  **locked URL is retained**. Nothing overwrites a locked referral URL
  automatically — that requires a deliberate, explicit migration.
- A coupon-export course ID with no referral record is reported as
  `referral_required_for_new_course`.

## Verified presentation metadata (not a 4th input)

`data/course-overrides.json` — the pre-existing, human-curated metadata file
already used by the sibling `certshield.co.in` build — is reused (not
treated as a new required input) as an optional, already-verified source of
`vendor` / `category` / `certificationName` / `mainSiteUrl`, matched by
Udemy course slug (`scripts/catalog.py:udemy_course_slug`, extracted from
`course_coupon_url`). A course with no override and no assessment Markdown
metadata is left with `vendor: "Unclassified"` and
`metadataSource: "unclassified"` — **never guessed** from the course title.

## Idempotency and failure isolation

Re-running the build against the same two input files is a no-op (the
catalog and referral state are keyed by content, not by "did we run
before"). A row-level parse error (bad coupon type, non-HTTPS URL, missing
`referralCode` query parameter, etc.) is recorded per-row and that row is
skipped; it does not abort the whole import. A structural failure (e.g. no
coupon file found at all) aborts before any file is written, so a failed
import can never replace the last valid catalog/referral/offer data — see
"Atomic publish" in [ASSESSMENT_FRAMEWORK.md](ASSESSMENT_FRAMEWORK.md).
