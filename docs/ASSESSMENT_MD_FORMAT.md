# Assessment Markdown Format (Input C)

One file per certification, one certification per file. When a certification's
exam or blueprint changes, replace the file's content in place — the importer
treats a re-import against the same resolved slug as a **version update**,
never a second assessment.

## File structure

```markdown
# Certification Practice Set

Certification Vendor: <value>
Certification Name: <value>
Latest Exam Code: <value>                          (or "Not specified in official documentation")
Latest Exam/Blueprint Version: <value>
Estimated Duration for This 30-Question Set: <value>
Final Technical Validation: <free text, include a real "Completed <Month D, YYYY>" date if known>

# Q#1 | Domain Name: <exact domain name>

<Complete question stem, one or more paragraphs.>

**Choose TWO answers.**                              (omit for single-answer questions)

A. <option text>
B. <option text>
C. <option text>
D. <option text>
E. <option text>                                     (2-6 contiguous options, A.. in order)

## Correct Answer

**Correct Answer: C**                                 (single-answer)
**Correct Answers: B and E**                           (multi-answer)

**C. <restate the correct option's exact text>**       (single-answer: one bold paragraph)
- **B. <restate>**                                     (multi-answer: one list item per
- **E. <restate>**                                      correct option, covering the full set)

## Exam Reasoning Explanation
## Key Exam Clues
## Why This Is Correct
## Why the Other Options Are Not the Best Fit
## Exam Trap
## Foundation Concept
## Real-World Connection
## Memory Hook
## 30-Second Exam Takeaway
## Official References

- [Title](https://...)                                (>=1 https link required)

# Q#2 | Domain Name: ...
...through Q#30
```

Every one of the ten `##` sections is required on every question, in any
order relative to each other but after the restatement. Any *additional*
recognized `##` section is preserved (in source order) rather than dropped.

## Hard validation rules (`scripts/import/markdown_assessment.py`)

- Exactly 30 sequential, unique question numbers (1-30, no gaps, no repeats).
- Every question has a non-blank `Domain Name`, preserved verbatim.
- 2-6 contiguous options labeled `A.`, `B.`, `C.`... with no gaps.
- Selection mode is inferred from the correct-answer count (1 = single, 2+ =
  multiple); an explicit `**Choose N answers.**` instruction must agree with
  that count or the question is rejected.
- Every correct-answer letter must identify a populated option.
- The restatement(s) must exactly cover the declared correct-answer set — no
  more, no fewer.
- All ten required sections must be present and non-blank.
- At least one `https://` official-reference link is required.
- Duplicate question text, duplicate option text within a question,
  malformed links, and unsafe HTML/script-like content (`<script>`,
  `<iframe>`, inline `on...="..."` handlers inside a real tag, or
  `javascript:` hrefs) are all rejected — **technical prose containing a
  literal `=` or `->` is fine**; only actual tag-scoped event-handler syntax
  is flagged.
- `Not specified in official documentation` is accepted and preserved as an
  honest exam-code value; the importer never invents one.

Every rejection reports `{sourceFile, questionNumber, section, excerpt,
reason, correctiveAction}` in the run's import report.

## Rendering and safety

Every Markdown field is converted **once, at build time**, by
`render_markdown()` into a small safe HTML subset (paragraphs, `**bold**`,
`` `code` ``, `https://` links, `-` bullet lists, `>` blockquotes — nothing
else is emitted). The browser only ever toggles `hidden` on this pre-sanitized
HTML (via `innerHTML` from our own build output, never from a runtime
network response) — there is no client-side Markdown renderer and no
runtime sanitization step to trust.

## Stable slug and content versioning

The assessment's slug is derived once from its certification name
(`slugify(certificationName)`) and persisted forever, independent of later
metadata or question-content edits. `contentVersion` is the first 12 hex
characters of the source file's SHA-256. A saved in-progress attempt in
`localStorage` is namespaced by `slug + contentVersion`; if the file changes,
the stale attempt is discarded with an explicit "this assessment was updated"
notice on the landing page, and the learner starts a clean attempt. Up to
three completed-attempt summaries are retained per slug (not per version) as
personal history, each labelled with the `contentVersion` it was taken
against.
