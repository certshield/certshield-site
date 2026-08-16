#!/usr/bin/env python3
"""Render the CertShield Practice static pages (master-prompt sections 5, 12-14).

Every page is complete, crawlable static HTML: the diagnostic runner reads
its own JSON payload client-side, but titles, descriptions, domain
summaries, dates and internal links all exist in the initial HTML response.
Standard library only.
"""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from typing import Any

SITE_URL = "https://practice.certshield.co.in"
MAIN_SITE_URL = "https://certshield.co.in"
BRAND = "CertShield Practice"
INSTRUCTOR_PROFILE_URL = "https://www.udemy.com/user/priya-d-66/"


def esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def nav_links(root_prefix: str, active: str) -> str:
    items = [
        ("assessments", root_prefix + "assessments/", "Assessments"),
        ("offers", root_prefix + "offers/", "Community Offers"),
        ("methodology", root_prefix + "methodology/", "Methodology"),
        ("about", root_prefix + "about/", "About"),
    ]
    parts = []
    for key, href, label in items:
        current = ' aria-current="page"' if key == active else ""
        parts.append('<li><a href="%s"%s>%s</a></li>' % (esc(href), current, esc(label)))
    parts.append(
        '<li><a class="nav-external" href="%s/?utm_source=certshield_practice&amp;utm_medium=referral&amp;utm_campaign=%s_nav" target="_blank" rel="noopener">CertShield Guides ↗</a></li>'
        % (MAIN_SITE_URL, esc(active))
    )
    return "\n          ".join(parts)


def page_shell(
    *,
    title: str,
    description: str,
    canonical_path: str,
    root_prefix: str,
    body_class: str,
    nav_active: str,
    main_html: str,
    structured_data: dict[str, Any],
    og_type: str = "website",
    breadcrumb_html: str = "",
    date_modified: str | None = None,
) -> str:
    canonical_url = SITE_URL + "/" + canonical_path
    og_image = SITE_URL + "/assets/images/certshield-profile.jpeg"
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  <meta name="theme-color" content="#062b31">
  <meta name="author" content="CertShield">
  <title>%(title)s</title>
  <meta name="description" content="%(description)s">
  <link rel="canonical" href="%(canonical_url)s">

  <meta property="og:type" content="%(og_type)s">
  <meta property="og:locale" content="en">
  <meta property="og:site_name" content="%(brand)s">
  <meta property="og:title" content="%(title)s">
  <meta property="og:description" content="%(description)s">
  <meta property="og:url" content="%(canonical_url)s">
  <meta property="og:image" content="%(og_image)s">
  <meta property="og:image:width" content="1536">
  <meta property="og:image:height" content="1536">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="%(title)s">
  <meta name="twitter:description" content="%(description)s">
  <meta name="twitter:image" content="%(og_image)s">

  <link rel="icon" type="image/jpeg" href="%(root_prefix)sassets/images/certshield-profile.jpeg">
  <link rel="stylesheet" href="%(root_prefix)sassets/css/site.css">
  <script type="application/ld+json">%(structured_data)s</script>
</head>
<body data-page-type="%(body_class)s">
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="%(root_prefix)sindex.html" aria-label="%(brand)s home">
        <img src="%(root_prefix)sassets/images/certshield-profile.jpeg" width="52" height="52" alt="">
        <span class="brand-name"><strong>%(brand)s</strong><span>Reasoning-led preparation</span></span>
      </a>
      <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="primary-navigation">Menu</button>
      <nav class="site-nav" id="primary-navigation" data-site-nav data-open="false" aria-label="Primary navigation">
        <ul>
          %(nav_links)s
        </ul>
      </nav>
    </div>
  </header>

  <main id="main-content">
    %(breadcrumb)s%(main_html)s
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div>
          <h2>%(brand)s</h2>
          <p class="footer-note">Free 30-question certification readiness diagnostics with transparent scoring, domain evidence and explanation-led review.</p>
        </div>
        <div><h3>Practice</h3><ul><li><a href="%(root_prefix)sassessments/">All assessments</a></li><li><a href="%(root_prefix)soffers/">Current offers</a></li><li><a href="%(root_prefix)smethodology/">Methodology</a></li></ul></div>
        <div><h3>CertShield</h3><ul><li><a href="%(main_site)s/?utm_source=certshield_practice&amp;utm_medium=referral&amp;utm_campaign=footer" target="_blank" rel="noopener">Full Practice Exams ↗</a></li><li><a href="%(instructor_url)s" target="_blank" rel="noopener noreferrer">Instructor profile ↗</a></li></ul></div>
        <div><h3>About</h3><ul><li><a href="%(root_prefix)sabout/">About CertShield Practice</a></li><li><a href="%(root_prefix)smethodology/#privacy">Privacy summary</a></li></ul></div>
      </div>
      <div class="footer-bottom">
        <span>© <span data-current-year>2026</span> CertShield. Independent preparation.</span>
        <span>Not affiliated with, endorsed by, or an official product of any certification vendor named on this site. Diagnostic results are not a pass guarantee.</span>
      </div>
    </div>
  </footer>

  <script src="%(root_prefix)sassets/js/core/assessment-scoring.js" defer></script>
  <script src="%(root_prefix)sassets/js/site.js" defer></script>
  <script src="%(root_prefix)sassets/js/offers.js" defer></script>
  <script src="%(root_prefix)sassets/js/ui/assessment-runner.js" defer></script>
</body>
</html>
""" % {
        "title": esc(title),
        "description": esc(description),
        "canonical_url": esc(canonical_url),
        "og_type": esc(og_type),
        "brand": esc(BRAND),
        "og_image": esc(og_image),
        "root_prefix": esc(root_prefix),
        "body_class": esc(body_class),
        "nav_links": nav_links(root_prefix, nav_active),
        "breadcrumb": breadcrumb_html,
        "main_html": main_html,
        "main_site": MAIN_SITE_URL,
        "instructor_url": esc(INSTRUCTOR_PROFILE_URL),
        "structured_data": json.dumps(structured_data, ensure_ascii=False),
    }


def breadcrumb_nav(root_prefix: str, trail: list[tuple[str, str]]) -> str:
    """trail: list of (label, href) pairs; last item has no href (current page)."""
    items = []
    for index, (label, href) in enumerate(trail):
        if href:
            items.append('<li><a href="%s">%s</a></li>' % (esc(href), esc(label)))
        else:
            items.append('<li aria-current="page">%s</li>' % esc(label))
    return (
        '<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>%s</ol></nav>' % "".join(items)
    )


def breadcrumb_schema(canonical_path_root: str, trail: list[tuple[str, str]]) -> dict[str, Any]:
    items = []
    for index, (label, href) in enumerate(trail, start=1):
        url = SITE_URL + "/" + href.lstrip("/") if href else SITE_URL + "/" + canonical_path_root
        items.append({"@type": "ListItem", "position": index, "name": label, "url": url})
    return {"@type": "BreadcrumbList", "itemListElement": items}


# --------------------------------------------------------------------- home


def render_homepage(catalog: dict, manifest: list[dict], offers_snapshot: dict, root_prefix: str = "") -> str:
    published = [item for item in manifest if item.get("status") == "published"]
    assessment_cards = "".join(
        """<article class="card generated-course-card" data-filter-item data-vendor="%s" data-category="%s">
    <p class="card-eyebrow">%s</p>
    <h3><a href="%sassessments/%s/">%s</a></h3>
    <p>%d questions · %s</p>
    <div class="card-actions"><a class="button button-secondary" href="%sassessments/%s/">Start diagnostic</a></div>
</article>"""
        % (
            esc(item["vendor"]),
            esc(item.get("category", "Unclassified")),
            esc(item["vendor"]),
            root_prefix,
            esc(item["slug"]),
            esc(item["certificationName"]),
            item["questionCount"],
            esc(item.get("estimatedDuration", "")),
            root_prefix,
            esc(item["slug"]),
        )
        for item in published
    )

    coming_soon_courses = [
        entry
        for entry in catalog.values()
        if entry.get("presentInLatestCouponExport") and not entry.get("assessmentSlug")
    ]
    coming_soon_courses.sort(key=lambda entry: entry.get("courseName", ""))
    coming_soon_cards = "".join(
        '<article class="card generated-course-card is-coming-soon" data-filter-item data-vendor="%s" data-category="%s">'
        '<p class="card-eyebrow">%s</p><h3>%s</h3><p>Diagnostic coming soon</p></article>'
        % (esc(entry.get("vendor", "Unclassified")), esc(entry.get("category", "Unclassified")),
           esc(entry.get("vendor", "Unclassified")), esc(entry.get("courseName", "")))
        for entry in coming_soon_courses[:12]
    )

    featured_offers = offers_snapshot.get("offers", [])[:3]
    offers_preview = "".join(
        '<article class="card"><h3>%s</h3><p class="offer-meta">%s</p>'
        '<p><a class="button button-secondary" href="%soffers/">View this offer</a></p></article>'
        % (esc(offer["courseName"]), esc(offer.get("vendor", "")), root_prefix)
        for offer in featured_offers
    )

    main_html = """
    <section class="hero" aria-labelledby="hero-title">
      <div class="wrap hero-grid">
        <div>
          <p class="eyebrow">%(brand)s</p>
          <h1 id="hero-title">Find Your Certification. Measure Readiness in 30 Questions.</h1>
          <p class="hero-copy">Take a free, original 30-question diagnostic for AI, Cloud, Data and Security certifications. Get an evidence-based readiness signal, domain-level insight and explanation-led review — no signup, progress saved only in your browser.</p>
          <div class="hero-actions">
            <a class="button button-primary" href="#assessments">Explore Assessments</a>
            <a class="button button-secondary" href="%(root_prefix)smethodology/">How Readiness Analysis Works</a>
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <img src="%(root_prefix)sassets/images/certshield-profile.jpeg" width="1536" height="1536" alt="">
        </div>
      </div>
    </section>

    <div class="trust-strip" aria-label="CertShield Practice principles">
      <ul class="wrap trust-list">
        <li>30-Question Diagnostics</li>
        <li>Domain-Level Evidence</li>
        <li>No Signup Required</li>
        <li>Explanation-Led Review</li>
      </ul>
    </div>

    <section class="section section-white" id="assessments" aria-labelledby="assessments-title">
      <div class="wrap" data-filter-root>
        <div class="section-heading">
          <div>
            <p class="eyebrow">Start with value</p>
            <h2 id="assessments-title">Free Diagnostic Assessments</h2>
            <p>Each assessment is 30 original questions with domain-based readiness scoring and full explanation review after submission.</p>
          </div>
          <a href="%(root_prefix)sassessments/" class="button button-secondary">Browse all assessments</a>
        </div>
        <div class="card-grid">
          %(assessment_cards)s
        </div>
        %(coming_soon_block)s
      </div>
    </section>

    <section class="section section-tint" aria-labelledby="journey-title">
      <div class="wrap">
        <div class="section-heading">
          <div><p class="eyebrow">Three steps</p><h2 id="journey-title">The Diagnostic Journey</h2></div>
        </div>
        <div class="feature-grid">
          <article class="feature"><span class="feature-number">01</span><h3>Answer 30 questions</h3><p>Choose timed or untimed mode. Flag questions, navigate freely, and your progress autosaves in this browser.</p></article>
          <article class="feature"><span class="feature-number">02</span><h3>See evidence-based readiness</h3><p>A domain evidence matrix, confidence calibration and a transparent review ranking — never a pseudo-scientific composite score.</p></article>
          <article class="feature"><span class="feature-number">03</span><h3>Review every explanation</h3><p>Ten structured teaching sections per question, plus official references, only revealed after you submit.</p></article>
        </div>
      </div>
    </section>

    <section class="section section-white" aria-labelledby="trust-title">
      <div class="wrap split">
        <div>
          <p class="eyebrow">What this diagnostic is — and is not</p>
          <h2 id="trust-title">Transparent by Design</h2>
          <ul class="mission-points">
            <li>Scoring uses exact-set matching with no partial credit; unanswered questions count as incorrect.</li>
            <li>Domains with fewer than three questions are always labelled "Limited evidence" and can never cause a downgrade.</li>
            <li>Progress, answers and confidence never leave your browser — nothing is transmitted anywhere.</li>
            <li>This is not an official exam, an accredited course, or a pass-rate guarantee.</li>
          </ul>
        </div>
        <aside class="card">
          <h3>Instructor transparency</h3>
          <p>View Priya D's public instructor profile and course catalog directly on Udemy.</p>
          <a class="button button-secondary" href="%(instructor_url)s" target="_blank" rel="noopener noreferrer">View instructor profile ↗</a>
        </aside>
      </div>
    </section>

    <section class="section section-tint" aria-labelledby="offers-title">
      <div class="wrap">
        <div class="section-heading">
          <div><p class="eyebrow">Course-specific</p><h2 id="offers-title">Current Community Offers</h2><p>A small preview of current instructor promotions. Full listing on the Offers page.</p></div>
          <a class="button button-secondary" href="%(root_prefix)soffers/">View all current offers</a>
        </div>
        <div class="card-grid">%(offers_preview)s</div>
      </div>
    </section>
    """ % {
        "brand": esc(BRAND),
        "root_prefix": esc(root_prefix),
        "assessment_cards": assessment_cards or '<p class="empty-state">The first diagnostic assessments are being technically validated. Check back soon.</p>',
        "coming_soon_block": (
            '<div class="section-heading" style="margin-top:2rem;"><h3>More Certifications — Diagnostics Coming Soon</h3></div><div class="card-grid">%s</div>' % coming_soon_cards
            if coming_soon_cards
            else ""
        ),
        "instructor_url": esc(INSTRUCTOR_PROFILE_URL),
        "offers_preview": offers_preview or '<p class="empty-state">No current offers in this snapshot.</p>',
    }

    structured_data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": SITE_URL + "/#organization",
                "name": "CertShield",
                "url": MAIN_SITE_URL + "/",
                "logo": {"@type": "ImageObject", "url": SITE_URL + "/assets/images/certshield-profile.jpeg"},
            },
            {
                "@type": "WebSite",
                "@id": SITE_URL + "/#website",
                "url": SITE_URL + "/",
                "name": BRAND,
                "publisher": {"@id": SITE_URL + "/#organization"},
            },
            {
                "@type": "WebPage",
                "@id": SITE_URL + "/#webpage",
                "url": SITE_URL + "/",
                "name": "Free Certification Readiness Assessments",
                "isPartOf": {"@id": SITE_URL + "/#website"},
                "description": "Free 30-question certification readiness diagnostics with domain-level evidence and explanation-led review.",
            },
        ],
    }

    return page_shell(
        title="Free Certification Readiness Assessments | CertShield",
        description="Take a free 30-question diagnostic for AI, Cloud, Data and Security certifications. Evidence-based readiness scoring, domain insight and explanation-led review — no signup.",
        canonical_path="",
        root_prefix=root_prefix,
        body_class="homepage",
        nav_active="assessments",
        main_html=main_html,
        structured_data=structured_data,
    )


# ------------------------------------------------------------- directory


def render_assessment_directory(catalog: dict, manifest: list[dict]) -> str:
    root_prefix = "../"
    published = [item for item in manifest if item.get("status") == "published"]
    cards = "".join(
        """<article class="card generated-course-card" data-filter-item data-vendor="%s" data-category="%s">
    <p class="card-eyebrow">%s</p>
    <h3><a href="%s/">%s</a></h3>
    <p>%d questions (%d single-answer, %d multi-answer) across %d domains · %s</p>
    <div class="card-actions"><a class="button button-secondary" href="%s/">Start diagnostic</a></div>
</article>"""
        % (
            esc(item["vendor"]), esc(item.get("category", "Unclassified")), esc(item["vendor"]),
            esc(item["slug"]), esc(item["certificationName"]),
            item["questionCount"], item["mcqCount"], item["msqCount"], len(item["domains"]),
            esc(item.get("estimatedDuration", "")), esc(item["slug"]),
        )
        for item in published
    )

    coming_soon = [entry for entry in catalog.values() if entry.get("presentInLatestCouponExport") and not entry.get("assessmentSlug")]
    coming_soon.sort(key=lambda entry: entry.get("courseName", ""))
    coming_soon_cards = "".join(
        '<article class="card generated-course-card is-coming-soon" data-filter-item data-vendor="%s" data-category="%s">'
        '<p class="card-eyebrow">%s</p><h3>%s</h3><p>Free Diagnostic Coming Soon</p></article>'
        % (esc(entry.get("vendor", "Unclassified")), esc(entry.get("category", "Unclassified")),
           esc(entry.get("vendor", "Unclassified")), esc(entry.get("courseName", "")))
        for entry in coming_soon
    )

    main_html = """
    <section class="page-hero">
      <div class="wrap">
        <p class="eyebrow">Diagnostic directory</p>
        <h1>Certification Readiness Assessments</h1>
        <p>Browse every certification CertShield covers. Published assessments link straight to a free 30-question diagnostic; certifications without one yet show an honest "coming soon" card.</p>
      </div>
    </section>
    <section class="section section-white" aria-labelledby="directory-title">
      <div class="wrap" data-filter-root>
        <h2 id="directory-title" class="sr-only">All assessments</h2>
        <div class="card-grid">%(cards)s</div>
        %(coming_soon_block)s
      </div>
    </section>
    """ % {
        "cards": cards or '<p class="empty-state">The first diagnostic assessments are being technically validated.</p>',
        "coming_soon_block": (
            '<div class="section-heading" style="margin-top:2rem;"><h3>Coming Soon</h3></div><div class="card-grid">%s</div>' % coming_soon_cards
            if coming_soon_cards else ""
        ),
    }

    trail = [(BRAND, root_prefix + "index.html"), ("Assessments", "")]
    structured_data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "@id": SITE_URL + "/assessments/#webpage",
                "url": SITE_URL + "/assessments/",
                "name": "Certification Readiness Assessments",
                "description": "Directory of free 30-question certification readiness diagnostics.",
                "isPartOf": {"@id": SITE_URL + "/#website"},
            },
            breadcrumb_schema("assessments/", trail),
        ],
    }

    return page_shell(
        title="Certification Readiness Assessments | CertShield",
        description="Browse every certification CertShield covers and start a free 30-question readiness diagnostic.",
        canonical_path="assessments/",
        root_prefix=root_prefix,
        body_class="assessment-directory",
        nav_active="assessments",
        main_html=main_html,
        structured_data=structured_data,
        breadcrumb_html=breadcrumb_nav(root_prefix, trail),
    )


# --------------------------------------------------------- assessment page


def build_assessment_payload(assessment: dict, offer: dict | None, course_id: str | None) -> dict:
    return {
        "slug": assessment["slug"],
        "contentVersion": assessment["contentVersion"],
        "courseId": course_id,
        "offer": offer or {},
        "meta": {
            "vendor": assessment["meta"]["vendor"],
            "certificationName": assessment["meta"]["certificationName"],
            "examCode": assessment["meta"]["examCode"],
            "blueprintVersion": assessment["meta"]["blueprintVersion"],
            "estimatedDuration": assessment["meta"]["estimatedDuration"],
            "domains": sorted({question["domain"] for question in assessment["questions"]}),
            "mcqCount": sum(1 for question in assessment["questions"] if question["selectionMode"] == "single"),
            "msqCount": sum(1 for question in assessment["questions"] if question["selectionMode"] == "multiple"),
        },
        "questions": [
            {
                "id": question["id"] if "id" in question else "q%d" % question["number"],
                "questionNumber": question["number"],
                "domain": question["domain"],
                "stemHtml": question["stemHtml"],
                "cardinalityInstruction": question["cardinalityInstruction"],
                "options": [
                    {"id": option["id"], "text": option["text"], "textHtml": option["textHtml"]}
                    for option in question["options"]
                ],
                "correctAnswers": question["correctAnswers"],
                "selectionMode": question["selectionMode"],
                "requiredSelections": question["requiredSelections"],
                "sections": question["sections"],
                "officialReferences": question["officialReferences"],
            }
            for question in assessment["questions"]
        ],
    }


def render_assessment_landing(
    assessment: dict,
    catalog_entry: dict | None,
    offer: dict | None,
    course_id: str | None,
) -> str:
    root_prefix = "../../"
    slug = assessment["slug"]
    meta = assessment["meta"]
    questions = assessment["questions"]
    domains = sorted({question["domain"] for question in questions})
    domain_counts: dict[str, int] = {}
    for question in questions:
        domain_counts[question["domain"]] = domain_counts.get(question["domain"], 0) + 1
    mcq_count = sum(1 for question in questions if question["selectionMode"] == "single")
    msq_count = len(questions) - mcq_count

    domain_rows = "".join(
        "<tr><th scope=\"row\">%s</th><td>%d</td></tr>" % (esc(domain), domain_counts[domain])
        for domain in domains
    )

    payload = build_assessment_payload(assessment, offer, course_id)
    payload_json = json.dumps(payload, ensure_ascii=False).replace("</script>", "<\\/script>")

    main_site_url = catalog_entry.get("mainSiteUrl") if catalog_entry else None
    vendor_and_cert = (
        meta["certificationName"]
        if meta["certificationName"].lower().startswith(meta["vendor"].lower())
        else meta["vendor"] + " " + meta["certificationName"]
    )

    main_html = """
    <section class="page-hero">
      <div class="wrap">
        <p class="eyebrow">Free reasoning-led diagnostic</p>
        <h1>%(certification_name)s Readiness Assessment</h1>
        <p>A free 30-question diagnostic for %(vendor_and_cert)s%(exam_code_suffix)s. Answer at your own pace, then review a domain-by-domain readiness signal with fully explained reasoning for every question.</p>
      </div>
    </section>

    <section class="trust-strip" aria-label="Assessment summary">
      <div class="wrap"><ul class="trust-list">
        <li>%(question_count)d Questions</li>
        <li>%(mcq_count)d Single-Answer / %(msq_count)d Multi-Answer</li>
        <li>%(domain_count)d Domains</li>
        <li>%(duration)s</li>
      </ul></div>
    </section>

    <section class="section section-white" aria-labelledby="who-title">
      <div class="wrap reading-width">
        <h2 id="who-title">Who This Diagnostic Is For</h2>
        <p>This assessment is for learners preparing for %(vendor_and_cert)s%(exam_code_suffix)s who want an honest, evidence-based signal of where they stand today — not a leaked or recalled exam question set. Every question is original CertShield content, technically validated against current official documentation%(blueprint_suffix)s.</p>
        <h3>What It Measures</h3>
        <table class="assessment-domain-table">
          <caption>Questions sampled per domain in this 30-question set.</caption>
          <thead><tr><th scope="col">Domain</th><th scope="col">Questions</th></tr></thead>
          <tbody>%(domain_rows)s</tbody>
        </table>
        <p><strong>Limitations of this diagnostic:</strong> 30 questions cannot cover every exam objective with equal depth. Domains with fewer than three questions are labelled "Limited evidence" in your results and can never cause a readiness downgrade on their own. This is not an official exam, an accredited course, or a pass-rate prediction.</p>
        <p class="assessment-limitation-note">Technically validated: %(validation)s. See the <a href="%(root_prefix)smethodology/">assessment methodology</a> for how scoring, confidence and readiness safeguards work.</p>
      </div>
    </section>

    <section class="section section-tint" aria-labelledby="runner-title">
      <div class="wrap reading-width">
        <h2 id="runner-title">Start Your Free Diagnostic</h2>
        <p class="offer-trust-note"><strong>Independent preparation:</strong> Original CertShield practice questions — not exam dumps or official exam questions. No signup required; progress saves only in this browser.</p>
        <noscript><p class="noscript-note">This interactive diagnostic needs JavaScript. With JavaScript disabled, you can still review the domain coverage above and the official references linked throughout this page.</p></noscript>
        <div data-assessment-runner>
          <script type="application/json" data-assessment-payload>%(payload_json)s</script>
        </div>
      </div>
    </section>

    <section class="section section-white" aria-labelledby="next-title">
      <div class="wrap split">
        <div>
          <p class="eyebrow">Continue your preparation</p>
          <h2 id="next-title">Need a Full-Length Practice Exam?</h2>
          <p>Use this free diagnostic to evaluate the question style and your current readiness, then continue with the complete CertShield practice experience when you are ready.</p>
        </div>
        <aside class="card">
          <h3>Full practice course</h3>
          %(main_site_link)s
        </aside>
      </div>
    </section>
    """ % {
        "certification_name": esc(meta["certificationName"]),
        "vendor": esc(meta["vendor"]),
        "vendor_and_cert": esc(vendor_and_cert),
        "exam_code_suffix": (" (%s)" % esc(meta["examCode"]) if meta["examCode"] and "not specified" not in meta["examCode"].lower() else ""),
        "question_count": len(questions),
        "mcq_count": mcq_count,
        "msq_count": msq_count,
        "domain_count": len(domains),
        "duration": esc(meta["estimatedDuration"] or "Duration not specified"),
        "domain_rows": domain_rows,
        "blueprint_suffix": (" (%s)" % esc(meta["blueprintVersion"]) if meta["blueprintVersion"] else ""),
        "validation": esc(meta["finalTechnicalValidation"].split(".")[0] if meta["finalTechnicalValidation"] else "Not specified"),
        "root_prefix": esc(root_prefix),
        "payload_json": payload_json,
        "main_site_link": (
            '<p>View the complete CertShield course for %s.</p><a class="button button-primary" href="%s?utm_source=certshield_practice&amp;utm_medium=referral&amp;utm_campaign=assessment_landing" target="_blank" rel="noopener">View Full Practice Course ↗</a>'
            % (esc(meta["certificationName"]), esc(main_site_url))
            if main_site_url
            else '<p>A verified course link is not yet configured for this certification.</p>'
        ),
    }

    trail = [(BRAND, root_prefix + "index.html"), ("Assessments", root_prefix + "assessments/"), (meta["certificationName"], "")]
    structured_data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage",
                "@id": SITE_URL + "/assessments/" + slug + "/#webpage",
                "url": SITE_URL + "/assessments/" + slug + "/",
                "name": meta["certificationName"] + " Readiness Assessment",
                "description": "Free 30-question readiness diagnostic for " + vendor_and_cert + ".",
                "isPartOf": {"@id": SITE_URL + "/#website"},
                "dateModified": assessment.get("lastReviewed", ""),
            },
            breadcrumb_schema("assessments/" + slug + "/", trail),
        ],
    }

    return page_shell(
        title=meta["certificationName"] + " Free 30-Question Assessment | CertShield",
        description=(
            "Free 30-question readiness diagnostic for " + vendor_and_cert +
            ". Domain-level scoring, confidence calibration and explanation-led review."
        ),
        canonical_path="assessments/" + slug + "/",
        root_prefix=root_prefix,
        body_class="assessment-landing",
        nav_active="assessments",
        main_html=main_html,
        structured_data=structured_data,
        og_type="article",
        breadcrumb_html=breadcrumb_nav(root_prefix, trail),
    )


# ------------------------------------------------------------- offers page


def render_offers_page(offers_snapshot: dict) -> str:
    root_prefix = "../"
    now = datetime.now(timezone.utc)
    friendly_labels = {
        "free_targeted": "Community Free Access",
        "free_open": "Flash Free Access",
        "best_price": "Current Udemy Best Price",
        "custom_price": "Instructor Special Price",
    }
    rows = []
    for offer in offers_snapshot.get("offers", []):
        start = _parse_iso(offer.get("startAt"))
        end = _parse_iso(offer.get("endAt"))
        if start and end:
            status = "Upcoming" if now < start else ("Within scheduled offer window" if now < end else "Offer window ended")
        else:
            status = "Date unavailable"
        access_url = offer["couponUrl"] if status == "Within scheduled offer window" else offer.get("instructorReferralUrl", "")
        offer_type = offer.get("offerType", "")
        discount_price = (offer.get("discountPrice") or "").strip()
        currency = (offer.get("currency") or "").strip()
        if offer_type in ("best_price", "custom_price") and discount_price and discount_price != "0":
            limit_text = "Instructor price: %s %s (source market; Udemy confirms your local price)" % (discount_price, currency)
        else:
            redemptions = (offer.get("maximumRedemptions") or "").strip()
            limit_text = "Up to %s enrollments" % redemptions if redemptions else "No stated coupon redemption limit"
        rows.append(
            """<article class="card offer-card" data-filter-item data-vendor="%s" data-category="%s" data-status="%s">
    <p class="offer-badge badge">%s</p>
    <h3>%s</h3>
    <p class="offer-meta">%s</p>
    <p>%s</p>
    <p class="offer-expiry">%s – %s</p>
    <p><strong>Status:</strong> %s</p>
    %s
</article>"""
            % (
                esc(offer.get("vendor", "")), esc(offer.get("category", "")), esc(status.lower().replace(" ", "_")),
                esc(friendly_labels.get(offer["offerType"], offer["offerType"])),
                esc(offer["courseName"]), esc(offer.get("vendor", "")), esc(limit_text),
                esc(start.strftime("%B %d, %Y") if start else "Not stated"),
                esc(end.strftime("%B %d, %Y") if end else "Not stated"),
                esc(status),
                (
                    '<a class="button offer-cta" href="%s" target="_blank" rel="noopener sponsored">View this offer ↗</a>' % esc(access_url)
                    if access_url
                    else '<span class="assessment-cta-missing">No verified link available for this course.</span>'
                ),
            )
        )

    main_html = """
    <section class="page-hero">
      <div class="wrap">
        <p class="eyebrow">Verified course-specific promotions</p>
        <h1>Current CertShield Practice Exam Offers</h1>
        <p>Search for your certification, then use the exact current instructor promotion for that course. Udemy confirms final availability, pricing and currency; free offers can reach their redemption limit before the listed expiry; prices shown are source-market references, not guaranteed worldwide prices.</p>
        <p class="assessment-limitation-note">Snapshot generated: %(generated_at)s.</p>
      </div>
    </section>
    <section class="section section-white" data-filter-root>
      <div class="wrap">
        <div class="card-grid">%(rows)s</div>
      </div>
    </section>
    """ % {
        "generated_at": esc(offers_snapshot.get("generatedAt", "")),
        "rows": "".join(rows) if rows else '<p class="empty-state">No current offer data is available.</p>',
    }

    trail = [(BRAND, root_prefix + "index.html"), ("Community Offers", "")]
    structured_data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage",
                "@id": SITE_URL + "/offers/#webpage",
                "url": SITE_URL + "/offers/",
                "name": "Current CertShield Practice Exam Offers",
                "isPartOf": {"@id": SITE_URL + "/#website"},
            },
            breadcrumb_schema("offers/", trail),
        ],
    }

    return page_shell(
        title="Current CertShield Practice Exam Offers",
        description="Search current verified CertShield instructor offers for certification practice courses, with exact dates and truthful availability.",
        canonical_path="offers/",
        root_prefix=root_prefix,
        body_class="offers",
        nav_active="offers",
        main_html=main_html,
        structured_data=structured_data,
        breadcrumb_html=breadcrumb_nav(root_prefix, trail),
    )


def _parse_iso(value: str | None):
    if not value:
        return None
    from catalog_inputs import parse_iso_offer_datetime

    return parse_iso_offer_datetime(value)


# ----------------------------------------------------------- static pages


def render_methodology_page() -> str:
    root_prefix = "../"
    main_html = """
    <section class="page-hero"><div class="wrap">
      <p class="eyebrow">How it works</p>
      <h1>Assessment Methodology</h1>
      <p>How CertShield Practice builds, scores and safeguards every 30-question diagnostic.</p>
    </div></section>
    <section class="section section-white"><div class="wrap reading-width">
      <h2>How Questions Are Created</h2>
      <p>Every question is original CertShield content, written from verified official certification blueprints and documentation — never copied exam content, leaked material or recalled questions. Each question is reviewed for answer accuracy, selection cardinality, and current product terminology before publication, with a visible technical-validation date on every assessment page.</p>
      <h2>How Scoring Works</h2>
      <p>Each question is worth one point. A multi-answer question is correct only when your selected set exactly matches the correct set — extra or missing selections make it incorrect. Unanswered questions count as incorrect. Your raw score is a percentage of this one 30-question set; it is not an official psychometric score or a pass prediction.</p>
      <h2 id="readiness">Readiness Bands and Safeguards</h2>
      <table class="assessment-domain-table">
        <thead><tr><th scope="col">Correct</th><th scope="col">Initial readiness</th></tr></thead>
        <tbody>
          <tr><th scope="row">26–30</th><td>Strong readiness signal</td></tr>
          <tr><th scope="row">21–25</th><td>Targeted refinement needed</td></tr>
          <tr><th scope="row">17–20</th><td>Developing readiness</td></tr>
          <tr><th scope="row">0–16</th><td>Foundation strengthening recommended</td></tr>
        </tbody>
      </table>
      <p>Three safeguards can each downgrade your band by one level (never more than one total, and always explained): a "Strong" result requires all 30 questions answered; any domain with at least three questions scoring below 50% triggers a downgrade; and three or more questions answered incorrectly while marked "Sure" trigger a downgrade. Domains with fewer than three questions are always labelled "Limited evidence" and can never cause a downgrade by themselves.</p>
      <h2>Confidence Calibration</h2>
      <p>Marking your confidence as Sure, Unsure or Guessing never changes your raw score. It classifies each answer as stable knowledge (correct + sure), fragile knowledge (correct + unsure/guessing), a likely misconception (incorrect + sure), or a knowledge gap (incorrect + unsure/guessing) — so you know not just what you missed, but how confidently you missed it.</p>
      <h2 id="privacy">Privacy</h2>
      <p>This diagnostic makes no network requests while you take it. Your answers, confidence ratings and progress are stored only in your browser's local storage, namespaced to this assessment, and are never transmitted anywhere. Clearing your browser storage clears your history.</p>
      <h2>Disclaimer</h2>
      <p>CertShield Practice is an independent preparation resource. It is not affiliated with, endorsed by, or an official product of any certification vendor referenced on this site. A diagnostic result is not a guarantee of exam readiness or a passing score.</p>
    </div></section>
    """
    trail = [(BRAND, root_prefix + "index.html"), ("Methodology", "")]
    structured_data = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "WebPage", "@id": SITE_URL + "/methodology/#webpage", "url": SITE_URL + "/methodology/", "name": "Assessment Methodology", "isPartOf": {"@id": SITE_URL + "/#website"}},
            breadcrumb_schema("methodology/", trail),
        ],
    }
    return page_shell(
        title="Assessment Methodology | CertShield",
        description="How CertShield Practice builds, scores and safeguards every 30-question certification readiness diagnostic.",
        canonical_path="methodology/",
        root_prefix=root_prefix,
        body_class="methodology",
        nav_active="methodology",
        main_html=main_html,
        structured_data=structured_data,
        breadcrumb_html=breadcrumb_nav(root_prefix, trail),
    )


def render_about_page() -> str:
    root_prefix = "../"
    main_html = """
    <section class="page-hero"><div class="wrap">
      <p class="eyebrow">Independent instructor practice</p>
      <h1>About CertShield Practice</h1>
      <p>CertShield Practice is the free diagnostic companion to the CertShield certification-practice catalog.</p>
    </div></section>
    <section class="section section-white"><div class="wrap reading-width">
      <p>CertShield Practice exists to answer one question before you commit to a paid practice course: "Am I actually ready?" Each free 30-question diagnostic gives an evidence-based, domain-level readiness signal with fully explained reasoning — original content, technically validated against current official certification documentation.</p>
      <p>CertShield Practice is built and maintained by instructor Priya D, whose full-length practice-exam catalog is available at <a href="%s/?utm_source=certshield_practice&amp;utm_medium=referral&amp;utm_campaign=about" target="_blank" rel="noopener">certshield.co.in</a> and on <a href="%s" target="_blank" rel="noopener noreferrer">Udemy</a>. This diagnostic site is independent of, and not affiliated with, any certification vendor named on it.</p>
      <p>See the <a href="%smethodology/">assessment methodology</a> for how scoring and readiness safeguards work.</p>
    </div></section>
    """ % (MAIN_SITE_URL, esc(INSTRUCTOR_PROFILE_URL), root_prefix)
    trail = [(BRAND, root_prefix + "index.html"), ("About", "")]
    structured_data = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "AboutPage", "@id": SITE_URL + "/about/#webpage", "url": SITE_URL + "/about/", "name": "About CertShield Practice", "isPartOf": {"@id": SITE_URL + "/#website"}},
            breadcrumb_schema("about/", trail),
        ],
    }
    return page_shell(
        title="About CertShield Practice",
        description="CertShield Practice is the free, independent diagnostic-assessment companion to the CertShield certification-practice catalog.",
        canonical_path="about/",
        root_prefix=root_prefix,
        body_class="about",
        nav_active="about",
        main_html=main_html,
        structured_data=structured_data,
        breadcrumb_html=breadcrumb_nav(root_prefix, trail),
    )


def render_404_page() -> str:
    root_prefix = ""
    main_html = """
    <section class="page-hero"><div class="wrap">
      <h1>Page Not Found</h1>
      <p>The page you were looking for doesn't exist or may have moved.</p>
      <div class="hero-actions">
        <a class="button button-primary" href="%(root_prefix)sassessments/">Browse Assessments</a>
        <a class="button button-secondary" href="%(root_prefix)soffers/">Current Offers</a>
        <a class="button button-text" href="%(root_prefix)sindex.html">Homepage</a>
      </div>
    </div></section>
    """ % {"root_prefix": root_prefix}
    structured_data = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": SITE_URL + "/404.html",
        "name": "Page Not Found",
    }
    return page_shell(
        title="Page Not Found | CertShield",
        description="The page you were looking for doesn't exist or may have moved.",
        canonical_path="404.html",
        root_prefix=root_prefix,
        body_class="not-found",
        nav_active="",
        main_html=main_html,
        structured_data=structured_data,
    )


def render_sitemap(urls: list[tuple[str, str]]) -> str:
    """urls: list of (path, lastmod_date) pairs, path relative to SITE_URL."""
    entries = "\n".join(
        "  <url><loc>%s/%s</loc><lastmod>%s</lastmod></url>" % (SITE_URL, esc(path), esc(lastmod))
        for path, lastmod in urls
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + entries
        + "\n</urlset>\n"
    )
