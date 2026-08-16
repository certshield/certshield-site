import csv
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts" / "import"))

import catalog_inputs as ci  # noqa: E402

COUPON_HEADERS = list(ci.COUPON_HEADERS)
# Fix a stable column order for CSV writing (set iteration order is arbitrary).
COUPON_COLUMNS = [
    "course_id", "course_name", "coupon_type", "maximum_redemptions",
    "coupon_code", "start_date_time", "end_date_time", "currency",
    "discount_price", "course_coupon_url",
]
REFERRAL_COLUMNS = ["course_id", "course_name", "Referal URL for students"]


def write_csv(path: Path, columns, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def coupon_row(course_id, name="Sample Course", offer_type="free_targeted"):
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
        "course_coupon_url": "https://www.udemy.com/course/%s/?couponCode=SAMPLE26" % course_id,
    }


def referral_row(course_id, name="Sample Course", code="ABCDEF"):
    return {
        "course_id": course_id,
        "course_name": name,
        "Referal URL for students": "https://www.udemy.com/course/%s/?referralCode=%s" % (course_id, code),
    }


class DiscoveryAndClassificationTests(unittest.TestCase):
    def test_classify_headers_detects_coupons_and_referrals(self):
        self.assertEqual(ci.classify_headers(COUPON_COLUMNS), "coupons")
        self.assertEqual(ci.classify_headers(REFERRAL_COLUMNS), "referrals")
        self.assertIsNone(ci.classify_headers(["unrelated", "columns"]))

    def test_referral_header_accepts_documented_alias(self):
        aliased = ["course_id", "course_name", "Referral URL for students"]
        self.assertEqual(ci.classify_headers(aliased), "referrals")

    def test_discover_finds_both_input_types_by_header_not_filename(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "weird_name_1.csv", COUPON_COLUMNS, [coupon_row("111")])
            write_csv(root / "weird_name_2.csv", REFERRAL_COLUMNS, [referral_row("111")])
            candidates = ci.discover_candidate_tables(root)
            kinds = sorted(kind for _, _, kind in candidates)
            self.assertEqual(kinds, ["coupons", "referrals"])

    def test_byte_identical_duplicates_are_deduped_and_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [coupon_row("111")]
            write_csv(root / "a.csv", COUPON_COLUMNS, rows)
            write_csv(root / "b.csv", COUPON_COLUMNS, rows)
            candidates = ci.discover_candidate_tables(root)
            unique, skipped = ci.dedupe_by_hash(candidates)
            self.assertEqual(len(unique), 1)
            self.assertEqual(len(skipped), 1)


class CouponParsingTests(unittest.TestCase):
    def test_parses_valid_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "coupons.csv"
            write_csv(path, COUPON_COLUMNS, [coupon_row("111"), coupon_row("222", offer_type="custom_price")])
            result = ci.parse_coupons(path)
            self.assertTrue(result.valid)
            self.assertEqual(len(result.rows), 2)

    def test_current_best_price_alias_normalizes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "coupons.csv"
            write_csv(path, COUPON_COLUMNS, [coupon_row("111", offer_type="current_best_price")])
            result = ci.parse_coupons(path)
            self.assertTrue(result.valid)
            self.assertEqual(result.rows[0]["coupon_type"], "best_price")

    def test_unsupported_offer_type_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "coupons.csv"
            write_csv(path, COUPON_COLUMNS, [coupon_row("111", offer_type="mystery_type")])
            result = ci.parse_coupons(path)
            self.assertFalse(result.valid)

    def test_duplicate_course_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "coupons.csv"
            write_csv(path, COUPON_COLUMNS, [coupon_row("111"), coupon_row("111")])
            result = ci.parse_coupons(path)
            self.assertFalse(result.valid)

    def test_non_https_coupon_url_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "coupons.csv"
            row = coupon_row("111")
            row["course_coupon_url"] = "http://www.udemy.com/course/111/?couponCode=SAMPLE26"
            write_csv(path, COUPON_COLUMNS, [row])
            result = ci.parse_coupons(path)
            self.assertFalse(result.valid)


class ReferralParsingTests(unittest.TestCase):
    def test_parses_valid_rows_and_normalizes_column_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "referrals.csv"
            write_csv(path, REFERRAL_COLUMNS, [referral_row("111")])
            result = ci.parse_referrals(path)
            self.assertTrue(result.valid)
            self.assertIn("instructor_referral_url", result.rows[0])
            self.assertNotIn("Referal URL for students", result.rows[0])

    def test_missing_referral_code_query_param_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "referrals.csv"
            row = referral_row("111")
            row["Referal URL for students"] = "https://www.udemy.com/course/111/"
            write_csv(path, REFERRAL_COLUMNS, [row])
            result = ci.parse_referrals(path)
            self.assertFalse(result.valid)

    def test_course_id_is_the_join_key_not_name(self):
        # Mirrors the real production fact: one course_id can carry two
        # different course_name values across the two input files.
        with tempfile.TemporaryDirectory() as tmp:
            coupon_path = Path(tmp) / "coupons.csv"
            referral_path = Path(tmp) / "referrals.csv"
            write_csv(coupon_path, COUPON_COLUMNS, [coupon_row("5885448", name="Name In Coupon Export")])
            write_csv(referral_path, REFERRAL_COLUMNS, [referral_row("5885448", name="Different Name In Referral Sheet")])
            coupons = ci.parse_coupons(coupon_path)
            referrals = ci.parse_referrals(referral_path)
            self.assertEqual(coupons.rows[0]["course_id"], referrals.rows[0]["course_id"])
            self.assertNotEqual(coupons.rows[0]["course_name"], referrals.rows[0]["course_name"])


class OfferDateTimeParsingTests(unittest.TestCase):
    def test_parses_pst_and_pdt(self):
        pst = ci.parse_iso_offer_datetime("2026-08-01 00:00 PST")
        pdt = ci.parse_iso_offer_datetime("2026-08-01 00:00 PDT")
        self.assertIsNotNone(pst)
        self.assertIsNotNone(pdt)
        self.assertNotEqual(pst.utcoffset(), pdt.utcoffset())

    def test_invalid_value_returns_none(self):
        self.assertIsNone(ci.parse_iso_offer_datetime("not a date"))
        self.assertIsNone(ci.parse_iso_offer_datetime(""))


if __name__ == "__main__":
    unittest.main()
