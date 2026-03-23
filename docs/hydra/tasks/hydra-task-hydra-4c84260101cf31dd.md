# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

You are a strict code reviewer. Review this PR diff for electron/session-watcher.ts:

```diff
-    const projectKey = cwd.replaceAll(/[/.]/g, "-");
+    const projectKey = cwd.replaceAll(/[/\\.:-]/g, "-");
```

Context: This fixes GitHub issue #36 - projectKey regex does not handle Windows backslash paths. Windows cwd like `C:\Users\foo\project` was not properly sanitized because `\` and `:` were not in the regex.

Review criteria:
1. Correctness: Does the new regex `/[/\\.:-]/g` correctly match forward slash, backslash, dot, colon, and hyphen? Wait - does it also match hyphen? In a character class, `-` between characters creates a range. Is `:-` being interpreted as a range (colon through hyphen in ASCII)? Check if the regex is correct or if `-` needs to be escaped or placed at start/end of the character class.
2. Regression: Could this change break existing Unix path behavior?
3. Edge cases: What happens with paths containing hyphens already?

Read the actual file electron/session-watcher.ts around line 88-93 for full context.

Output a verdict: APPROVE or REQUEST_CHANGES with specific reasons. Be strict but do not nitpick or suggest over-engineering.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-4c84260101cf31dd.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
