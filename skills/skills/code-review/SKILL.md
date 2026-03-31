---
name: code-review
description: >-
  Structured code review skill. Use when asked to "review this code",
  "review this PR", "check this diff", or when acting as a Hydra evaluator.
  Runs a multi-pass review with specialist focus areas and confidence-gated
  findings.
---

# Code Review

Structured multi-pass review. Read the full diff before commenting on anything.

## Phase 1: Orient

1. Determine the review scope:
   - If reviewing a PR: `git diff <base>..HEAD`
   - If reviewing staged changes: `git diff --cached`
   - If reviewing a file: read the file
2. Understand the intent: read the commit messages, PR description, or
   task description to understand what the change is supposed to do
3. Identify the change type: feature, bugfix, refactor, config, dependency update

## Phase 2: Critical Pass

Read the diff line by line. Flag only real issues:

**Always check:**
- Logic errors (wrong conditions, off-by-one, missing null checks on external data)
- SQL injection, XSS, command injection, path traversal
- Race conditions in concurrent code
- Resource leaks (unclosed handles, missing cleanup)
- Missing error handling at system boundaries (network, file I/O, user input)
- Breaking API contract changes without version bump

**Never flag:**
- Style preferences (naming, formatting) unless they cause confusion
- Missing comments on self-explanatory code
- Hypothetical edge cases that cannot happen given the invariants
- "I would have done it differently" without a concrete defect

## Phase 3: Specialist Focus

Based on the change type, apply the relevant specialist lens:

**If the diff touches tests:**
- Do tests actually test behavior, or just assert mock return values?
- Are there tautological assertions (`expect(true).toBe(true)`)?
- Is the test coupled to implementation details rather than outcomes?

**If the diff touches data access:**
- N+1 query patterns in loops
- Unbounded result sets without pagination
- Transactions where atomic operations are needed

**If the diff touches auth/security:**
- Apply Phase 2-4 of the `security-audit` skill to the changed code

**If the diff touches UI:**
- State management: are loading/error/empty states handled?
- Accessibility: keyboard navigation, semantic HTML, ARIA labels
- Responsive: does it work at mobile/tablet/desktop breakpoints?

## Phase 4: Verdict

For each finding, assign a confidence level:

- **High (8-10)**: Confirmed defect with clear evidence — fix before merge
- **Medium (5-7)**: Likely issue, but may depend on context — discuss
- **Low (1-4)**: Possible concern, worth noting — optional

Report format per finding:

```
[severity] file:line — description
Confidence: N/10
Suggestion: specific fix
```

## Final verdict

- **Approve**: no High findings, no more than 2 Medium findings
- **Request changes**: any High finding, or 3+ Medium findings
- **If nothing is wrong**: say "no issues found" — do not invent problems

## Rules

- Read the code before commenting — never review from the description alone
- Every finding must reference a specific file and line
- Do not suggest refactoring that is unrelated to the change being reviewed
- A review that flags nothing wrong is a valid review — do not pad
