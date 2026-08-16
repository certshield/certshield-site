import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts" / "import"))

import markdown_assessment as ma  # noqa: E402

VALID_METADATA = """# Certification Practice Set

Certification Vendor: ExampleCorp
Certification Name: Example Certified Professional
Latest Exam Code: EX-100
Latest Exam/Blueprint Version: v1
Estimated Duration for This 30-Question Set: 60 minutes
Final Technical Validation: Completed January 1, 2026 against the official guide.

"""

REQUIRED_SECTIONS_BLOCK = """
## Exam Reasoning Explanation

Because reason.

## Key Exam Clues

- clue one

## Why This Is Correct

Because it satisfies the requirement.

## Why the Other Options Are Not the Best Fit

**A. Incorrect —** wrong.

## Exam Trap

Do not confuse X with Y.

## Foundation Concept

Core idea.

## Real-World Connection

Applies in production.

## Memory Hook

> **Remember this.**

## 30-Second Exam Takeaway

Summary sentence.

## Official References

- [Example Docs](https://example.com/docs)

"""


def mcq_question(number, domain="Domain One", correct="C"):
    return (
        "# Q#%d | Domain Name: %s\n\n"
        "Sample question stem number %d?\n\n"
        "A. Wrong one\n"
        "B. Wrong two\n"
        "C. Right answer\n"
        "D. Wrong three\n\n"
        "## Correct Answer\n\n"
        "**Correct Answer: %s**\n\n"
        "**%s. Right answer**\n"
        + REQUIRED_SECTIONS_BLOCK
    ) % (number, domain, number, correct, correct)


def msq_question(number, domain="Domain Two"):
    return (
        "# Q#%d | Domain Name: %s\n\n"
        "Sample multi-select stem number %d?\n\n"
        "**Choose TWO answers.**\n\n"
        "A. Wrong one\n"
        "B. Right one\n"
        "C. Wrong two\n"
        "D. Wrong three\n"
        "E. Right two\n\n"
        "## Correct Answer\n\n"
        "**Correct Answers: B and E**\n\n"
        "- **B. Right one**\n"
        "- **E. Right two**\n"
        + REQUIRED_SECTIONS_BLOCK
    ) % (number, domain, number)


def build_valid_document(question_count=30):
    parts = [VALID_METADATA]
    for number in range(1, question_count + 1):
        if number % 5 == 0:
            parts.append(msq_question(number))
        else:
            parts.append(mcq_question(number))
    return "\n".join(parts)


def write_and_parse(text):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "assessment.md"
        path.write_text(text, encoding="utf-8")
        return ma.parse_assessment_markdown(path)


class MarkdownAssessmentParserTests(unittest.TestCase):
    def test_valid_30_question_document_parses_cleanly(self):
        result = write_and_parse(build_valid_document())
        self.assertTrue(result.valid, result.errors)
        self.assertEqual(len(result.questions), 30)
        mcq = [q for q in result.questions if q["selectionMode"] == "single"]
        msq = [q for q in result.questions if q["selectionMode"] == "multiple"]
        self.assertEqual(len(msq), 6)
        self.assertEqual(len(mcq), 24)
        self.assertEqual(result.meta["vendor"], "ExampleCorp")

    def test_honest_unknown_exam_code_is_preserved(self):
        text = VALID_METADATA.replace("Latest Exam Code: EX-100", "Latest Exam Code: Not specified in official documentation")
        text += mcq_question(1) + "".join(mcq_question(n) for n in range(2, 31))
        result = write_and_parse(text)
        self.assertTrue(result.valid, result.errors)
        self.assertEqual(result.meta["examCode"], "Not specified in official documentation")

    def test_wrong_question_count_is_rejected(self):
        result = write_and_parse(build_valid_document(question_count=29))
        self.assertFalse(result.valid)
        self.assertTrue(any("30" in e.reason for e in result.errors))

    def test_duplicate_question_number_is_rejected(self):
        text = build_valid_document(question_count=30)
        text = text.replace("# Q#2 | Domain Name: Domain One", "# Q#1 | Domain Name: Domain One", 1)
        result = write_and_parse(text)
        self.assertFalse(result.valid)

    def test_cardinality_mismatch_is_rejected(self):
        bad_msq = msq_question(5).replace("**Choose TWO answers.**", "**Choose THREE answers.**")
        text = VALID_METADATA + mcq_question(1) + mcq_question(2) + mcq_question(3) + mcq_question(4) + bad_msq
        for n in range(6, 31):
            text += mcq_question(n) if n % 5 else msq_question(n)
        result = write_and_parse(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("cardinality" in e.section for e in result.errors))

    def test_correct_letter_must_match_declared_option(self):
        bad_question = mcq_question(1).replace("**Correct Answer: C**", "**Correct Answer: Z**")
        text = VALID_METADATA + bad_question + "".join(mcq_question(n) for n in range(2, 31))
        result = write_and_parse(text)
        self.assertFalse(result.valid)

    def test_restatement_must_cover_full_correct_set(self):
        bad_msq = msq_question(5).replace("- **E. Right two**\n", "")
        text = VALID_METADATA + mcq_question(1) + mcq_question(2) + mcq_question(3) + mcq_question(4) + bad_msq
        for n in range(6, 31):
            text += mcq_question(n) if n % 5 else msq_question(n)
        result = write_and_parse(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("restatement" in e.section for e in result.errors))

    def test_missing_required_section_is_rejected(self):
        bad_question = mcq_question(1).replace("## Exam Trap\n\nDo not confuse X with Y.\n\n", "")
        text = VALID_METADATA + bad_question + "".join(mcq_question(n) for n in range(2, 31))
        result = write_and_parse(text)
        self.assertFalse(result.valid)
        self.assertTrue(any("Exam Trap" in e.reason for e in result.errors))

    def test_non_https_reference_is_rejected(self):
        bad_question = mcq_question(1).replace(
            "[Example Docs](https://example.com/docs)", "[Example Docs](http://example.com/docs)"
        )
        text = VALID_METADATA + bad_question + "".join(mcq_question(n) for n in range(2, 31))
        result = write_and_parse(text)
        self.assertFalse(result.valid)

    def test_duplicate_question_text_is_rejected(self):
        text = VALID_METADATA + mcq_question(1) + mcq_question(2).replace(
            "Sample question stem number 2?", "Sample question stem number 1?"
        )
        for n in range(3, 31):
            text += mcq_question(n) if n % 5 else msq_question(n)
        result = write_and_parse(text)
        self.assertFalse(result.valid)

    def test_unsafe_script_content_is_rejected(self):
        bad_question = mcq_question(1).replace(
            "Sample question stem number 1?", 'Sample question stem <img src=x onerror="alert(1)">?'
        )
        text = VALID_METADATA + bad_question + "".join(mcq_question(n) for n in range(2, 31))
        result = write_and_parse(text)
        self.assertFalse(result.valid)

    def test_technical_prose_with_arrow_equals_is_not_flagged_unsafe(self):
        # Regression: `failOnError => false`-style prose must not trip the
        # unsafe-content heuristic (it previously matched bare `on\w+\s*=`).
        text = mcq_question(1).replace(
            "Because reason.", "Set `failOnError => false` to continue on error."
        )
        text = VALID_METADATA + text + "".join(mcq_question(n) for n in range(2, 31))
        result = write_and_parse(text)
        self.assertTrue(result.valid, result.errors)

    def test_render_markdown_escapes_and_links_only_https(self):
        html_output = ma.render_markdown("Use <b>bold</b> and [safe](https://example.com) and [bad](javascript:alert(1))")
        self.assertNotIn("<b>bold</b>", html_output)
        self.assertIn('href="https://example.com"', html_output)
        # The non-https URL must never become a real, clickable href — the
        # literal escaped text is fine, an actual javascript: href is not.
        self.assertNotIn('href="javascript:', html_output)

    def test_is_assessment_markdown_ignores_documentation_with_one_example(self):
        doc = (
            "# Some Other Doc\n\n"
            "Here is an example: `# Certification Practice Set` and `# Q#1 | Domain Name: X` "
            "and `## Correct Answer` for illustration only.\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "spec.md"
            path.write_text(doc, encoding="utf-8")
            self.assertFalse(ma.is_assessment_markdown(path))

    def test_is_assessment_markdown_accepts_real_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "assessment.md"
            path.write_text(build_valid_document(), encoding="utf-8")
            self.assertTrue(ma.is_assessment_markdown(path))


if __name__ == "__main__":
    unittest.main()
