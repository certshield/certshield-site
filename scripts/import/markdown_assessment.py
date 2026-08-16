#!/usr/bin/env python3
"""Parse and validate a CertShield certification-assessment Markdown file (Input C).

Implements the contract in section 7 of
``CertShield_Modular_Diagnostic_Assessment_Framework_Reviewed_Prompt.md``:
metadata extraction, exactly-30-question parsing, MCQ/MSQ inference and
cardinality agreement, answer-restatement validation, the ten required
learning sections per question, and official-reference link checks.

Markdown bodies are converted to a small, safe HTML subset at parse time
(``render_markdown``) so the browser never has to sanitize untrusted content
or use unsafe ``innerHTML`` on raw import data.  Only bold, inline code,
``https://`` links, paragraphs, bullet lists and blockquotes are supported;
anything else is treated as plain escaped text.

Standard-library only.
"""

from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

QUESTION_HEADING_RE = re.compile(r"^#\s+Q#(\d+)\s*\|\s*Domain Name:\s*(.+?)\s*$")
OPTION_RE = re.compile(r"^([A-F])\.\s+(.+)$")
CARDINALITY_RE = re.compile(r"^\*\*Choose\s+(\w+)\s+answers?\.\*\*$", re.IGNORECASE)
CORRECT_HEADING_RE = re.compile(r"^##\s+Correct Answer\s*$")
CORRECT_LINE_RE = re.compile(
    r"^\*\*Correct Answers?:\s*(.+?)\*\*\s*$", re.IGNORECASE
)
RESTATEMENT_BULLET_RE = re.compile(r"^-\s+\*\*([A-F])\.\s+(.+?)\*\*\s*$")
RESTATEMENT_BARE_RE = re.compile(r"^\*\*([A-F])\.\s+(.+?)\*\*\s*$")
SECTION_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")
LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
UNSAFE_CONTENT_RE = re.compile(
    r"<\s*(script|iframe|object|embed|style)\b"
    r"|<[^>]*\bon[a-z]+\s*=\s*['\"]"
    r"|href\s*=\s*['\"]?\s*javascript:",
    re.IGNORECASE,
)

WORD_TO_NUMBER = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
}

REQUIRED_SECTIONS = (
    ("Exam Reasoning Explanation", "examReasoningExplanation"),
    ("Key Exam Clues", "keyExamClues"),
    ("Why This Is Correct", "whyThisIsCorrect"),
    ("Why the Other Options Are Not the Best Fit", "whyOtherOptionsAreNotBestFit"),
    ("Exam Trap", "examTrap"),
    ("Foundation Concept", "foundationConcept"),
    ("Real-World Connection", "realWorldConnection"),
    ("Memory Hook", "memoryHook"),
    ("30-Second Exam Takeaway", "thirtySecondTakeaway"),
    ("Official References", "officialReferences"),
)
REQUIRED_SECTION_NAMES = {name for name, _ in REQUIRED_SECTIONS}

METADATA_FIELDS = (
    ("Certification Vendor", "vendor"),
    ("Certification Name", "certificationName"),
    ("Latest Exam Code", "examCode"),
    ("Latest Exam/Blueprint Version", "blueprintVersion"),
    ("Estimated Duration for This 30-Question Set", "estimatedDuration"),
    ("Final Technical Validation", "finalTechnicalValidation"),
)
HONEST_UNKNOWN = "Not specified in official documentation"
EXPECTED_QUESTION_COUNT = 30


@dataclass
class ImportError_:
    question_number: int | None
    section: str
    excerpt: str
    reason: str
    fix: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "questionNumber": self.question_number,
            "section": self.section,
            "excerpt": self.excerpt[:200],
            "reason": self.reason,
            "correctiveAction": self.fix,
        }


@dataclass
class ParsedAssessment:
    source_file: str
    sha256: str
    meta: dict[str, str]
    questions: list[dict[str, Any]]
    errors: list[ImportError_] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_report_dict(self) -> dict[str, Any]:
        return {
            "sourceFile": self.source_file,
            "sha256": self.sha256,
            "valid": self.valid,
            "questionCount": len(self.questions),
            "errors": [error.to_dict() for error in self.errors],
        }


def _excerpt(text: str) -> str:
    clean = " ".join(text.split())
    return clean[:160]


def _escape(text: str) -> str:
    return html.escape(text, quote=False)


def render_markdown(raw: str) -> str:
    """Convert a small, safe Markdown subset to sanitized HTML.

    Supported: paragraphs, ``**bold**``, `` `code` ``, ``[text](https://…)``
    links, ``- `` bullet lists and ``> `` blockquotes. Everything else is
    escaped as plain text. This never emits raw/untrusted HTML.
    """
    if not raw or not raw.strip():
        return ""

    def inline(text: str) -> str:
        text = _escape(text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)

        def link_sub(match: re.Match[str]) -> str:
            label = match.group(1)
            url = match.group(2)
            if not url.startswith("https://"):
                return _escape(match.group(0))
            return '<a href="%s" rel="noopener" target="_blank">%s</a>' % (
                html.escape(url, quote=True),
                label,
            )

        text = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", link_sub, text)
        return text

    blocks: list[str] = []
    lines = raw.strip("\n").split("\n")
    index = 0
    paragraph: list[str] = []
    list_items: list[str] = []
    quote_lines: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append("<p>" + inline(" ".join(paragraph)) + "</p>")
            paragraph.clear()

    def flush_list() -> None:
        if list_items:
            items = "".join("<li>" + inline(item) + "</li>" for item in list_items)
            blocks.append("<ul>" + items + "</ul>")
            list_items.clear()

    def flush_quote() -> None:
        if quote_lines:
            blocks.append("<blockquote><p>" + inline(" ".join(quote_lines)) + "</p></blockquote>")
            quote_lines.clear()

    while index < len(lines):
        line = lines[index].rstrip()
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            flush_list()
            flush_quote()
        elif stripped.startswith("- "):
            flush_paragraph()
            flush_quote()
            list_items.append(stripped[2:].strip())
        elif stripped.startswith(">"):
            flush_paragraph()
            flush_list()
            quote_lines.append(stripped.lstrip(">").strip())
        else:
            flush_list()
            flush_quote()
            paragraph.append(stripped)
        index += 1

    flush_paragraph()
    flush_list()
    flush_quote()
    return "".join(blocks)


def _split_question_blocks(lines: list[str]) -> tuple[list[str], list[tuple[int, str, list[str]]]]:
    """Return (preamble_lines, [(number, domain, block_lines), ...])."""
    preamble: list[str] = []
    blocks: list[tuple[int, str, list[str]]] = []
    current_number: int | None = None
    current_domain = ""
    current_lines: list[str] = []

    for line in lines:
        match = QUESTION_HEADING_RE.match(line)
        if match:
            if current_number is not None:
                blocks.append((current_number, current_domain, current_lines))
            current_number = int(match.group(1))
            current_domain = match.group(2).strip()
            current_lines = []
        elif current_number is None:
            preamble.append(line)
        else:
            current_lines.append(line)

    if current_number is not None:
        blocks.append((current_number, current_domain, current_lines))

    return preamble, blocks


def _parse_metadata(preamble_lines: list[str]) -> dict[str, str]:
    text = "\n".join(preamble_lines)
    meta: dict[str, str] = {}
    for label, key in METADATA_FIELDS:
        pattern = re.compile(
            r"^" + re.escape(label) + r":\s*(.+)$", re.MULTILINE
        )
        match = pattern.search(text)
        meta[key] = match.group(1).strip() if match else ""
    return meta


def _parse_correct_letters(raw: str) -> list[str]:
    cleaned = raw.replace(" and ", ",").replace(" or ", ",")
    letters = [part.strip() for part in cleaned.split(",")]
    return [letter for letter in letters if re.fullmatch(r"[A-F]", letter)]


def _parse_question_block(
    number: int, domain: str, block_lines: list[str], errors: list[ImportError_]
) -> dict[str, Any] | None:
    def error(section: str, reason: str, fix: str, excerpt_source: str = "") -> None:
        errors.append(
            ImportError_(
                question_number=number,
                section=section,
                excerpt=_excerpt(excerpt_source),
                reason=reason,
                fix=fix,
            )
        )

    if not domain:
        error("heading", "Question is missing a domain name.", "Add a non-blank Domain Name to the Q# heading.")

    joined = "\n".join(block_lines)
    if UNSAFE_CONTENT_RE.search(joined):
        error(
            "body",
            "Question contains unsafe HTML/script-like content.",
            "Remove script/iframe/style tags, inline event handlers, or javascript: URLs.",
            joined,
        )
        return None

    # --- stem, cardinality instruction, options ---
    stem_lines: list[str] = []
    cardinality_instruction: str | None = None
    options: list[dict[str, str]] = []
    option_raw: dict[str, list[str]] = {}
    current_option: str | None = None
    correct_heading_index: int | None = None

    index = 0
    while index < len(block_lines):
        line = block_lines[index]
        stripped = line.strip()

        if CORRECT_HEADING_RE.match(stripped):
            correct_heading_index = index
            break

        cardinality_match = CARDINALITY_RE.match(stripped)
        option_match = OPTION_RE.match(stripped)

        if cardinality_match:
            cardinality_instruction = stripped
            current_option = None
        elif option_match:
            letter, text = option_match.group(1), option_match.group(2)
            option_raw[letter] = [text]
            current_option = letter
        elif current_option and stripped:
            option_raw[current_option].append(stripped)
        elif not option_raw and stripped:
            stem_lines.append(stripped)

        index += 1

    if correct_heading_index is None:
        error(
            "## Correct Answer",
            "Question has no '## Correct Answer' section.",
            "Add a '## Correct Answer' section with a bold Correct Answer/Correct Answers line.",
            joined,
        )
        return None

    if not option_raw:
        error("options", "Question has no A./B./... options.", "Add at least two contiguous lettered options.", joined)
        return None

    option_letters = sorted(option_raw.keys())
    expected_letters = [chr(ord("A") + offset) for offset in range(len(option_letters))]
    if option_letters != expected_letters or not (2 <= len(option_letters) <= 6):
        error(
            "options",
            "Options are not a contiguous 2-6 letter run starting at A.",
            "Ensure options are labeled A, B, C... with no gaps and 2-6 total options.",
            ", ".join(option_letters),
        )
        return None

    for letter in option_letters:
        text = " ".join(option_raw[letter]).strip()
        if not text:
            error("options", "Option %s has no text." % letter, "Add option text for every declared option.")
            return None
        options.append({"id": letter, "text": text, "textHtml": render_markdown(text)})

    stem_text = " ".join(stem_lines).strip()
    if not stem_text:
        error("question stem", "Question stem is empty.", "Add the complete question stem before the options.", joined)
        return None

    # --- correct answer(s) ---
    remaining = block_lines[correct_heading_index + 1 :]
    correct_line_index: int | None = None
    correct_letters: list[str] = []
    for offset, line in enumerate(remaining):
        stripped = line.strip()
        if not stripped:
            continue
        match = CORRECT_LINE_RE.match(stripped)
        if match:
            correct_letters = _parse_correct_letters(match.group(1))
            correct_line_index = offset
            break
        error(
            "## Correct Answer",
            "Expected a bold 'Correct Answer:' or 'Correct Answers:' line.",
            "Use '**Correct Answer: C**' or '**Correct Answers: B and E**' immediately under the heading.",
            stripped,
        )
        return None

    if correct_line_index is None or not correct_letters:
        error("## Correct Answer", "Could not parse any correct-answer letters.", "Declare at least one correct option letter.", joined)
        return None

    invalid_letters = [letter for letter in correct_letters if letter not in option_raw]
    if invalid_letters:
        error(
            "## Correct Answer",
            "Correct answer letter(s) %s do not match a declared option." % ", ".join(invalid_letters),
            "Every correct letter must identify a populated option.",
        )
        return None
    if len(set(correct_letters)) != len(correct_letters):
        error("## Correct Answer", "Duplicate correct-answer letters declared.", "List each correct option once.")
        return None

    selection_mode = "multiple" if len(correct_letters) > 1 else "single"
    if selection_mode == "single" and len(correct_letters) != 1:
        error("## Correct Answer", "MCQ must declare exactly one correct answer.", "Declare exactly one correct letter for a single-answer question.")
        return None
    if selection_mode == "multiple" and len(correct_letters) < 2:
        error("## Correct Answer", "MSQ must declare at least two correct answers.", "Declare two or more correct letters for a multi-select question.")
        return None

    if cardinality_instruction:
        cardinality_match = CARDINALITY_RE.match(cardinality_instruction)
        word = cardinality_match.group(1).lower() if cardinality_match else ""
        declared_count = WORD_TO_NUMBER.get(word)
        if declared_count is None or declared_count != len(correct_letters):
            error(
                "cardinality",
                "Explicit cardinality instruction '%s' disagrees with the %d declared correct answer(s)."
                % (cardinality_instruction, len(correct_letters)),
                "Make the 'Choose N answers' instruction match the number of correct answers.",
            )
            return None

    # --- restatement(s): must exactly cover the correct-answer set ---
    restatement_lines = remaining[correct_line_index + 1 :]
    restated_letters: list[str] = []
    restatement_html_parts: list[str] = []
    for line in restatement_lines:
        stripped = line.strip()
        if not stripped:
            continue
        if SECTION_HEADING_RE.match(stripped):
            break
        bullet_match = RESTATEMENT_BULLET_RE.match(stripped)
        bare_match = RESTATEMENT_BARE_RE.match(stripped)
        match = bullet_match or bare_match
        if not match:
            continue
        letter, text = match.group(1), match.group(2)
        restated_letters.append(letter)
        restatement_html_parts.append(render_markdown("**%s.** %s" % (letter, text)))

    if sorted(set(restated_letters)) != sorted(set(correct_letters)) or len(restated_letters) != len(correct_letters):
        error(
            "answer restatement",
            "Restatement letters %s do not exactly cover the declared correct-answer set %s."
            % (restated_letters, correct_letters),
            "Restate every correct option once, and only the correct options.",
        )
        return None

    # --- required ## sections ---
    section_start = correct_heading_index + 1 + len(restatement_lines)
    # Walk forward to find where the first '## ' heading begins (robust to any
    # stray blank lines already consumed by the restatement scan above).
    remaining_after_restatement = block_lines[correct_heading_index + 1 :]
    sections: dict[str, str] = {}
    official_references: list[dict[str, str]] = []
    additional_sections: list[dict[str, str]] = []
    seen_section_names: list[str] = []

    current_heading: str | None = None
    current_body_lines: list[str] = []

    def flush_section() -> None:
        nonlocal current_heading
        if current_heading is None:
            return
        body_text = "\n".join(current_body_lines).strip()
        if current_heading == "Official References":
            links = LINK_RE.findall(body_text)
            for title, url in links:
                official_references.append({"title": title, "url": url})
        elif current_heading in REQUIRED_SECTION_NAMES:
            key = dict(REQUIRED_SECTIONS)[current_heading]
            sections[key] = render_markdown(body_text)
        else:
            additional_sections.append(
                {"heading": current_heading, "html": render_markdown(body_text)}
            )
        current_heading = None
        current_body_lines.clear()

    for line in remaining_after_restatement:
        stripped = line.strip()
        heading_match = SECTION_HEADING_RE.match(stripped)
        if heading_match:
            flush_section()
            current_heading = heading_match.group(1).strip()
            seen_section_names.append(current_heading)
        elif current_heading is not None:
            current_body_lines.append(line)
    flush_section()

    missing_sections = [name for name in REQUIRED_SECTION_NAMES if name not in seen_section_names]
    if missing_sections:
        error(
            "learning sections",
            "Missing required section(s): %s." % ", ".join(sorted(missing_sections)),
            "Add every required '##' learning section listed in the format contract.",
        )
        return None

    for name, key in REQUIRED_SECTIONS:
        if key == "officialReferences":
            continue
        if not sections.get(key, "").strip():
            error("## " + name, "Section '%s' is blank." % name, "Provide non-blank content for every required section.")
            return None

    https_refs = [ref for ref in official_references if ref["url"].startswith("https://")]
    if not https_refs:
        error(
            "## Official References",
            "No valid HTTPS official-reference link found.",
            "Add at least one '[Title](https://...)' official reference link.",
        )
        return None

    return {
        "number": number,
        "domain": domain,
        "stem": stem_text,
        "stemHtml": render_markdown(stem_text),
        "cardinalityInstruction": cardinality_instruction,
        "options": options,
        "correctAnswers": correct_letters,
        "selectionMode": selection_mode,
        "requiredSelections": len(correct_letters),
        "restatementHtml": "".join(restatement_html_parts),
        "sections": sections,
        "officialReferences": https_refs,
        "additionalSections": additional_sections,
    }


def parse_assessment_markdown(path: Path) -> ParsedAssessment:
    raw_bytes = path.read_bytes()
    sha256 = hashlib.sha256(raw_bytes).hexdigest()
    text = raw_bytes.decode("utf-8")
    lines = text.split("\n")

    errors: list[ImportError_] = []
    preamble_lines, blocks = _split_question_blocks(lines)
    meta = _parse_metadata(preamble_lines)

    for label, key in METADATA_FIELDS:
        value = meta.get(key, "")
        if not value:
            errors.append(
                ImportError_(
                    question_number=None,
                    section="metadata",
                    excerpt=label,
                    reason="Missing certification metadata field '%s'." % label,
                    fix="Add '%s: <value>' near the top of the file (use '%s' if genuinely unknown)."
                    % (label, HONEST_UNKNOWN),
                )
            )

    questions: list[dict[str, Any]] = []
    seen_numbers: set[int] = set()
    seen_stems: dict[str, int] = {}

    for number, domain, block_lines in blocks:
        if number in seen_numbers:
            errors.append(
                ImportError_(
                    question_number=number,
                    section="heading",
                    excerpt="Q#%d" % number,
                    reason="Duplicate question number %d." % number,
                    fix="Ensure every question number 1-30 appears exactly once.",
                )
            )
            continue
        seen_numbers.add(number)
        parsed = _parse_question_block(number, domain, block_lines, errors)
        if parsed is None:
            continue
        normalized_stem = " ".join(parsed["stem"].lower().split())
        if normalized_stem in seen_stems:
            errors.append(
                ImportError_(
                    question_number=number,
                    section="question stem",
                    excerpt=parsed["stem"],
                    reason="Duplicate question text (matches Q#%d)." % seen_stems[normalized_stem],
                    fix="Ensure every question stem is unique.",
                )
            )
            continue
        seen_stems[normalized_stem] = number
        option_texts = {option["text"].strip().lower() for option in parsed["options"]}
        if len(option_texts) != len(parsed["options"]):
            errors.append(
                ImportError_(
                    question_number=number,
                    section="options",
                    excerpt=parsed["stem"],
                    reason="Duplicate option text within the question.",
                    fix="Ensure every option's text is distinct.",
                )
            )
            continue
        questions.append(parsed)

    expected_numbers = set(range(1, EXPECTED_QUESTION_COUNT + 1))
    if not errors and seen_numbers != expected_numbers:
        missing = sorted(expected_numbers - seen_numbers)
        extra = sorted(seen_numbers - expected_numbers)
        detail = []
        if missing:
            detail.append("missing %s" % missing)
        if extra:
            detail.append("unexpected %s" % extra)
        errors.append(
            ImportError_(
                question_number=None,
                section="question count",
                excerpt="",
                reason="Expected exactly %d sequential questions numbered 1-%d (%s)."
                % (EXPECTED_QUESTION_COUNT, EXPECTED_QUESTION_COUNT, "; ".join(detail)),
                fix="Number every question sequentially from 1 to %d with no gaps or duplicates." % EXPECTED_QUESTION_COUNT,
            )
        )

    return ParsedAssessment(
        source_file=str(path),
        sha256=sha256,
        meta=meta,
        questions=sorted(questions, key=lambda item: item["number"]),
        errors=errors,
    )


def is_assessment_markdown(path: Path) -> bool:
    """Structural classifier for Input C (see master-prompt section 3).

    Requires the file to actually open with the assessment title and to
    contain multiple real question headings (not just one illustrative
    example embedded in unrelated documentation, e.g. this framework's own
    master-prompt spec file, which quotes the format once).
    """
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    first_line = text.lstrip("﻿").splitlines()[0].strip() if text.strip() else ""
    question_heading_count = len(re.findall(r"^# Q#\d+ \| Domain Name:", text, re.MULTILINE))
    return (
        first_line == "# Certification Practice Set"
        and bool(re.search(r"^Certification Vendor:", text, re.MULTILINE))
        and question_heading_count >= 2
        and "## Correct Answer" in text
    )


if __name__ == "__main__":
    import json
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not target:
        print("usage: python markdown_assessment.py <path-to-assessment.md>")
        raise SystemExit(2)

    result = parse_assessment_markdown(target)
    print(json.dumps(result.to_report_dict(), indent=2))
    if not result.valid:
        raise SystemExit(1)
