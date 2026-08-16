# CertShield Practice maintenance

Full architecture and rules live in `docs/`:
[ASSESSMENT_FRAMEWORK.md](docs/ASSESSMENT_FRAMEWORK.md) ·
[ASSESSMENT_MD_FORMAT.md](docs/ASSESSMENT_MD_FORMAT.md) ·
[COURSE_REFERRAL_IMPORT.md](docs/COURSE_REFERRAL_IMPORT.md) ·
[MONTHLY_OFFERS_UPDATE.md](docs/MONTHLY_OFFERS_UPDATE.md) ·
[GLOBAL_SEO_AND_SEARCH_DISCOVERY.md](docs/GLOBAL_SEO_AND_SEARCH_DISCOVERY.md).
This page is the short, practical version of the three recurring tasks.

## Updating monthly offers

1. Download the current active-coupons CSV/XLSX from Udemy. Keep its
   original headers (`course_id`, `coupon_type`, `start_date_time`,
   `end_date_time`, `maximum_redemptions`, `course_coupon_url`, ...).
2. Drop the file in the repository root (any filename — it's identified by
   its headers, not its name). Remove/archive the prior export.
3. Run:
   ```powershell
   python scripts/build.py --task-mode MONTHLY_OFFERS_UPDATE
   python -m unittest discover -s tests -v
   ```
4. Review the printed warnings/errors and the report in
   `data/import-reports/`. Spot-check `/offers/` and one assessment page's
   CTA before publishing.

The instructor-referral sheet is **not** required for this unless a
genuinely new `course_id` appears with no locked referral yet — the build
will tell you (`referralRequiredForNewCourse` in the report) if that
happens.

## Adding a new 30-question assessment

1. Write `<something>-30-question-practice-set.md` following the exact
   contract in [docs/ASSESSMENT_MD_FORMAT.md](docs/ASSESSMENT_MD_FORMAT.md) —
   metadata block, 30 sequential `# Q#N | Domain Name: ...` questions, and
   all ten required `##` learning sections plus at least one HTTPS official
   reference per question.
2. Drop it in the repository root.
3. Run:
   ```powershell
   python scripts/build.py --task-mode UPSERT_ASSESSMENT
   python -m unittest discover -s tests -v
   ```
4. Check the import report: a validation error blocks that assessment from
   publishing (nothing else is affected). An ambiguous course-mapping
   warning means the build could not confidently link the assessment to a
   course — it still publishes, just without a commercial CTA, until you
   confirm the mapping in `config/assessment-course-map.json`.
5. Test the published page: full 30-question flow (timed and untimed),
   unanswered-submission validation, exact-set MSQ scoring, readiness
   safeguards, review filters, resume/restart, print view, keyboard use,
   mobile layout, and the no-JavaScript fallback content.

Re-running the same certification's Markdown (same resolved slug) is
treated as a version update, not a second assessment — the URL, card, and
course mapping stay stable, and any in-progress local attempt against the
old content is discarded with an explicit notice rather than silently
resumed.

## Adding or updating course metadata

Course inventory itself always comes from the monthly coupon file — there is
no separate "add a course" step. To improve a course's vendor/category/
main-site-URL beyond the honest `"Unclassified"` default, add or edit its
entry in `data/course-overrides.json`, keyed by the Udemy course slug (the
`/course/<slug>/` segment of its URL). Never invent a value there — leave a
field out entirely if it isn't genuinely known.

## Safe empty states

- No assessment yet for a course: a non-linked "Diagnostic Coming Soon" card
  on `/assessments/` and the homepage — never a thin, indexable placeholder
  page.
- No active offer for a course with an assessment: the CTA falls back to
  the locked referral URL; if neither exists, no commercial button renders.
- Malformed input data: the build reports the error and fails that specific
  item (or the whole run, for a structural failure) rather than publishing
  fabricated or ambiguous content.
