#!/usr/bin/env python3
"""CertShield Practice framework build orchestrator.

Implements the master-prompt TASK_MODE dispatch (FRAMEWORK_BUILD /
UPSERT_ASSESSMENT / MONTHLY_OFFERS_UPDATE / NEW_COURSE_SYNC): discovers the
three user-supplied inputs, imports/validates them, merges the persistent
course catalog, resolves assessment-to-course mappings, generates all data/
and HTML output, and publishes atomically (nothing is written unless every
blocking validation check passes). Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "scripts" / "import"))

from catalog_inputs import discover_candidate_tables, dedupe_by_hash, parse_coupons, parse_referrals  # noqa: E402
from markdown_assessment import is_assessment_markdown, parse_assessment_markdown  # noqa: E402
from catalog import (  # noqa: E402
    build_course_catalog,
    build_offers_snapshot,
    load_course_overrides,
    resolve_assessment_course_mapping,
)
import render_site  # noqa: E402

CONFIG_PATH = ROOT / "config" / "certshield.project.json"
ASSESSMENT_MAP_PATH = ROOT / "config" / "assessment-course-map.json"
COURSE_OVERRIDES_PATH = ROOT / "data" / "course-overrides.json"
CATALOG_PATH = ROOT / "data" / "catalog" / "courses.json"
REFERRALS_PATH = ROOT / "data" / "catalog" / "referrals.json"
ASSESSMENTS_DIR = ROOT / "data" / "assessments"
MANIFEST_PATH = ASSESSMENTS_DIR / "manifest.json"
OFFERS_PATH = ROOT / "data" / "offers" / "current.json"
IMPORT_REPORTS_DIR = ROOT / "data" / "import-reports"
EXCLUDED_SCAN_DIRS = {
    ".git", ".github", ".vscode", "node_modules", "__pycache__", "assets",
    "data", "scripts", "tests", "docs", "config", "templates",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-+", "-", slug)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def discover_assessment_markdown_files(root: Path) -> list[Path]:
    candidates: list[Path] = []
    for path in root.rglob("*.md"):
        if any(part in EXCLUDED_SCAN_DIRS for part in path.relative_to(root).parts[:-1]):
            continue
        if is_assessment_markdown(path):
            candidates.append(path)
    return sorted(candidates)


def extract_technical_validation_date(text: str) -> str:
    match = re.search(r"Completed\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})", text or "")
    if not match:
        return ""
    try:
        return datetime.strptime(match.group(1), "%B %d, %Y").date().isoformat()
    except ValueError:
        return ""


def content_hash_version(sha256: str) -> str:
    return sha256[:12]


def import_catalog_inputs(root: Path, config: dict) -> tuple[Any, Any, list[str]]:
    overrides = config.get("inputOverrides", {})
    coupon_override = overrides.get("couponSheet")
    referral_override = overrides.get("referralSheet")

    if coupon_override or referral_override:
        candidates = []
        if coupon_override:
            candidates.append((root / coupon_override, "", "coupons"))
        if referral_override:
            candidates.append((root / referral_override, "", "referrals"))
        skipped: list[str] = []
    else:
        all_candidates = discover_candidate_tables(root)
        candidates, skipped = dedupe_by_hash(all_candidates)

    coupons_result = None
    referrals_result = None
    for path, sheet, kind in candidates:
        if kind == "coupons" and coupons_result is None:
            coupons_result = parse_coupons(path, sheet)
        elif kind == "referrals" and referrals_result is None:
            referrals_result = parse_referrals(path, sheet)

    return coupons_result, referrals_result, skipped


def build_report_and_data(root: Path, config: dict, task_mode: str, dry_run: bool = False) -> dict[str, Any]:
    report: dict[str, Any] = {
        "taskMode": task_mode,
        "generatedAt": now_iso(),
        "inputs": {},
        "catalog": {},
        "assessments": [],
        "warnings": [],
        "errors": [],
    }

    coupons_result, referrals_result, skipped_duplicates = import_catalog_inputs(root, config)
    report["inputs"]["skippedDuplicates"] = skipped_duplicates

    if coupons_result is None:
        report["errors"].append("No monthly active-coupons file (Input A) was found or matched by header signature.")
        return report
    report["inputs"]["couponFile"] = {
        "path": coupons_result.source_file,
        "sha256": coupons_result.sha256,
        "rows": len(coupons_result.rows),
        "rowErrors": [error.to_dict() for error in coupons_result.errors],
    }

    referral_rows: list[dict[str, str]] = []
    if referrals_result is not None:
        report["inputs"]["referralFile"] = {
            "path": referrals_result.source_file,
            "sha256": referrals_result.sha256,
            "rows": len(referrals_result.rows),
            "rowErrors": [error.to_dict() for error in referrals_result.errors],
        }
        referral_rows = referrals_result.rows
    elif task_mode == "FRAMEWORK_BUILD":
        report["warnings"].append("No instructor-referral file (Input B) was found for this first build.")

    previous_catalog_payload = load_json(CATALOG_PATH, {}).get("courses", {})
    previous_referrals_payload = load_json(REFERRALS_PATH, {}).get("referrals", {})
    course_overrides = load_course_overrides(COURSE_OVERRIDES_PATH)

    catalog, referral_catalog, catalog_report = build_course_catalog(
        coupons_result.rows,
        referral_rows,
        previous_catalog_payload,
        previous_referrals_payload,
        course_overrides,
        now_iso(),
        require_referrals=(referrals_result is not None or bool(previous_referrals_payload)),
    )
    report["catalog"] = {
        "totalCourses": len(catalog),
        "newCourseIds": catalog_report.new_course_ids,
        "reappearedCourseIds": catalog_report.reappeared_course_ids,
        "absentCourseIds": catalog_report.absent_course_ids,
        "titleChanges": catalog_report.title_changes,
        "referralRequiredForNewCourse": catalog_report.referral_required_for_new_course,
        "referralConflicts": catalog_report.referral_conflicts,
        "referralNewIdsAppended": catalog_report.referral_new_ids_appended,
    }
    if catalog_report.referral_conflicts:
        report["errors"].append(
            "%d referral URL conflict(s) detected; locked URLs were retained (see catalog.referralConflicts)."
            % len(catalog_report.referral_conflicts)
        )

    # ---- assessment markdown import ----
    assessment_map = load_json(ASSESSMENT_MAP_PATH, {"schemaVersion": 1, "mappings": {}})
    md_files = discover_assessment_markdown_files(root)
    assessments_by_slug: dict[str, dict[str, Any]] = {}

    for md_path in md_files:
        parsed = parse_assessment_markdown(md_path)
        entry: dict[str, Any] = {
            "sourceFile": str(md_path.relative_to(root)),
            "sha256": parsed.sha256,
            "valid": parsed.valid,
            "errors": [error.to_dict() for error in parsed.errors],
        }
        if not parsed.valid:
            report["errors"].append(
                "Assessment '%s' failed validation with %d error(s); it was not published."
                % (md_path.name, len(parsed.errors))
            )
            report["assessments"].append(entry)
            continue

        slug = slugify(parsed.meta["certificationName"])
        content_version = content_hash_version(parsed.sha256)
        existing_mapping = assessment_map["mappings"].get(slug)

        if existing_mapping:
            course_id = existing_mapping.get("courseId")
        else:
            course_id, candidates = resolve_assessment_course_mapping(
                parsed.meta["vendor"], parsed.meta["certificationName"], parsed.meta["examCode"],
                md_path.name, catalog,
            )
            if course_id:
                assessment_map["mappings"][slug] = {
                    "courseId": course_id,
                    "resolvedAt": now_iso(),
                    "resolution": "auto",
                }
            else:
                report["warnings"].append(
                    "Assessment '%s' has an ambiguous course mapping; publishing without a commercial CTA. Candidates: %s"
                    % (slug, json.dumps([candidate.to_dict() for candidate in candidates]))
                )

        if course_id and course_id in catalog:
            catalog[course_id]["assessmentSlug"] = slug

        for question in parsed.questions:
            question["id"] = "q%d" % question["number"]

        assessment_data = {
            "schemaVersion": 1,
            "slug": slug,
            "sourceFile": entry["sourceFile"],
            "sourceHash": parsed.sha256,
            "importedAt": now_iso(),
            "contentVersion": content_version,
            "courseId": course_id,
            "meta": parsed.meta,
            "lastReviewed": extract_technical_validation_date(parsed.meta.get("finalTechnicalValidation", "")),
            "questions": parsed.questions,
        }
        assessments_by_slug[slug] = assessment_data
        entry["slug"] = slug
        entry["courseId"] = course_id
        entry["contentVersion"] = content_version
        report["assessments"].append(entry)

    if not dry_run:
        write_json(ASSESSMENT_MAP_PATH, assessment_map)

    offers_snapshot = build_offers_snapshot(coupons_result.rows, catalog, referral_catalog, now_iso())

    return {
        "report": report,
        "catalog": catalog,
        "referralCatalog": referral_catalog,
        "assessmentsBySlug": assessments_by_slug,
        "offersSnapshot": offers_snapshot,
        "couponSha": coupons_result.sha256,
        "referralSha": referrals_result.sha256 if referrals_result else previous_referrals_payload,
    }


def render_all_pages(build: dict[str, Any]) -> dict[str, str]:
    catalog = build["catalog"]
    assessments_by_slug = build["assessmentsBySlug"]
    offers_snapshot = build["offersSnapshot"]

    manifest = []
    for slug, assessment in assessments_by_slug.items():
        questions = assessment["questions"]
        manifest.append(
            {
                "slug": slug,
                "status": "published",
                "courseId": assessment["courseId"],
                "vendor": assessment["meta"]["vendor"],
                "certificationName": assessment["meta"]["certificationName"],
                "examCode": assessment["meta"]["examCode"],
                "category": catalog.get(assessment["courseId"], {}).get("category", "Unclassified") if assessment["courseId"] else "Unclassified",
                "questionCount": len(questions),
                "mcqCount": sum(1 for q in questions if q["selectionMode"] == "single"),
                "msqCount": sum(1 for q in questions if q["selectionMode"] == "multiple"),
                "domains": sorted({q["domain"] for q in questions}),
                "estimatedDuration": assessment["meta"]["estimatedDuration"],
                "contentVersion": assessment["contentVersion"],
                "lastReviewed": assessment["lastReviewed"],
                "sourceFile": assessment["sourceFile"],
            }
        )
    manifest.sort(key=lambda item: item["certificationName"])

    pages: dict[str, str] = {}
    pages["index.html"] = render_site.render_homepage(catalog, manifest, offers_snapshot)
    pages["assessments/index.html"] = render_site.render_assessment_directory(catalog, manifest)
    pages["offers/index.html"] = render_site.render_offers_page(offers_snapshot)
    pages["methodology/index.html"] = render_site.render_methodology_page()
    pages["about/index.html"] = render_site.render_about_page()
    pages["404.html"] = render_site.render_404_page()

    offer_by_course_id = {offer["courseId"]: offer for offer in offers_snapshot.get("offers", [])}
    for slug, assessment in assessments_by_slug.items():
        course_id = assessment["courseId"]
        catalog_entry = catalog.get(course_id) if course_id else None
        offer = offer_by_course_id.get(course_id) if course_id else None
        pages["assessments/%s/index.html" % slug] = render_site.render_assessment_landing(
            assessment, catalog_entry, offer, course_id
        )

    sitemap_urls: list[tuple[str, str]] = [("", now_iso()[:10]), ("assessments/", now_iso()[:10])]
    for slug, assessment in assessments_by_slug.items():
        sitemap_urls.append(("assessments/%s/" % slug, assessment["lastReviewed"] or now_iso()[:10]))
    if offers_snapshot.get("offers"):
        sitemap_urls.append(("offers/", now_iso()[:10]))
    sitemap_urls.append(("methodology/", now_iso()[:10]))
    sitemap_urls.append(("about/", now_iso()[:10]))
    pages["sitemap.xml"] = render_site.render_sitemap(sitemap_urls)

    return pages, manifest


def validate_staged_pages(pages: dict[str, str]) -> list[str]:
    errors = []
    for path, content in pages.items():
        if path.endswith(".html"):
            if "@@" in content:
                errors.append("%s still contains an unresolved template placeholder." % path)
            if "<title>" not in content and path != "404.html":
                errors.append("%s is missing a <title> tag." % path)
            if "<html" not in content:
                errors.append("%s does not look like a complete HTML document." % path)
        elif path.endswith(".xml"):
            import xml.etree.ElementTree as ET

            try:
                ET.fromstring(content)
            except ET.ParseError as error:
                errors.append("%s is not well-formed XML: %s" % (path, error))
    return errors


def publish(build: dict[str, Any], pages: dict[str, str], manifest: list[dict], dry_run: bool) -> list[str]:
    validation_errors = validate_staged_pages(pages)
    if validation_errors:
        return validation_errors
    if dry_run:
        return []

    for relative_path, content in pages.items():
        write_text(ROOT / relative_path, content)

    write_json(
        CATALOG_PATH,
        {
            "schemaVersion": 1,
            "sourceHash": build["couponSha"],
            "importedAt": now_iso(),
            "courses": build["catalog"],
        },
    )
    write_json(
        REFERRALS_PATH,
        {
            "schemaVersion": 1,
            "importedAt": now_iso(),
            "referrals": build["referralCatalog"],
        },
    )
    write_json(OFFERS_PATH, build["offersSnapshot"])
    write_json(MANIFEST_PATH, {"schemaVersion": 1, "generatedAt": now_iso(), "assessments": manifest})
    for slug, assessment in build["assessmentsBySlug"].items():
        write_json(ASSESSMENTS_DIR / ("%s.json" % slug), assessment)

    return []


def main() -> int:
    parser = argparse.ArgumentParser(description="CertShield Practice framework build")
    parser.add_argument("--task-mode", default=None, choices=["FRAMEWORK_BUILD", "UPSERT_ASSESSMENT", "MONTHLY_OFFERS_UPDATE", "NEW_COURSE_SYNC"])
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    root = Path(args.root)
    config = load_json(CONFIG_PATH, {})
    task_mode = args.task_mode or config.get("taskMode", "FRAMEWORK_BUILD")

    build = build_report_and_data(root, config, task_mode, dry_run=args.dry_run)
    report = build["report"]

    if report["errors"] and task_mode == "FRAMEWORK_BUILD" and "catalog" not in build:
        IMPORT_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        write_json(IMPORT_REPORTS_DIR / ("%s-%s.json" % (now_iso().replace(":", "").split(".")[0], task_mode.lower())), report)
        print(json.dumps(report, indent=2))
        return 1

    pages, manifest = render_all_pages(build)
    publish_errors = publish(build, pages, manifest, args.dry_run)
    if publish_errors:
        report["errors"].extend(publish_errors)

    IMPORT_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = IMPORT_REPORTS_DIR / ("%s-%s.json" % (now_iso().replace(":", "").split(".")[0], task_mode.lower()))
    write_json(report_path, report)

    print("CertShield build (%s) %s" % (task_mode, "DRY RUN" if args.dry_run else "complete"))
    print("  Courses in catalog: %d" % report["catalog"].get("totalCourses", 0))
    print("  Assessments discovered: %d" % len(report["assessments"]))
    print("  Warnings: %d, Errors: %d" % (len(report["warnings"]), len(report["errors"])))
    for warning in report["warnings"]:
        print("  WARN: %s" % warning)
    for error in report["errors"]:
        print("  ERROR: %s" % error)
    print("  Report: %s" % report_path.relative_to(ROOT))

    if args.strict and (report["errors"] or publish_errors):
        return 1
    return 1 if publish_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
