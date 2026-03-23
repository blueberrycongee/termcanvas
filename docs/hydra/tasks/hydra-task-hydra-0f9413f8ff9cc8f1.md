# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: fix/codex-cached-token-double-counting

## Task

Review PR #60 (fix/codex-cached-token-double-counting) in this repo.

Context: The cost panel was double-counting Codex cached tokens because OpenAI's input_tokens INCLUDES cached_input_tokens (unlike Claude's API where they're separate). The fix subtracts cached_input_tokens from input_tokens in parseCodexSession().

Review the changes critically:
1. Read electron/usage-collector.ts — focus on the parseCodexSession function around line 370-385. Verify the subtraction logic is correct and handles edge cases (e.g., cached > input, both zero, missing fields).
2. Read tests/usage-collector.test.ts — check if the new tests adequately cover the fix and edge cases.
3. Check if the fix could break anything in the downstream consumers: computeCost, collectUsage, collectHeatmapData, and the sync logic in electron/usage-sync.ts.
4. Verify the cost formula in computeCost still makes sense with the corrected input values.
5. Check if there are any other places in the codebase that read Codex input tokens and might need the same fix.

Be critical. If you find issues, explain them clearly. If the fix is correct, say so.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-0f9413f8ff9cc8f1.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
