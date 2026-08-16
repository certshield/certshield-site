# CertShield Modular Diagnostic Assessment Framework

## Production-focused Codex master prompt

Act as a senior frontend architect, assessment-platform engineer, UX/accessibility specialist, data-import engineer, and technical SEO engineer.

Work directly in the current VS Code workspace containing the CertShield GitHub Pages repository and the supplied input files. Inspect, implement, test, and visually verify the result. Do not stop after producing a plan.

Build one innovative, reusable static diagnostic-assessment engine. The user will maintain it with only three input types:

1. A monthly active-coupons CSV/XLSX containing the complete current course list and offer data.
2. A long-lived instructor-referral CSV/XLSX, supplied during the first build and again only when a new course is launched.
3. One certification-specific 30-question Markdown file for every new or revised assessment.

Questions, courses, links, and offer rows must never be hand-coded into HTML.

---

## 1. Run configuration

Use this block for the current run:

```yaml
TASK_MODE: FRAMEWORK_BUILD
# FRAMEWORK_BUILD | UPSERT_ASSESSMENT | MONTHLY_OFFERS_UPDATE | NEW_COURSE_SYNC

WORKSPACE_ROOT: .
INPUT_DISCOVERY: AUTO

SITE:
  BRAND: CertShield
  PRACTICE_URL: https://practice.certshield.co.in/
  MAIN_URL: https://certshield.co.in/
  CUSTOM_DOMAIN: practice.certshield.co.in
  UDEMY_INSTRUCTOR: Priya D

SEO:
  CANONICAL_ORIGIN: https://practice.certshield.co.in
  DEFAULT_LANGUAGE: en
  GLOBAL_AUDIENCE: true
  INDEXNOW_ENABLED: false

ACTIONS:
  DEPLOY: false
  PUSH: false
  CREATE_PR: false
```

Rules:

- Treat the current directory as the repository root unless inspection proves otherwise.
- Discover files already available in the workspace. Do not ask the user to paste their paths.
- Use repository-relative paths in generated configuration, never local absolute paths.
- Work locally unless the corresponding action is explicitly `true`.
- Preserve unrelated user changes and the existing `CNAME`.
- Never invent questions, answers, course IDs, URLs, prices, certification metadata, or official references.

### Modes

| Mode | Required behavior |
|---|---|
| `FRAMEWORK_BUILD` | Refactor the existing site, import the coupon catalog, lock the referral catalog, import the valid assessment Markdown present in the workspace, and create the shared engine, importers, tests, documentation, and VS Code tasks. |
| `UPSERT_ASSESSMENT` | Import one new or updated certification Markdown file. Create a new assessment or atomically update the existing one without duplicating its card or route; refresh its static landing HTML, metadata, truthful modification date, internal links, and sitemap entry. |
| `MONTHLY_OFFERS_UPDATE` | Replace the current monthly offer snapshot from the latest coupon file, upsert new/current course names, and refresh the Offers HTML/metadata without changing unrelated assessment modification dates. Do not require the referral sheet when no new course is present. |
| `NEW_COURSE_SYNC` | Import the updated coupon and referral files, append new course IDs and locked referral URLs, then report any unmapped new courses. |

---

## 2. The only three user-supplied inputs

### Input A — Monthly active-coupons file

Identify it by these headers, not its filename:

```text
course_id
course_name
coupon_type
maximum_redemptions
coupon_code
start_date_time
end_date_time
currency
discount_price
course_coupon_url
```

This file is authoritative for:

- the current course inventory;
- current course display names;
- the current month's offer rows;
- coupon types, limits, dates, prices, currencies, codes, and coupon URLs.

Every monthly update replaces the current offer snapshot with all valid rows from the latest file. At the same time, upsert `course_id` and `course_name` into the persistent course catalog. A course absent from a later monthly file must not cause its assessment or locked referral record to be deleted; mark it as absent from the latest snapshot and omit it only from the current offer table.

### Input B — Instructor-referral file

Identify it by:

```text
course_id
course_name
Referal URL for students
```

Accept the supplied misspelling `Referal URL for students` and documented aliases such as `Referral URL for students`, but normalize internally to:

```text
instructor_referral_url
```

This file is authoritative only for the stable `course_id → instructor_referral_url` mapping.

Referral rules:

- Import it during the first framework build.
- Join by `course_id` stored as a string, never by course name.
- Lock each referral URL after its first successful import.
- A later referral file may append a new course ID.
- If an existing course ID is paired with a different referral URL, report a high-severity conflict and retain the locked URL. Never overwrite it without explicit user-authorized migration.
- Treat `course_name` in this file as a reconciliation aid, not the canonical current title.
- Preserve the complete HTTPS Udemy URL and its `referralCode` query parameter.

### Input C — Certification assessment Markdown

Identify it by all of these structural signals:

- `# Certification Practice Set`;
- certification metadata near the beginning;
- question headings formatted as `# Q#N | Domain Name: <domain>`;
- answer and explanation sections described in section 7.

This file is authoritative for certification metadata, duration, question text, answer options, correct answers, domains, explanations, learning content, and official references.

The user will provide one Markdown file for each certification. When an exam or blueprint changes, the user will provide a revised file in the same format. The importer must treat this as a versioned update to the existing assessment, not a second assessment.

No separate question spreadsheet is required.

---

## 3. Workspace discovery and sample validation

At the start of every run:

1. Read `AGENTS.md` and existing project documentation.
2. Inspect Git status, site structure, assets, package/build configuration, workflows, and current homepage.
3. Scan the workspace recursively, excluding `.git`, dependencies, generated output, and caches.
4. Classify CSV/XLSX inputs by header signature and Markdown files by structure.
5. For XLSX files, inspect all worksheets.
6. Calculate SHA-256 for candidates. Process one copy of byte-identical duplicates and report the others; never double-import their rows.
7. Prefer an explicit path in project configuration, then a CLI path, then exactly one unprocessed structural match.
8. If multiple non-identical candidates remain, continue unblocked work and report the precise selection required. Do not choose arbitrarily.

The first supplied samples currently demonstrate these parser expectations. Revalidate them; do not hardcode them as permanent business rules:

- Coupon export: 48 rows, 48 unique course IDs, 46 `free_targeted`, 2 `custom_price`, and no missing cells.
- Referral file: 48 rows, 48 unique course IDs, and an HTTPS Udemy `referralCode` URL for each row.
- The two CSVs cover the same 48 IDs, but course ID `5885448` has different course names. This proves that `course_id`, not title, is the stable join key.
- Assessment Markdown: 30 sequential questions, 24 with four options, 6 with five options, 24 MCQs, 6 “Choose TWO” MSQs, six domains, all required explanation sections, and official documentation links.

Write a machine-readable import report and a concise human-readable summary for every run.

---

## 4. Project configuration and VS Code provisioning

During `FRAMEWORK_BUILD`, create or merge:

```text
config/certshield.project.json
config/schema/certshield-project.schema.json
config/assessment-course-map.json
.vscode/tasks.json
```

`certshield.project.json` must use a local `$schema` reference so VS Code provides validation and completion. It should contain:

- task mode and input search roots;
- optional repository-relative input overrides;
- site and brand values;
- assessment and offer feature flags;
- sample-versus-production status;
- canonical origin, default language, global-audience flag, and optional search-engine verification/IndexNow values;
- all external mutations defaulting to `false`.

`assessment-course-map.json` is generated framework state, not a fourth user input. It stores the stable mapping:

```text
assessment_slug → course_id
```

Resolve a new assessment to a course by comparing its vendor, certification name, exam code, filename, and current course titles. Auto-save the mapping only when one candidate is unambiguous. Otherwise report ranked candidates and require one selection in configuration. Never guess a revenue-bearing destination. Once confirmed, retain the mapping across assessment and title updates.

Create or merge VS Code tasks for:

- CertShield: Validate Inputs
- CertShield: Build Framework
- CertShield: Upsert Assessment
- CertShield: Update Monthly Offers
- CertShield: Sync New Course
- CertShield: Run Tests
- CertShield: Production Build
- CertShield: Preview Site

Map tasks to the repository's real commands. Preserve existing settings and tasks.

---

## 5. Modular static architecture

Retain the existing viable stack. Refactor clean HTML/CSS/JavaScript in place when sufficient; do not migrate frameworks for novelty.

The site must remain backend-free and compatible with GitHub Pages and the custom domain.

Separate:

- import adapters for CSV, XLSX, and the assessment Markdown format;
- validators for courses, referrals, offers, assessment metadata, questions, and references;
- pure logic for scoring, readiness, confidence, prioritization, offer status, and link routing;
- browser-local state for progress and recent attempts;
- shared views for discovery, runner, report, review, and offers;
- versioned manifests, catalogs, and generated data.

A suitable structure is:

```text
config/
data/catalog/courses.json
data/catalog/referrals.json
data/assessments/manifest.json
data/assessments/<assessment-slug>.json
data/offers/current.json
data/import-reports/
assets/css/
assets/js/core/
assets/js/ui/
scripts/import/
scripts/validate/
tests/
docs/
```

Adapt names to the repository.

Non-negotiable architecture rules:

- One shared runner and report engine; never copy an app per certification.
- Course, assessment, and offer cards come from data/manifests.
- Generated records include `schemaVersion`, source hash, and import timestamp.
- Imports are idempotent.
- Validate into a temporary result and publish atomically only after all blocking checks pass.
- A failed import must not replace the last valid assessment, catalog, referral, or offer data.
- Use relative paths that work locally, on GitHub Pages, and on the custom domain.

---

## 6. Course, referral, and offer data model

Build the persistent course catalog by merging the latest coupon inventory with the locked referral map:

```text
course_id
course_name
instructor_referral_url
assessment_slug
vendor
certification_name
certification_code
category
present_in_latest_coupon_export
first_seen_at
last_seen_at
```

Rules:

- `course_id` is the primary key and remains a string.
- The latest coupon `course_name` is the canonical current display title.
- A name difference for the same ID is informational, not a join failure; log it as a title change.
- Never fabricate vendor, code, category, or URLs. Populate verified metadata from an imported assessment Markdown. For an unclassified course, retain its title and mark derived fields as unclassified.
- Never replace a referral URL with a coupon URL; store them separately.
- A new coupon course ID missing from the referral catalog must be reported as `referral_required_for_new_course`.
- An assessment may publish without a commercial CTA if its course mapping is unresolved, but it must never render a broken or guessed link.

---

## 7. Exact assessment Markdown contract

Parse certification metadata near the top:

```text
Certification Vendor: <value>
Certification Name: <value>
Latest Exam Code: <value>
Latest Exam/Blueprint Version: <value>
Estimated Duration for This 30-Question Set: <value>
Final Technical Validation: <value>
```

Preserve `Not specified in official documentation` as an honest value; do not invent an exam code.

Each question begins with:

```markdown
# Q#1 | Domain Name: Design Applications
```

Then parse, in order:

1. Complete question stem.
2. Optional explicit cardinality instruction such as `**Choose TWO answers.**`.
3. Options formatted `A.` through `F.`.
4. `## Correct Answer` followed by either `**Correct Answer: C**` or `**Correct Answers: B and E**`.
5. One restatement for each declared correct option, either as a bold paragraph for MCQ or a Markdown list for MSQ.
6. These required learning sections:
   - `## Exam Reasoning Explanation`
   - `## Key Exam Clues`
   - `## Why This Is Correct`
   - `## Why the Other Options Are Not the Best Fit`
   - `## Exam Trap`
   - `## Foundation Concept`
   - `## Real-World Connection`
   - `## Memory Hook`
   - `## 30-Second Exam Takeaway`
   - `## Official References`

Preserve any additional recognized `##` learning section in source order rather than discarding it.

Validation rules:

- Require exactly 30 sequential, unique question numbers.
- Require a nonblank domain for every question and preserve its exact name.
- Support two to six contiguous options and preserve their labels, Markdown, code, and order.
- Infer MCQ versus MSQ from the correct-answer set, but require agreement with any explicit “Choose N” instruction.
- MCQ has exactly one correct answer.
- MSQ has at least two correct answers, and explicit cardinality must match the answer count.
- Every correct letter must identify a populated option.
- The answer restatement(s) must match and cover the complete declared correct-answer set without adding another option.
- Require every listed learning section and at least one valid HTTPS official-reference link per question.
- Reject duplicate question text, duplicate options within a question, malformed links, unsafe HTML/script content, or missing certification metadata.
- Preserve meaningful line breaks, inline code, bullets, emphasis, blockquotes, and reference labels.
- Treat imported Markdown as untrusted. Use a safe Markdown renderer and sanitizer; never inject raw content with unsafe `innerHTML`.

Every error must include source file, question number, section or line, excerpt, reason, and corrective action.

### New assessment versus version update

Derive a stable slug from verified certification identity during the first import and persist it in the manifest.

When a later Markdown file maps to the same assessment:

- keep the existing slug, route, course mapping, and card identity;
- update certification/blueprint metadata and generated question data atomically;
- calculate a new `contentVersion` from the source hash;
- never duplicate the assessment card;
- namespace saved progress by assessment slug and content version;
- do not resume an unfinished attempt against changed questions—explain that the assessment was updated and offer a clean restart;
- retain completed local attempt summaries as historical personal results, clearly labelled with their content version.

---

## 8. Learner journey and assessment runner

Optimize the journey:

```text
Discover → Understand scope → Choose timed/untimed → Answer →
Rate confidence → Review → Submit → Diagnose → Prioritize → Continue learning
```

Requirements:

- No signup or email gate.
- Data-driven landing page showing vendor, certification, exam code when supplied, blueprint/version, 30 questions, MCQ/MSQ mix, domains, duration, validation/review date, local-progress behavior, and diagnostic limitations.
- One question per screen with `Question X of 30`.
- Radio buttons for MCQ and checkboxes plus explicit cardinality for MSQ.
- Previous/Next, question navigator, answered/unanswered/flagged states, and flag for review.
- Timed and untimed modes using the duration supplied in Markdown.
- Autosave indicator, resume, restart, and clear-progress controls.
- Submit confirmation with unanswered and flagged counts.
- No answer or explanation disclosure before submission.
- No promotions or offer interruptions inside the runner.
- Stable question order when resuming. If configured to shuffle questions, use a saved per-attempt seed; do not shuffle options.
- Keyboard, screen-reader, touch, and 320px-mobile usability.
- Clear loading, empty, invalid-data, and recovery states.

Store progress and at most the three most recent completed attempts per assessment in browser storage.

---

## 9. Scoring and diagnostic safeguards

Score each question as one point. An MSQ is correct only when the learner's selected set exactly equals the correct set; extra or missing selections make it incorrect. Unanswered questions are incorrect.

| Correct | Initial readiness |
|---:|---|
| 26–30 | Strong readiness signal |
| 21–25 | Targeted refinement needed |
| 17–20 | Developing readiness |
| 0–16 | Foundation strengthening recommended |

Display the raw percentage but never imply official psychometric precision or pass prediction.

Optional confidence choices:

```text
Sure | Unsure | Guessing | Not selected
```

Classify selected confidence as:

| Response | Interpretation |
|---|---|
| Correct + Sure | Stable knowledge |
| Correct + Unsure/Guessing | Fragile knowledge |
| Incorrect + Sure | Likely misconception |
| Incorrect + Unsure/Guessing | Knowledge gap |

Safeguards:

- Strong readiness requires all 30 questions answered.
- A domain with fewer than three questions is `Limited evidence` and cannot cause a downgrade.
- Downgrade one band if a domain with at least three questions is below 50%.
- Downgrade one band for at least three `Sure + Incorrect` responses.
- Apply at most one final downgrade and explain all triggered safeguards.
- Confidence never changes the raw score.
- Domain accuracy is `correct / total questions in that domain`; show attempted and unanswered separately.

---

## 10. Innovative results and explanation experience

The report must answer:

1. How did I perform?
2. Where is the evidence strong or limited?
3. What should I correct first?
4. What should I do next?

Include:

- readiness label, raw score, counts, time, and diagnostic limitation;
- explanation of any readiness downgrade;
- domain evidence matrix with correct/total, attempted, unanswered, percentage, question count, evidence label, misconception count, and priority;
- confidence calibration for stable, fragile, misconception, gap, guessing, and unclassified responses;
- transparent review ranking by high-confidence errors, incorrect rate, unanswered items, fragile correct answers, then evidence count—no pseudo-scientific composite score;
- three deterministic study actions based on the actual attempt;
- comparison with the most recent local completed attempt, labelled personal progress rather than official prediction;
- print-friendly report/action plan without transmitting data.

For every question, provide a structured post-submission learning review:

- learner answer and correct answer(s);
- correct/incorrect/unanswered and confidence status;
- Exam Reasoning Explanation;
- Key Exam Clues;
- Why This Is Correct;
- Why the Other Options Are Not the Best Fit;
- Exam Trap;
- Foundation Concept;
- Real-World Connection;
- Memory Hook;
- 30-Second Exam Takeaway;
- clickable Official References.

Use progressive disclosure so the page is useful without becoming visually overwhelming. Provide review filters for incorrect, unanswered, flagged, high-confidence incorrect, correct-but-unsure, and domain.

---

## 11. Revenue-aware, learner-respectful link routing

After the report, show actions in this order:

1. Matching full-length Udemy practice exams.
2. Community Offers.
3. Relevant CertShield guidance.

Resolve the matching course through the locked assessment-to-course-ID mapping.

For the primary Udemy CTA:

```text
matching coupon is within its scheduled offer window
    → use course_coupon_url
otherwise, matching locked referral exists
    → use instructor_referral_url
otherwise
    → render no commercial button and report missing mapping
```

Upcoming and ended coupons do not replace the stable referral fallback. Never combine a coupon URL and referral code, rewrite query parameters, or silently convert one link type into the other.

Adapt CTA guidance to the readiness result:

- Strong: validate with a full-length timed mock.
- Targeted refinement: practise weak domains and review explanations.
- Developing: use the full-length course in untimed learning mode first.
- Foundation strengthening: reinforce concepts before treating a mock as exam simulation.

Use honest offer wording and disclose that the Udemy course is instructor-authored and enrollment may generate instructor revenue. All commercial Udemy links use `rel="sponsored noopener"`.

---

## 12. Homepage and course discovery

Fully refactor the existing `index.html` so diagnostic value—not coupons—is the main experience.

Recommended metadata:

```text
Title: Free Certification Readiness Assessments | CertShield
H1: Find Your Certification. Measure Readiness in 30 Questions.
```

Required:

- accessible navigation: Assessments, Vendors, Community Offers, CertShield Guides, About;
- hero explaining 30-question diagnostics, domain insights, no signup, and browser-saved progress;
- primary `Explore Assessments` and secondary `How Readiness Analysis Works` actions;
- search and verified vendor/category filters;
- manifest-driven assessment cards;
- course catalog derived from the coupon file, with honest `Coming soon` treatment until a valid Markdown assessment is imported;
- three-step diagnostic journey and clearly labelled illustrative analytics preview;
- trust section covering transparent scoring, evidence limits, explanation-rich review, privacy, and no pass guarantee;
- small secondary Offers preview and contextual CertShield links;
- footer using Priya D, privacy summary, diagnostic disclaimer, and vendor non-affiliation statement.

Do not place a giant coupon table on the homepage.

---

## 13. Monthly Offers page

Retain every valid row from the current monthly snapshot, including rows whose offer window has ended. Calculate:

- Upcoming;
- Within scheduled offer window;
- Offer window ended;
- Date unavailable.

Parse the source timezone accurately, including PST/PDT. Always show start and expiry.

Friendly coupon mappings:

| Source | Display |
|---|---|
| `current_best_price` | Current Udemy Best Price |
| `custom_price` | Instructor Special Price |
| `free_open` | Limited Free Access |
| `free_targeted` | Community Free Access |

Support equivalent spellings only through one tested mapping table.

Public desktop columns and equivalent mobile cards:

| Public column | Source/logic |
|---|---|
| Practice Exam | Current `course_name` |
| Community Offer | Friendly type plus localized price context |
| Offer Period | Start and expiry |
| Enrollment Limit | `Up to N enrollments` or `No stated coupon redemption limit` |
| Status | Calculated status |
| Access | Coupon URL only while time-valid; otherwise locked referral fallback |

Do not show raw IDs, raw coupon types, raw codes, raw URLs, `₹0`, or supposed seats remaining as primary columns. `maximum_redemptions` is a maximum, never live remaining inventory.

Provide search, verified vendor/category filters when available, offer-type and status filters, reset, result count, desktop table, mobile cards, course highlighting from the URL, last refresh date, empty/error states, and a link back to assessments.

State that Udemy confirms final availability, pricing, and currency; free offers can reach their redemption limit before expiry; source-market prices are references rather than guaranteed worldwide prices.

Validate headers, unique IDs, supported types, dates, price/currency pairs, HTTPS Udemy URLs, duplicates, and referral coverage. Report invalid rows; never silently discard them. A failed monthly update must retain the last valid snapshot.

---

## 14. Global SEO, design, accessibility, privacy, and security

The GitHub Pages site is intended to earn relevant organic visibility among certification learners worldwide. Implement SEO as part of page generation and information architecture, not as a collection of keyword tags.

### A. Crawlable static architecture

- Generate the homepage, assessment directory, every published assessment landing page, Offers page, methodology/about pages, and useful vendor/category hubs as complete static HTML.
- Critical headings, descriptions, domain summaries, dates, and internal links must exist in the initial HTML response. Do not require JavaScript to reveal the page's main indexable meaning.
- Use client JavaScript for the runner, filters, local state, and analytics only.
- Use real crawlable `<a href="...">` links for navigation and contextual discovery; do not depend on `onclick`, buttons, or client-side search to expose pages.
- Load only the selected assessment's question data on its runner. Do not ship every assessment pack on the homepage or directory.
- Provide a useful custom `404.html` linking to Assessments, Offers, and the homepage.

### B. Stable global URL strategy

Use short, descriptive, lowercase, hyphenated, permanent URLs:

```text
/
/assessments/
/assessments/<stable-certification-slug>/
/offers/
/methodology/
/about/
```

Rules:

- Keep an assessment slug stable across title, exam-version, and question-pack updates.
- Do not create separate crawlable pages for every filter combination, search term, timer mode, attempt, score, or result state.
- Put a self-referential, absolute HTTPS canonical link in the source `<head>` of every canonical page.
- Filter/highlight URLs such as `/assessments/?vendor=...` and `/offers/?course=...` must canonicalize to the corresponding clean directory page.
- If runner or result state appears in a URL, canonicalize it to the assessment's substantive landing URL; do not create it as another sitemap entry.
- Canonical tags, Open Graph URLs, sitemap URLs, and internal links must consistently use `https://practice.certshield.co.in`, never the `github.io` host, HTTP, localhost, or preview paths.
- Do not use `robots.txt` as a canonicalization mechanism.

### C. Search-focused page content

Write for learners first, using natural global English and the exact verified vendor, certification name, and exam code. Avoid regional slang, India-only framing, keyword stuffing, or repeated boilerplate.

Each published assessment landing page must contain unique, visible content derived from its Markdown source:

- descriptive title and H1;
- concise value proposition;
- certification vendor, full name, and exam code when available;
- who the diagnostic is for;
- what it measures;
- 30-question MCQ/MSQ mix and estimated duration;
- domains sampled with question counts;
- how scoring, confidence, and readiness safeguards work;
- limitations of a 30-question diagnostic;
- technical validation/review date and blueprint version when supplied;
- preparation methodology and editorial-review links;
- relevant official vendor references;
- clear next actions without pass guarantees.

Recommended assessment metadata pattern:

```text
Title: <Certification Name> Free 30-Question Assessment | CertShield
H1: <Certification Name> Readiness Assessment
Description: A unique, accurate summary using the vendor, exam code when available, 30-question diagnostic format, major domains, and learner value.
```

Do not mechanically force the pattern when a clearer, more accurate title is available. Keep titles and descriptions unique, concise, descriptive, and aligned with visible page content. Do not add a `meta keywords` tag.

Additional content rules:

- Do not copy vendor introductions or documentation passages; paraphrase accurately and link to authoritative sources.
- Do not duplicate articles from `certshield.co.in` on the practice site. Keep the assessment page independently useful, then link contextually to the relevant main-site guide.
- Do not publish indexable thin “coming soon” pages. A coming-soon course may appear as a non-linked directory card.
- Create a separate vendor/category hub only when it has enough published assessments and unique explanatory content to be genuinely useful. Otherwise retain the filter without generating a thin hub URL.
- Show who created/reviewed the learning experience, how questions are validated, and when the assessment was last technically reviewed.
- Use truthful `dateModified` values based on assessment/content changes, not every build or deployment.
- Add substantive About, Assessment Methodology, Editorial/Technical Review, Privacy, and Disclaimer content through the smallest sensible set of pages.

### D. Metadata and structured data

Every canonical page requires:

- unique `<title>` and meta description;
- absolute self-canonical;
- Open Graph title, description, type, URL, site name, and a real share image when available;
- Twitter/X card metadata when a valid share image is available;
- one visible H1 aligned with the page topic;
- logical H2/H3 hierarchy;
- descriptive breadcrumb navigation where useful.

Use JSON-LD only when its visible claims are truthful and supported:

- `WebSite` and `Organization` on the homepage when the required properties are verified;
- `BreadcrumbList` on assessment and other nested landing pages;
- ordinary `WebPage`/`AboutPage` semantics when useful.

Do not label the free diagnostic as an official vendor exam, accredited course, product, or review. Do not add fake ratings, testimonials, prices, availability, FAQ rich-result markup, or unsupported `Course`, `Product`, or `Offer` data. Validate implemented markup with Google's Rich Results Test or Schema Markup Validator, while recognizing that valid markup does not guarantee a rich result.

### E. Sitemap, robots, and discovery

Generate `/sitemap.xml` during the production build using fully qualified canonical HTTPS URLs. Include only substantive public pages:

- homepage;
- assessment directory;
- published assessment landing pages;
- Offers page when backed by valid current data;
- useful methodology, about, privacy, and vendor/category pages.

Exclude query/filter/highlight URLs, runner/result states, coming-soon placeholders, fixtures, source Markdown, JSON data, import reports, and development pages.

Use real content modification dates for `<lastmod>`. Do not stamp every URL with the build date when its content did not change.

Create a root `/robots.txt` that permits crawling of public content, does not block CSS/JavaScript required for rendering, and contains:

```text
Sitemap: https://practice.certshield.co.in/sitemap.xml
```

Add a deployment checklist for:

- verifying the custom domain in Google Search Console and Bing Webmaster Tools;
- submitting the canonical sitemap to both;
- inspecting the homepage and first assessment URL after launch;
- monitoring indexing, duplicate canonicals, mobile usability, search queries, and Core Web Vitals;
- configuring verification tokens through project configuration without inventing them.

Optional IndexNow support may be added behind `SEO.INDEXNOW_ENABLED`. Keep it disabled until its public verification key and deployment behavior are intentionally configured. When enabled, submit only added, updated, or removed canonical URLs after a successful deployment.

### F. International readiness

- Use one clear language per page and set `<html lang="en">` for the current English site.
- Use globally understandable terminology and avoid presenting INR or another source-market price as worldwide pricing.
- Render human-readable dates with an unambiguous timezone and machine-readable ISO `datetime` values.
- Do not auto-redirect or vary indexable content by IP address, presumed country, browser language, or currency.
- Do not add `hreflang` for an English-only site.
- If translated versions are introduced later, give every language a distinct crawlable URL, visible language switcher, self-reference, reciprocal `hreflang`, and an appropriate `x-default`. Do not mix multiple full-language versions on one page.

### G. Internal linking and trust

- Link from the homepage and directory to every published assessment through descriptive anchor text.
- Link each assessment to related same-vendor assessments, its most relevant CertShield guide, methodology, official references, and Offers page where useful.
- From relevant guides on `certshield.co.in`, add natural descriptive links back to matching assessment landing pages when that site's source is available and modification is authorized; otherwise list these reciprocal contextual links as a post-deployment content action.
- Add breadcrumbs and avoid orphan pages.
- Keep paid Udemy links clearly disclosed and marked `rel="sponsored noopener"`.
- Check for broken internal and external links during builds; distinguish transient external-check failures from definite malformed links.
- Do not let expired coupon language remain in titles, meta descriptions, or static promotional copy.

### H. Performance and Core Web Vitals

- Target good Core Web Vitals at the 75th percentile on mobile and desktop: LCP ≤ 2.5 seconds, INP ≤ 200 milliseconds, and CLS ≤ 0.1.
- Use static HTML, deferred/module scripts, focused JavaScript, optimized local images, explicit image dimensions, lazy loading below the fold, and efficient font loading.
- Prevent layout shifts from analytics previews, cards, tables, timers, and dynamically loaded question content.
- Do not load full question explanations, charts, or offer data until the relevant experience needs them.
- Run Lighthouse or an equivalent local audit during development and PageSpeed Insights after deployment when the public URL is available. Report lab results separately from real-user field data.

### I. Accessible and secure design

Create a calm, premium, technically credible visual system for global certification professionals:

- responsive from 320px through desktop;
- semantic HTML, visible focus, sufficient contrast, reduced-motion support, native controls first, and ARIA only when necessary;
- strong hierarchy, readable widths, consistent tokens, and meaningful loading/empty/error states;
- no generic robots, artificial brains, circuit clutter, fake statistics, countdown scarcity, or intrusive popups;
- no official-affiliation, guaranteed-readiness, pass-prediction, live-seat, or globally guaranteed price claims;
- browser-only progress/history, clear deletion, no email gate, no secrets, and no transmission of questions, answers, confidence, or personal data;
- safe Markdown rendering, sanitized content, safe external protocols/hosts, and no unsafe `innerHTML`;
- optimized assets, minimal production JavaScript, and no unnecessary client dependency.

---

## 15. Tests, visual verification, and documentation

Add tests for:

### Input and catalog integrity

- header-based discovery for all three inputs;
- CSV/XLSX parsing, SHA-256 duplicate detection, and ambiguous candidates;
- 48-row sample reconciliation and the known name mismatch on course ID `5885448`;
- string course IDs, URL hosts/query parameters, locked referral immutability, new-course append, and conflict rejection;
- monthly snapshot replacement, catalog upsert, and failed-import rollback.

### Assessment Markdown

- metadata extraction;
- exactly 30 sequential questions;
- question/domain headings, 2–6 contiguous options, MCQ/MSQ inference, cardinality agreement, and answer restatement;
- all required explanation sections and official HTTPS references;
- duplicate/unsafe/malformed content;
- new assessment import versus existing assessment version update;
- stable slug/course mapping and old-progress invalidation after a content update.

### Scoring and experience

- MCQ and exact-set MSQ scoring;
- unanswered handling, readiness boundaries, domain downgrade, limited evidence, and confidence classification;
- navigation, flags, autosave, stable resume, restart, clear progress, submission, review filters, and retake comparison;
- result-aware CTA copy, active coupon selection, upcoming/ended referral fallback, and no broken link.

### Offers and deployment

- coupon mappings, date/timezone states, expiry display, limits, price localization, search/filters, responsive layouts, and GitHub Pages path handling.

### Global SEO and crawlability

- substantive page content present in generated HTML without requiring JavaScript;
- unique titles, meta descriptions, H1s, absolute HTTPS canonicals, Open Graph URLs, and canonical-origin consistency;
- stable assessment slugs across content-version updates;
- canonicalization of filter, highlight, runner, and result URL variants;
- crawlable anchor navigation, breadcrumbs, no orphan assessment pages, and no broken internal links;
- XML sitemap URL membership, exclusions, absolute URLs, and truthful `lastmod` values;
- `robots.txt` sitemap declaration and no accidental blocking of public assets/content;
- no indexable thin coming-soon/vendor/category pages;
- valid, visible-content-matched JSON-LD without unsupported review, rating, product, course, offer, or FAQ claims;
- global-English language, no false geo-pricing, and no `hreflang` unless real translated URLs exist;
- custom-domain/HTTPS consistency and absence of `github.io`, localhost, or preview URLs from production SEO signals;
- custom 404 behavior;
- Lighthouse checks for SEO, accessibility, performance, and best practices;
- Core Web Vitals lab targets where measurable, with field-data checks deferred until public data exists.

Run all applicable formatting, linting, type checks, unit tests, production build, and at least one browser-level assessment flow when supported. Do not claim checks that were not run.

Visually inspect desktop and mobile:

- homepage/discovery and coming-soon states;
- assessment landing, MCQ, MSQ, navigator, resume, submit, and errors;
- readiness, domains, confidence, actions, rich explanation review, and print view;
- Offers page with active, upcoming, ended, empty, and invalid-data states;
- assessment landing content with JavaScript disabled;
- search-result metadata, breadcrumbs, social preview, and structured data for representative pages;
- keyboard focus and 320px layout.

Create or update:

```text
docs/ASSESSMENT_FRAMEWORK.md
docs/ASSESSMENT_MD_FORMAT.md
docs/COURSE_REFERRAL_IMPORT.md
docs/MONTHLY_OFFERS_UPDATE.md
docs/GLOBAL_SEO_AND_SEARCH_DISCOVERY.md
```

Document architecture, three-input lifecycle, schemas, VS Code tasks, Markdown parser, new/updated assessment process, immutable referral behavior, monthly update, validation, testing, GitHub Pages deployment, canonical URL policy, sitemap/robots generation, structured-data limits, internationalization policy, and Google/Bing verification handoff. Keep `AGENTS.md` concise and link to these documents.

---

## 16. Definition of done

`FRAMEWORK_BUILD` is complete only when:

- the existing homepage is fully refactored around diagnostic value;
- the coupon sheet has created the current course inventory and offer snapshot;
- the referral sheet has created a locked course-ID referral map;
- the supplied valid Markdown has created the first real 30-question assessment;
- one shared runner and analytics engine powers every certification;
- Markdown explanations render safely and add structured learning value after submission;
- scoring, domains, confidence, priorities, local progress/history, and result routing work;
- active coupon and stable referral fallback behavior is verified;
- every published assessment has a substantive, crawlable, globally written landing page;
- production canonicals, internal links, sitemap, robots, metadata, and structured data consistently use the HTTPS custom domain;
- thin/filter/state URLs do not become competing sitemap entries or duplicate landing pages;
- global SEO, accessibility, performance, and custom-domain checks pass at the level available before deployment;
- workspace discovery, JSON-schema configuration, and VS Code tasks work;
- tests, production build, mobile/keyboard flows, and visual review pass;
- unrelated changes and GitHub Pages compatibility are preserved.

`UPSERT_ASSESSMENT` additionally requires a valid atomic create/update, no duplicate route/card, version-safe local state, and a verified course mapping or an honest no-CTA state.

`MONTHLY_OFFERS_UPDATE` additionally requires every valid current row represented, catalog upsert, correct status/link routing, a validation report, and no referral overwrite.

`NEW_COURSE_SYNC` additionally requires the new course ID in both files, an appended locked referral, and a report of whether an assessment Markdown is still pending.

---

## 17. Final response format

Report concisely:

1. Outcome delivered.
2. Inputs discovered, selected, and classified.
3. Course/referral reconciliation, title differences, new IDs, and conflicts.
4. Assessment created or updated, its content version, MCQ/MSQ/domain counts, and course mapping.
5. Learner-experience and analytical-value features delivered.
6. Global SEO delivered: crawlable pages, canonical policy, sitemap/robots, metadata, structured data, internal links, and performance results.
7. Validation results, tests/build commands, and browser views actually verified.
8. Important files changed.
9. Missing or unresolved data.
10. Exact VS Code task or command for the next assessment Markdown.
11. Exact VS Code task or command for the next monthly coupon file.
12. Whether an updated referral sheet is required for a new course.
13. Deployment, Search Console, Bing Webmaster Tools, or IndexNow action still required.

Do not repeat this specification and do not stop with recommendations when implementation is authorized.

---

## Official implementation references

- [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [Visual Studio Code Tasks](https://code.visualstudio.com/docs/debugtest/tasks)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [MDN: Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google: Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google: Canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: Crawlable link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google: Title links and search-result titles](https://developers.google.com/search/docs/appearance/title-link)
- [Google: Meta descriptions and snippets](https://developers.google.com/search/docs/appearance/snippet)
- [Google: Structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Google: International and multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)
- [Google Search Console](https://search.google.com/search-console/about)
- [Bing Webmaster Tools sitemap guidance](https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed)
- [IndexNow documentation](https://www.indexnow.org/documentation)
- [Core Web Vitals](https://web.dev/articles/vitals)
- [Google: Qualify outbound links](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links)
- [Udemy: Coupons and referral links](https://support.udemy.com/hc/en-us/articles/229603968-Promote-your-course-with-coupons-and-referral-links)
- [Udemy: Bulk coupon creation](https://support.udemy.com/hc/en-us/articles/4689662084247-How-to-create-instructor-coupons-using-the-bulk-coupons-option)
