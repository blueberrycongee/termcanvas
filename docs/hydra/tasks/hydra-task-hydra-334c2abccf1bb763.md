# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

You are a strict code reviewer. Review this PR diff for electron/hydra-skill.ts:

```diff
-      fs.symlinkSync(sourceDir, link);
+      fs.symlinkSync(sourceDir, link, process.platform === "win32" ? "junction" : undefined);
```

This change is applied at two locations (lines 36 and 68).

Context: This fixes GitHub issue #35 - symlinkSync on Windows requires admin privileges. Using "junction" type avoids this requirement.

Review criteria:
1. Correctness: Does fs.symlinkSync accept undefined as the third parameter? Check the Node.js API - the type parameter is optional and defaults to "file". For directories, does passing undefined work correctly on macOS/Linux? Should it be "dir" instead of undefined?
2. Junction limitations: Junctions only work for directories (not files) and only support absolute paths. Is sourceDir always a directory and always absolute?
3. Scope: Only these two lines should change, nothing else.

Read the actual file electron/hydra-skill.ts to verify sourceDir is always a directory path and always absolute.

Output a verdict: APPROVE or REQUEST_CHANGES with specific reasons. Be strict but do not nitpick or suggest over-engineering.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-334c2abccf1bb763.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
