# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Investigate whether the Codex usage tracking in electron/usage-collector.ts has a token double-counting bug.

Specifically, in parseCodexSession() around line 370-380, the code does:
  input: totalUsage.input_tokens
  cacheRead: totalUsage.cached_input_tokens

The question is: In OpenAI's Codex API, does input_tokens INCLUDE cached_input_tokens (making them overlap), or are they separate counts?

Look at:
1. The actual Codex session JSONL files in ~/.codex/sessions/ - examine the total_token_usage fields and check if input_tokens includes cached_input_tokens by comparing total_tokens vs input_tokens + output_tokens
2. The computeCost function and how it uses both input and cacheRead - if they overlap, cost is inflated

Verify with real data from the session files. Report whether the bug is real and quantify the cost inflation if so.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-5516cc21557a368c.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
