---
name: investigate
description: >-
  Systematic debugging skill. Use when encountering a bug, test failure,
  unexpected behavior, or when asked to "investigate", "debug", "diagnose",
  or "figure out why". Enforces root-cause-first discipline with structured
  hypothesis tracking.
---

# Investigate

Systematic debugging workflow. Do not guess-and-fix — find the root cause first.

## Phase 1: Collect

Gather all available evidence before forming any hypothesis.

1. Read the error message, stack trace, or symptom description exactly as given
2. Identify the affected code path — read the relevant source files
3. Check `git log --oneline -20` in the affected area for recent changes
4. If reproducible, reproduce the issue and capture the exact output
5. List what you know and what you do not know

Deliverable: a structured symptom summary with affected files, error output, and recent changes.

## Phase 2: Hypothesize

Form up to 3 ranked hypotheses. For each:

- State the hypothesis in one sentence
- Identify the single cheapest check that would confirm or refute it
- Do NOT start fixing yet

## Phase 3: Verify

Test hypotheses in rank order. For each:

1. Run the cheapest check identified in Phase 2
2. If confirmed — move to Phase 4
3. If refuted — record what you learned and move to the next hypothesis

**3-strike rule:** If all 3 hypotheses fail, step back and re-collect. Do not keep
guessing. Re-read the code path more carefully, expand the search area, or check
for environmental factors (config, dependencies, platform).

## Phase 4: Fix

Only after root cause is confirmed:

1. Write the minimal fix that addresses the root cause
2. Do not refactor surrounding code
3. Do not add speculative defensive checks
4. Run the test suite to verify the fix and check for regressions

## Phase 5: Verify and Report

1. Confirm the original symptom is resolved
2. Confirm no regressions were introduced
3. Summarize: root cause, fix applied, evidence of resolution

## Rules

- Never skip Phase 1-3 and jump to fixing
- Never change tests to match broken behavior
- If the bug is in a dependency or environment, report it — do not patch around it silently
- If you cannot reproduce the issue, say so and explain what you tried
