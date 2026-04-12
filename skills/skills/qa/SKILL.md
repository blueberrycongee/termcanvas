---
name: qa
description: >-
  QA testing skill with real browser automation. Use when asked to "test this
  site", "QA this page", "check for visual bugs", "verify the deploy", or
  when Hydra needs browser validation for UI changes. Requires the browse
  binary.
---

# QA

Browser-based QA testing with the `browse` CLI. Test real user flows, capture
visual evidence, and fix issues with atomic commits.

## Phase 0: Setup

1. Verify browse is available: `browse status`
2. If not found, report error — browse binary must be installed
3. Get the target URL from the task description or ask the user

## Phase 1: Orient

1. Navigate to the target: `browse goto <url>`
2. Take a baseline snapshot: `browse snapshot -i`
3. Check console for errors: `browse console`
4. Extract navigation links: `browse links`
5. Build a site map of pages to test (limit to 10 most important pages)

## Phase 2: Page-by-Page Audit

For each page in the site map:

1. Navigate: `browse goto <page-url>`
2. Snapshot interactive elements: `browse snapshot -i`
3. Check console for errors: `browse console`
4. Screenshot for evidence: `browse screenshot <page-name>.png`
5. Note issues found: broken links, console errors, missing elements,
   layout problems visible in snapshot

## Phase 3: User Flow Testing

Test the primary user flows (signup, login, checkout, etc.):

1. Identify the flow steps from the snapshot
2. Execute each step using refs:
   - `browse click @e3` — click buttons/links
   - `browse fill @e5 "test@example.com"` — fill inputs
   - `browse select @e7 "option-value"` — select dropdowns
   - `browse press Enter` — submit forms
3. After each step, snapshot and verify the expected outcome
4. Screenshot at each step for evidence

## Phase 4: Health Score

Rate the site on a 0-10 scale across these dimensions:

- **Console health**: errors / warnings count
- **Link health**: broken links / total links
- **Interactivity**: do buttons and forms work?
- **Visual completeness**: are there missing images, broken layouts?

Report format:
```
Health Score: 7/10
- Console: 9/10 (2 warnings, 0 errors)
- Links: 8/10 (1 broken link out of 45)
- Interactivity: 6/10 (signup form submit fails silently)
- Visual: 5/10 (hero image 404, footer misaligned on mobile)
```

## Phase 5: Fix Loop

For each issue found (in severity order):

1. Locate the root cause in the source code
2. Write the minimal fix
3. Run the test suite
4. Commit atomically: one fix per commit
5. Re-test in the browser to confirm the fix: `browse goto <url>` + `browse screenshot`
6. Move to the next issue

Stop conditions:
- All Critical/High issues fixed
- 20-fix cap reached (report remaining as known issues)
- Test suite regression detected — stop and report

## Phase 6: Report

Summarize all findings:

1. Pages tested (count and list)
2. Issues found (by severity)
3. Issues fixed (with commit hashes)
4. Issues remaining (if any)
5. Health score before and after
6. Screenshot evidence (file paths)

## Rules

- Always take screenshots as evidence — never claim "it looks fine" without proof
- One fix per commit, atomic and revertable
- Do not fix style preferences — only fix real bugs and broken functionality
- If you cannot reproduce an issue in the browser, note it as "not reproduced"
- Stop after 20 fixes to avoid scope creep
