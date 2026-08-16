import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts"))
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts" / "import"))

import catalog as cat  # noqa: E402


def coupon(course_id, name="Sample Course", offer_type="free_targeted", slug=None):
    slug = slug or ("course-" + course_id)
    return {
        "course_id": course_id,
        "course_name": name,
        "coupon_type": offer_type,
        "maximum_redemptions": "100",
        "coupon_code": "SAMPLE26",
        "start_date_time": "2026-08-01 00:00 PDT",
        "end_date_time": "2026-09-01 00:00 PDT",
        "currency": "INR",
        "discount_price": "0",
        "course_coupon_url": "https://www.udemy.com/course/%s/?couponCode=SAMPLE26" % slug,
    }


def referral(course_id, url_code="CODE1"):
    return {
        "course_id": course_id,
        "course_name": "Sample Course",
        "instructor_referral_url": "https://www.udemy.com/course/course-%s/?referralCode=%s" % (course_id, url_code),
    }


class CatalogMergeTests(unittest.TestCase):
    def test_first_build_creates_new_courses_and_locks_referrals(self):
        catalog, referral_catalog, report = cat.build_course_catalog(
            [coupon("111"), coupon("222")], [referral("111"), referral("222")],
            None, None, {}, "2026-01-01T00:00:00Z",
        )
        self.assertEqual(set(catalog.keys()), {"111", "222"})
        self.assertEqual(set(report.new_course_ids), {"111", "222"})
        self.assertEqual(referral_catalog["111"]["instructorReferralUrl"], referral("111")["instructor_referral_url"])
        self.assertEqual(report.referral_required_for_new_course, [])

    def test_course_absent_from_later_export_is_retained_not_deleted(self):
        catalog, _, _ = cat.build_course_catalog(
            [coupon("111")], [referral("111")], None, None, {}, "2026-01-01T00:00:00Z"
        )
        catalog2, _, report2 = cat.build_course_catalog(
            [coupon("222")], [referral("222")], catalog, {"111": {"instructorReferralUrl": "x"}}, {}, "2026-02-01T00:00:00Z"
        )
        self.assertIn("111", catalog2)
        self.assertFalse(catalog2["111"]["presentInLatestCouponExport"])
        self.assertEqual(report2.absent_course_ids, ["111"])

    def test_new_coupon_course_without_referral_is_reported(self):
        _, _, report = cat.build_course_catalog(
            [coupon("111")], [], None, None, {}, "2026-01-01T00:00:00Z", require_referrals=True
        )
        self.assertEqual(report.referral_required_for_new_course, ["111"])

    def test_referral_conflict_retains_locked_url_and_reports_high_severity(self):
        catalog, referral_catalog, _ = cat.build_course_catalog(
            [coupon("111")], [referral("111", url_code="ORIGINAL")], None, None, {}, "2026-01-01T00:00:00Z"
        )
        prev_referrals = referral_catalog
        _, referral_catalog_2, report2 = cat.build_course_catalog(
            [coupon("111")], [referral("111", url_code="DIFFERENT")], catalog, prev_referrals, {}, "2026-02-01T00:00:00Z"
        )
        self.assertEqual(len(report2.referral_conflicts), 1)
        self.assertEqual(report2.referral_conflicts[0]["severity"], "high")
        # locked URL must be retained, never silently overwritten
        self.assertIn("ORIGINAL", referral_catalog_2["111"]["instructorReferralUrl"])

    def test_title_change_is_logged_not_a_join_failure(self):
        catalog, _, _ = cat.build_course_catalog(
            [coupon("5885448", name="Name In Coupon Export")], [referral("5885448")],
            None, None, {}, "2026-01-01T00:00:00Z",
        )
        _, _, report2 = cat.build_course_catalog(
            [coupon("5885448", name="Renamed Course Title")], [],
            catalog, {"5885448": {"instructorReferralUrl": "x"}}, {}, "2026-02-01T00:00:00Z",
        )
        self.assertEqual(len(report2.title_changes), 1)
        self.assertEqual(report2.title_changes[0]["previousName"], "Name In Coupon Export")
        self.assertEqual(report2.title_changes[0]["currentName"], "Renamed Course Title")

    def test_course_overrides_populate_verified_metadata_by_slug(self):
        overrides = {"course-111": {"vendor": "AWS", "category": "Cloud", "mainSiteUrl": "https://certshield.co.in/x.html"}}
        catalog, _, _ = cat.build_course_catalog(
            [coupon("111")], [referral("111")], None, None, overrides, "2026-01-01T00:00:00Z"
        )
        self.assertEqual(catalog["111"]["vendor"], "AWS")
        self.assertEqual(catalog["111"]["metadataSource"], "course-overrides")

    def test_course_without_override_is_marked_unclassified_not_guessed(self):
        catalog, _, _ = cat.build_course_catalog(
            [coupon("111")], [referral("111")], None, None, {}, "2026-01-01T00:00:00Z"
        )
        self.assertEqual(catalog["111"]["vendor"], "Unclassified")
        self.assertEqual(catalog["111"]["metadataSource"], "unclassified")


class AssessmentResolverTests(unittest.TestCase):
    def build_catalog(self):
        rows = [
            coupon("1", name="Databricks Generative AI Engineer Associate: Practice Exam"),
            coupon("2", name="Databricks Context Engineer Associate Practice Exams 2026"),
            coupon("3", name="Databricks Data Engineer Associate Practice Exam 2026"),
        ]
        catalog, _, _ = cat.build_course_catalog(rows, [], None, None, {}, "2026-01-01T00:00:00Z", require_referrals=False)
        return catalog

    def test_unambiguous_match_auto_resolves(self):
        catalog = self.build_catalog()
        course_id, candidates = cat.resolve_assessment_course_mapping(
            "Databricks", "Databricks Certified Generative AI Engineer Associate",
            "Not specified in official documentation", "databricks-genai-engineer-30q.md", catalog,
        )
        self.assertEqual(course_id, "1")

    def test_ambiguous_match_returns_ranked_candidates_without_guessing(self):
        rows = [
            coupon("1", name="Vendor X Widget Associate Practice Exam"),
            coupon("2", name="Vendor X Widget Professional Practice Exam"),
        ]
        catalog, _, _ = cat.build_course_catalog(rows, [], None, None, {}, "2026-01-01T00:00:00Z", require_referrals=False)
        course_id, candidates = cat.resolve_assessment_course_mapping(
            "Vendor X", "Vendor X Widget", "", "vendor-x-widget-30q.md", catalog
        )
        self.assertIsNone(course_id)
        self.assertGreaterEqual(len(candidates), 2)

    def test_no_match_returns_none_and_empty_candidates(self):
        catalog = self.build_catalog()
        course_id, candidates = cat.resolve_assessment_course_mapping(
            "Unrelated Vendor", "Completely Unrelated Certification Name", "", "unrelated.md", catalog
        )
        self.assertIsNone(course_id)
        self.assertEqual(candidates, [])


class OffersSnapshotTests(unittest.TestCase):
    def test_snapshot_includes_referral_fallback_and_never_mixes_urls(self):
        catalog, referral_catalog, _ = cat.build_course_catalog(
            [coupon("111")], [referral("111")], None, None, {}, "2026-01-01T00:00:00Z"
        )
        snapshot = cat.build_offers_snapshot([coupon("111")], catalog, referral_catalog, "2026-01-01T00:00:00Z")
        offer = snapshot["offers"][0]
        self.assertTrue(offer["couponUrl"].startswith("https://"))
        self.assertIn("couponCode=", offer["couponUrl"])
        self.assertIn("referralCode=", offer["instructorReferralUrl"])
        self.assertNotEqual(offer["couponUrl"], offer["instructorReferralUrl"])


class UdemySlugTests(unittest.TestCase):
    def test_extracts_slug_from_course_url(self):
        self.assertEqual(
            cat.udemy_course_slug("https://www.udemy.com/course/my-course-slug/?couponCode=X"),
            "my-course-slug",
        )

    def test_empty_for_non_course_url(self):
        self.assertEqual(cat.udemy_course_slug("https://www.udemy.com/"), "")
        self.assertEqual(cat.udemy_course_slug(""), "")


if __name__ == "__main__":
    unittest.main()
