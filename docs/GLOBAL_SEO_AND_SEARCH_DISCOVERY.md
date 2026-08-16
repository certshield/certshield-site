# Global SEO and Search Discovery

## Canonical URL policy

All canonical, Open Graph and sitemap URLs consistently use
`https://practice.certshield.co.in` (never `github.io`, `http://`,
`localhost`, or a preview path) — see `render_site.SITE_URL`. Stable,
lowercase, hyphenated directory URLs:

```
/
/assessments/
/assessments/<stable-certification-slug>/
/offers/
/methodology/
/about/
```

The assessment slug is derived once from the certification name and never
changes across title, blueprint or question-content updates (see
[ASSESSMENT_MD_FORMAT.md](ASSESSMENT_MD_FORMAT.md)). There is no separate
crawlable URL for a filter, search term, timer mode, in-progress attempt, or
result state — the runner is a single client-side view mounted on the
assessment's one substantive landing URL. `robots.txt` is not used for
canonicalization; every page carries its own self-referential absolute
`<link rel="canonical">`.

## Crawlable without JavaScript

Every canonical page is generated as complete static HTML by
`scripts/render_site.py`. The title, H1, meta description, domain-coverage
table, duration, technical-validation date, breadcrumb and internal links
all exist in the page's initial HTML response — verified in this build by
loading each page with a JavaScript-disabled browser context and confirming
the H1, domain table, duration and `<noscript>` fallback text are all
present in `document.body.innerText`. Only the interactive 30-question
runner (answering, timer, navigator, autosave, results, review) is
client-rendered from the page's embedded JSON payload — exactly the split
the master prompt directs ("client JavaScript for the runner, filters, local
state, and analytics only").

## Structured data

- Homepage: `Organization` + `WebSite` + `WebPage`, linked via `@id`.
- Every nested page: `BreadcrumbList` plus a `WebPage`/`CollectionPage`/
  `AboutPage` node as appropriate, all `isPartOf`-linked back to the
  `WebSite` node.
- Assessment landing pages additionally set `og:type: article` and a
  `dateModified` sourced from the Markdown's own `Final Technical
  Validation: Completed <date>` sentence (parsed by
  `build.py:extract_technical_validation_date`) — never a fabricated or
  every-build-stamped date.
- No `FAQPage`, `Review`, `Rating`, `Product`, `Course` or `Offer` schema is
  emitted anywhere: the diagnostic is not represented as an accredited
  product, an official exam, or a reviewed course, and CertShield does not
  control Udemy's live per-market price closely enough to publish a static
  `Offer` price without risking a structured-data accuracy flag.

## Coming-soon and thin-content policy

A course with no published assessment yet appears only as a non-linked
"coming soon" card on `/assessments/` and the homepage — it never gets its
own thin, indexable page. No vendor/category hub pages are generated yet:
with a single published assessment so far, a dedicated hub page per vendor
would be exactly the kind of thin page the master prompt prohibits. The
`/assessments/` directory's client-side vendor/category filter substitutes
for hub pages until there is enough real per-vendor content to justify one.

## Sitemap and robots

`scripts/build.py:render_all_pages` builds the sitemap URL list explicitly:
homepage, `/assessments/`, every **published** assessment page (excluding
any that failed validation), `/offers/` (only when the offer snapshot is
non-empty), `/methodology/`, `/about/`. Query/filter/runner/result-state
URLs, `data/`, `scripts/`, `tests/`, `docs/`, `config/`, and the source
Markdown/CSV files are never included. `<lastmod>` for an assessment page
uses its real technical-validation date, not the build timestamp.
`robots.txt` already declares `Sitemap:
https://practice.certshield.co.in/sitemap.xml` and does not block any CSS/JS
required for rendering; it was left as-is since it already satisfied this
policy.

## International readiness

Every page sets `<html lang="en">`. Prices are shown with their literal
source currency/market label (e.g. "489 INR") rather than converted or
implied as a worldwide price. No `hreflang` is emitted (English-only site);
if a translated version is ever added, it must get its own crawlable URL,
a visible language switcher, reciprocal `hreflang`, and an `x-default` —
not mixed languages on one URL.

## What's still a manual/post-deployment action

- **Lighthouse / PageSpeed Insights**: not run as part of this build — no
  Lighthouse CLI is available in this environment, and PageSpeed Insights
  requires a live public URL. Run a local Lighthouse pass (Chrome DevTools
  or `npx lighthouse`) before/after deployment, and PageSpeed Insights once
  `https://practice.certshield.co.in` is live.
- **Google Search Console / Bing Webmaster Tools**: verify the custom
  domain, submit `sitemap.xml`, and inspect the homepage + first assessment
  URL after the next real deployment. Verification tokens go in
  `config/certshield.project.json`'s `seo.searchConsoleVerification` /
  `seo.bingVerification` fields — never invented ahead of time.
- **IndexNow**: `seo.indexNowEnabled` is `false` by default per the master
  prompt; enable it only once a real public verification key is issued and
  configured, then submit only added/updated/removed canonical URLs after a
  successful deployment.
- **Rich Results Test / Schema Markup Validator**: run against the live
  pages once deployed to confirm the emitted JSON-LD validates (it was
  hand-checked for well-formedness and `@id` consistency during this build,
  but not run through Google's live validator, which needs a reachable
  URL).
