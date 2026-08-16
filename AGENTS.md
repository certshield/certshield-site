# AGENTS.md

CertShield Practice (`practice.certshield.co.in`) is a static, backend-free
site built entirely by the diagnostic-assessment framework: a Python
static-site generator that imports three inputs (monthly coupon CSV/XLSX,
instructor referral CSV/XLSX, and one 30-question certification Markdown
file per assessment) and generates the homepage, `/assessments/`,
`/assessments/<slug>/`, `/offers/`, `/methodology/`, `/about/`,
`sitemap.xml`, and every `data/` JSON file. Start at
[docs/ASSESSMENT_FRAMEWORK.md](docs/ASSESSMENT_FRAMEWORK.md).

An earlier flat-file pipeline (`scripts/build-site.py`,
`scripts/validate-site.py`, `data/questions/*.json`, `assets/js/quiz.js`,
`data/courses.json`, `data/offers.json`, `assets/js/catalog-data.js`,
`certifications.html`, `current-offers.html`) has been fully removed —
nothing in the active repo depends on it anymore.

## Commands

```powershell
python scripts/build.py --task-mode FRAMEWORK_BUILD --dry-run
python scripts/build.py --task-mode FRAMEWORK_BUILD
python -m unittest discover -s tests -v
python -m http.server 8000        # preview from the repo root
```

Or the `.vscode/tasks.json` tasks (Validate Inputs, Build Framework, Upsert
Assessment, Update Monthly Offers, Sync New Course, Run Tests, Production
Build, Preview Site).

## Documentation index

- [docs/ASSESSMENT_FRAMEWORK.md](docs/ASSESSMENT_FRAMEWORK.md) — architecture, directory layout, TASK_MODE dispatch, atomic publish.
- [docs/ASSESSMENT_MD_FORMAT.md](docs/ASSESSMENT_MD_FORMAT.md) — the exact Input C Markdown contract and validation rules.
- [docs/COURSE_REFERRAL_IMPORT.md](docs/COURSE_REFERRAL_IMPORT.md) — Input A/B contracts, locking, conflict handling.
- [docs/MONTHLY_OFFERS_UPDATE.md](docs/MONTHLY_OFFERS_UPDATE.md) — the recurring monthly-offer-rotation workflow.
- [docs/GLOBAL_SEO_AND_SEARCH_DISCOVERY.md](docs/GLOBAL_SEO_AND_SEARCH_DISCOVERY.md) — canonical URL policy, structured data, sitemap/robots, deployment checklist.

## Non-negotiables (do not violate these while editing this repo)

- Never hand-edit generated files (`data/**/*.json`, `config/assessment-course-map.json`, any HTML between `GENERATED:` markers or produced by `scripts/build.py`). Edit the three inputs and rerun the build.
- Never fabricate a course ID, URL, price, date, or vendor/category label. An unclassified course stays `"Unclassified"`.
- Never combine a coupon URL and a referral code, or overwrite a locked referral URL without an explicit, human-authorized migration.
- Never render a broken or guessed commercial link — an assessment with an unresolved course mapping publishes with no CTA, not a guessed one.
