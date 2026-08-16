#!/usr/bin/env python3
"""Course/referral/offer catalog model (master-prompt section 6) and the
assessment-to-course resolver (section 4).

Standard library only.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from catalog_inputs import parse_iso_offer_datetime


def udemy_course_slug(url: str) -> str:
    """Extract the '/course/<slug>/' segment from a Udemy course URL."""
    if not url:
        return ""
    path = urlparse(url).path
    parts = [segment for segment in path.split("/") if segment]
    if len(parts) >= 2 and parts[0] == "course":
        return parts[1]
    return ""


def load_course_overrides(path: Path) -> dict[str, dict[str, Any]]:
    """Load the repo's pre-existing, human-curated data/course-overrides.json.

    This is reused (not fabricated) verified presentation metadata: vendor,
    category, certification name and main-site URL that a human already
    curated for the sibling certshield.co.in site. Keyed by Udemy course
    slug.
    """
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("courses", {})


@dataclass
class CatalogBuildReport:
    new_course_ids: list[str] = field(default_factory=list)
    reappeared_course_ids: list[str] = field(default_factory=list)
    absent_course_ids: list[str] = field(default_factory=list)
    title_changes: list[dict[str, str]] = field(default_factory=list)
    referral_required_for_new_course: list[str] = field(default_factory=list)
    referral_conflicts: list[dict[str, str]] = field(default_factory=list)
    referral_new_ids_appended: list[str] = field(default_factory=list)


def build_course_catalog(
    coupon_rows: list[dict[str, str]],
    referral_rows: list[dict[str, str]],
    previous_catalog: dict[str, dict[str, Any]] | None,
    previous_referrals: dict[str, dict[str, Any]] | None,
    course_overrides: dict[str, dict[str, Any]],
    now_iso: str,
    require_referrals: bool = True,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], CatalogBuildReport]:
    """Merge the latest coupon inventory with the locked referral map.

    Returns (course_catalog, referral_catalog, report). Never deletes a
    course absent from a later coupon export; never overwrites a locked
    referral URL without an explicit conflict report.
    """
    report = CatalogBuildReport()
    catalog: dict[str, dict[str, Any]] = {
        course_id: dict(entry) for course_id, entry in (previous_catalog or {}).items()
    }
    referral_catalog: dict[str, dict[str, Any]] = {
        course_id: dict(entry) for course_id, entry in (previous_referrals or {}).items()
    }

    coupon_by_id = {row["course_id"]: row for row in coupon_rows}
    referral_by_id = {row["course_id"]: row for row in referral_rows}

    # --- lock/append/conflict referral URLs ---
    for course_id, referral_row in referral_by_id.items():
        new_url = referral_row["instructor_referral_url"]
        existing = referral_catalog.get(course_id)
        if existing is None:
            referral_catalog[course_id] = {
                "courseId": course_id,
                "instructorReferralUrl": new_url,
                "lockedAt": now_iso,
                "courseNameAtLock": referral_row.get("course_name", ""),
            }
            report.referral_new_ids_appended.append(course_id)
        elif existing["instructorReferralUrl"] != new_url:
            report.referral_conflicts.append(
                {
                    "courseId": course_id,
                    "lockedUrl": existing["instructorReferralUrl"],
                    "importedUrl": new_url,
                    "severity": "high",
                }
            )
            # Retain the locked URL; never overwrite without explicit migration.

    # --- upsert catalog from the latest coupon export ---
    for course_id, coupon_row in coupon_by_id.items():
        existing = catalog.get(course_id)
        course_name = coupon_row.get("course_name", "")
        slug = udemy_course_slug(coupon_row.get("course_coupon_url", ""))
        override = course_overrides.get(slug, {})
        override_has_metadata = bool(override.get("vendor") or override.get("category"))

        if existing is None:
            report.new_course_ids.append(course_id)
            catalog[course_id] = {
                "courseId": course_id,
                "courseName": course_name,
                "udemySlug": slug,
                "vendor": override.get("vendor", "Unclassified"),
                "certificationName": override.get("certificationName", ""),
                "certificationCode": override.get("examCode", ""),
                "category": override.get("category", "Unclassified"),
                "mainSiteUrl": override.get("mainSiteUrl", ""),
                "metadataSource": "course-overrides" if override_has_metadata else "unclassified",
                "assessmentSlug": None,
                "instructorReferralUrl": referral_catalog.get(course_id, {}).get("instructorReferralUrl"),
                "presentInLatestCouponExport": True,
                "firstSeenAt": now_iso,
                "lastSeenAt": now_iso,
            }
        else:
            if existing.get("presentInLatestCouponExport") is False:
                report.reappeared_course_ids.append(course_id)
            if existing.get("courseName") and existing["courseName"] != course_name:
                report.title_changes.append(
                    {"courseId": course_id, "previousName": existing["courseName"], "currentName": course_name}
                )
            existing["courseName"] = course_name
            existing["udemySlug"] = slug or existing.get("udemySlug", "")
            if not existing.get("mainSiteUrl") and override.get("mainSiteUrl"):
                existing["mainSiteUrl"] = override["mainSiteUrl"]
            if override_has_metadata and existing.get("metadataSource") in (None, "unclassified"):
                existing["vendor"] = override.get("vendor", existing.get("vendor", "Unclassified"))
                existing["category"] = override.get("category", existing.get("category", "Unclassified"))
                existing["certificationName"] = override.get("certificationName", existing.get("certificationName", ""))
                existing["metadataSource"] = "course-overrides"
            existing["instructorReferralUrl"] = referral_catalog.get(course_id, {}).get(
                "instructorReferralUrl", existing.get("instructorReferralUrl")
            )
            existing["presentInLatestCouponExport"] = True
            existing["lastSeenAt"] = now_iso
            catalog[course_id] = existing

        if course_id not in referral_catalog and require_referrals:
            report.referral_required_for_new_course.append(course_id)

    # --- mark courses absent from this run without deleting them ---
    for course_id, entry in catalog.items():
        if course_id not in coupon_by_id:
            if entry.get("presentInLatestCouponExport", True):
                report.absent_course_ids.append(course_id)
            entry["presentInLatestCouponExport"] = False

    return catalog, referral_catalog, report


_STOPWORDS = {
    "the", "a", "an", "of", "for", "and", "with", "on", "in", "to", "practice",
    "exam", "exams", "test", "tests", "mock", "prep", "certification", "certified",
    "professional", "associate", "specialist", "questions", "question", "2024",
    "2025", "2026", "updated", "full", "length", "pro",
}


def _tokenize(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {word for word in words if word not in _STOPWORDS and len(word) > 1}


@dataclass
class MappingCandidate:
    course_id: str
    course_name: str
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {"courseId": self.course_id, "courseName": self.course_name, "score": round(self.score, 3)}


def resolve_assessment_course_mapping(
    vendor: str,
    certification_name: str,
    exam_code: str,
    source_filename: str,
    catalog: dict[str, dict[str, Any]],
) -> tuple[str | None, list[MappingCandidate]]:
    """Resolve an assessment to exactly one course_id, or return ranked candidates.

    Compares vendor, certification name, exam code and filename against each
    catalog course's title/certificationName/vendor. Auto-resolves only when
    exactly one candidate is clearly ahead; otherwise returns the ranked list
    for the human to confirm in config (never guesses a revenue destination).
    """
    query_tokens = _tokenize(certification_name) | _tokenize(source_filename)
    vendor_tokens = _tokenize(vendor)
    exam_code_clean = (exam_code or "").strip().lower()
    honest_unknown = exam_code_clean in ("", "not specified in official documentation")

    scored: list[MappingCandidate] = []
    for course_id, entry in catalog.items():
        course_name = entry.get("courseName", "")
        candidate_tokens = _tokenize(course_name) | _tokenize(entry.get("certificationName", ""))
        overlap = query_tokens & candidate_tokens
        if not overlap:
            continue
        score = len(overlap) / max(1, len(query_tokens))
        candidate_vendor_tokens = _tokenize(entry.get("vendor", "")) | _tokenize(course_name)
        if vendor_tokens and (vendor_tokens & candidate_vendor_tokens):
            score += 0.5
        if not honest_unknown and exam_code_clean and exam_code_clean in course_name.lower():
            score += 0.75
        scored.append(MappingCandidate(course_id, course_name, score))

    scored.sort(key=lambda candidate: candidate.score, reverse=True)
    if not scored:
        return None, []
    unambiguous = len(scored) == 1 or (
        scored[0].score >= 0.6 and (scored[0].score - scored[1].score) >= 0.15
    )
    if unambiguous:
        return scored[0].course_id, scored

    return None, scored[:5]


def build_offers_snapshot(
    coupon_rows: list[dict[str, str]],
    catalog: dict[str, dict[str, Any]],
    referral_catalog: dict[str, dict[str, Any]],
    now_iso: str,
) -> dict[str, Any]:
    """Replace the current monthly offer snapshot from the latest coupon file."""
    offers = []
    for row in coupon_rows:
        course_id = row["course_id"]
        entry = catalog.get(course_id, {})
        referral = referral_catalog.get(course_id, {})
        offers.append(
            {
                "courseId": course_id,
                "courseName": row.get("course_name", ""),
                "udemySlug": entry.get("udemySlug", udemy_course_slug(row.get("course_coupon_url", ""))),
                "offerType": row.get("coupon_type", ""),
                "couponCode": row.get("coupon_code", ""),
                "startAt": row.get("start_date_time", ""),
                "endAt": row.get("end_date_time", ""),
                "currency": row.get("currency", ""),
                "discountPrice": row.get("discount_price", ""),
                "maximumRedemptions": row.get("maximum_redemptions", ""),
                "couponUrl": row.get("course_coupon_url", ""),
                "instructorReferralUrl": referral.get("instructorReferralUrl", ""),
                "vendor": entry.get("vendor", "Unclassified"),
                "category": entry.get("category", "Unclassified"),
                "assessmentSlug": entry.get("assessmentSlug"),
            }
        )
    return {
        "schemaVersion": 1,
        "generatedAt": now_iso,
        "offers": offers,
    }
