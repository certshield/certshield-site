# CertShield Modular Diagnostic Assessment Framework

Architecture reference for the diagnostic-assessment engine built from
`CertShield_Modular_Diagnostic_Assessment_Framework_Reviewed_Prompt.md`.
See also: [ASSESSMENT_MD_FORMAT.md](ASSESSMENT_MD_FORMAT.md),
[COURSE_REFERRAL_IMPORT.md](COURSE_REFERRAL_IMPORT.md),
[MONTHLY_OFFERS_UPDATE.md](MONTHLY_OFFERS_UPDATE.md),
[GLOBAL_SEO_AND_SEARCH_DISCOVERY.md](GLOBAL_SEO_AND_SEARCH_DISCOVERY.md).

## The three inputs

The site is maintained with exactly three user-supplied inputs, identified by
header/structure, never by filename:

1. **Monthly active-coupons CSV/XLSX** (`course_id, course_name, coupon_type,
   maximum_redemptions, coupon_code, start_date_time, end_date_time,
   currency, discount_price, course_coupon_url`) — the current course
   inventory and current-month offer snapshot.
2. **Instructor-referral CSV/XLSX** (`course_id, course_name, Referal URL for
   students`) — the stable, locked `course_id -> instructor_referral_url`
   map. Supplied on the first build and again only for a new course.
3. **One `{Certification} 30-question practice set` Markdown file per
   certification** — see [ASSESSMENT_MD_FORMAT.md](ASSESSMENT_MD_FORMAT.md).

Nothing else is a real input. Generated JSON/HTML must never be hand-edited.

## Directory layout

```
config/
  certshield.project.json          task mode, site/SEO config, feature flags
  schema/certshield-project.schema.json
  assessment-course-map.json       generated: assessment_slug -> course_id
data/
  catalog/courses.json             generated: persistent course catalog
  catalog/referrals.json           generated: locked referral map
  assessments/manifest.json        generated: published-assessment index
  assessments/<slug>.json          generated: one assessment's full question data
  offers/current.json              generated: current monthly offer snapshot
  import-reports/                  generated: one report JSON per build run
assets/css/site.css                shared design system (extended, not replaced)
assets/js/core/assessment-scoring.js   pure scoring/readiness/CTA logic
assets/js/ui/assessment-runner.js      DOM runner (reads the JSON payload)
scripts/import/markdown_assessment.py  Input C parser + validator + sanitizer
scripts/import/catalog_inputs.py       Input A/B discovery + parsing
scripts/catalog.py                     catalog merge, referral lock, resolver
scripts/render_site.py                 static HTML page generation
scripts/build.py                       orchestrator (TASK_MODE dispatch)
tests/                                  pytest-free unittest + browser tests
```

An earlier flat-file pipeline (`scripts/build-site.py`,
`scripts/validate-site.py`, `data/courses.json`, `data/offers.json`,
`assets/js/catalog-data.js`, `assets/js/quiz.js`,
`data/questions/question-set.schema.json`, `certifications.html`,
`current-offers.html`) has been removed. The diagnostic-assessment framework
in this document is the only build pipeline in this repository —
`assets/js/core/assessment-scoring.js` / `assets/js/ui/assessment-runner.js`
and the Markdown-sourced `data/assessments/*.json` are the sole runner/data
mechanism.

## Build commands

```powershell
python scripts/build.py --task-mode FRAMEWORK_BUILD --dry-run   # validate only, write nothing
python scripts/build.py --task-mode FRAMEWORK_BUILD             # validate + publish
python -m unittest discover -s tests -v
python -m http.server 8000                                      # preview from repo root
```

Or via the VS Code tasks in `.vscode/tasks.json` (Validate Inputs, Build
Framework, Upsert Assessment, Update Monthly Offers, Sync New Course, Run
Tests, Production Build, Preview Site).

## Modes

| Mode | What it does |
|---|---|
| `FRAMEWORK_BUILD` | Full import of both catalog inputs + every discovered assessment Markdown file; rebuilds the entire catalog, every assessment page, the homepage, directory, offers page, methodology/about, sitemap. |
| `UPSERT_ASSESSMENT` | Same assessment import/validate/publish path, scoped to one Markdown file's atomic create-or-update (stable slug, no duplicate card/route). |
| `MONTHLY_OFFERS_UPDATE` | Replaces `data/offers/current.json` and the Offers page from the latest coupon file; does not require the referral sheet when no new course appears; does not touch unrelated assessment `lastReviewed` dates. |
| `NEW_COURSE_SYNC` | Imports both catalog inputs, appends new course IDs and locked referrals, and reports which new courses still need an assessment Markdown file. |

All four modes share the same importer/catalog/render pipeline in
`scripts/build.py`; only the CLI `--task-mode` flag and which inputs are
required differ.

## Atomic publish

Every run assembles the complete set of output pages and generated JSON in
memory first. `validate_staged_pages()` checks every staged HTML page for an
unresolved template placeholder, a `<title>`, and a well-formed document
(and validates `sitemap.xml` as XML) before anything is written to disk. If
validation fails, **no file is written** — the previous valid `data/`,
`config/assessment-course-map.json`, and published pages are left exactly as
they were. `data/assessments/<slug>.json`, `data/catalog/*.json`, and
`data/offers/current.json` all carry `schemaVersion`, a source hash, and an
import timestamp so a bad future run is diagnosable from the file itself.

## Assessment-to-course resolution

`scripts/catalog.py:resolve_assessment_course_mapping` compares an
assessment's vendor, certification name, exam code and source filename
against every catalog course's title (tokenized, stopword-filtered). A
mapping is auto-confirmed only when the top-scoring candidate is both above
an absolute confidence floor and clearly ahead of the runner-up; otherwise
the build reports the ranked candidates in the import report and leaves the
assessment published **without a commercial CTA** rather than guessing a
revenue-bearing destination. Once a slug's mapping is confirmed (auto or by
hand-editing `config/assessment-course-map.json`), it is retained across
future content updates to that same assessment.
