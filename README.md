# CertShield Practice

Static GitHub Pages site for `https://practice.certshield.co.in/`.

The practice property is learning-first: free 30-question certification
readiness diagnostics with domain-level evidence, explanation-led review,
current course-specific offers, and contextual links to the full commercial
catalog at `certshield.co.in`.

## Sources of truth

The site is maintained with exactly three user-supplied inputs, identified
by header/structure, never by filename:

| Input | Identified by | Lifecycle |
|---|---|---|
| Monthly active-coupons CSV/XLSX | `course_id, course_name, coupon_type, ...` headers | Replace with the current Udemy active-coupon export when offers rotate. |
| Instructor-referral CSV/XLSX | `course_id, course_name, Referal URL for students` headers | Supplied on the first build and again only when a new course launches. |
| One 30-question assessment Markdown file per certification | `# Certification Practice Set` + `# Q#N \| Domain Name: ...` structure | Add one for a new certification; replace in place when an exam/blueprint changes. |

`data/course-overrides.json` supplies additional, already-verified
presentation metadata (vendor, category, main-site URL) reused from the
sibling `certshield.co.in` build. Nothing else is a real input — every file
under `data/`, `config/assessment-course-map.json`, and every generated HTML
page must never be hand-edited.

## Build, test, and preview

```powershell
python scripts/build.py --task-mode FRAMEWORK_BUILD --dry-run   # validate only
python scripts/build.py --task-mode FRAMEWORK_BUILD             # validate + publish
python -m unittest discover -s tests -v
python -m http.server 8000                                      # then open http://localhost:8000/
```

Or the equivalent `.vscode/tasks.json` tasks (Validate Inputs, Build
Framework, Upsert Assessment, Update Monthly Offers, Sync New Course, Run
Tests, Preview Site).

The build emits the homepage, `/assessments/`, `/assessments/<slug>/`,
`/offers/`, `/methodology/`, `/about/`, `404.html`, `sitemap.xml`, and every
`data/catalog/`, `data/assessments/`, `data/offers/` JSON file. Nothing is
written to disk unless every generated page passes validation first (atomic
publish) — a failed run leaves the previously published site untouched.

See [MAINTENANCE.md](MAINTENANCE.md) for the monthly/new-assessment workflow
and [docs/ASSESSMENT_FRAMEWORK.md](docs/ASSESSMENT_FRAMEWORK.md) for full
architecture documentation.
