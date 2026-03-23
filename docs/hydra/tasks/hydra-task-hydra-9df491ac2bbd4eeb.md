# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

You are a strict code reviewer. Review this PR diff for electron/main.ts:

```diff
-    await shell.openExternal(`file://${filePath}`);
+    const error = await shell.openPath(filePath);
+    if (error) {
+      console.error(`[insights] Failed to open report: ${error}`);
+    }
```

Context: This fixes GitHub issue #33 - shell.openExternal with file:// URL broken on Windows paths. The old code constructed `file://${filePath}` which produces invalid URIs on Windows (backslash paths).

Review criteria:
1. Correctness: Does shell.openPath work cross-platform? shell.openPath returns a Promise<string> where empty string means success and non-empty string is the error. Is the error handling correct?
2. Security: Any risk with opening arbitrary file paths via shell.openPath?
3. Regression: Could this break existing macOS/Linux behavior? shell.openExternal opens URLs in default browser, shell.openPath opens files with default app - is this the right choice for a report file?
4. Scope: Flag if there are ANY changes beyond the minimal fix. The error handling is new - is it appropriate or over-engineering?

Read the actual file electron/main.ts around line 689-695 for full context.

Output a verdict: APPROVE or REQUEST_CHANGES with specific reasons. Be strict but do not nitpick or suggest over-engineering.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-9df491ac2bbd4eeb.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
