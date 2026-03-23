# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

You are a strict code reviewer. Review this PR diff for src/components/ComposerBar.tsx:

```diff
+import { hasPrimaryModifier } from "../hooks/shortcutTarget";

-  if (arrowSeq && (event.metaKey || draft.trim().length === 0)) {
+  if (arrowSeq && (hasPrimaryModifier(event) || draft.trim().length === 0)) {
```

Context: This fixes GitHub issue #37 - Ctrl+Arrow not forwarded to terminal on Windows because event.metaKey is always false on Windows.

Review criteria:
1. Correctness: Read src/hooks/shortcutTarget.ts to verify hasPrimaryModifier signature and behavior. Does it accept the event type used here? The function signature is `hasPrimaryModifier(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">, platform?: string)`. Is the event object in getPassthroughSequence compatible?
2. Behavioral change on Linux: hasPrimaryModifier returns ctrlKey on non-darwin. Previously Linux users needed empty draft for arrow forwarding (since metaKey is false on Linux too). Now Ctrl+Arrow will forward on Linux. Is this intentional and correct?
3. Import path: Does the project use .ts extensions in imports or not? Check other imports in the file for consistency.
4. Scope: Only import + one line change.

Read both files for full context.

Output a verdict: APPROVE or REQUEST_CHANGES with specific reasons. Be strict but do not nitpick or suggest over-engineering.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-ed9f5826e8c24a2a.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
