---
name: hydra
description: Spawn AI sub-agents in isolated git worktrees via Hydra. Use when tasks can be parallelized or decomposed.
alwaysApply: false
---

# Hydra Sub-Agent Tool

When task uncertainty is high (unclear root cause, multiple valid approaches,
decomposable subtasks), investigate first, then use hydra to spawn sub-agents.

## Choosing the right mode

- **Read-only tasks** (audit, review, analysis, investigation):
  `hydra spawn --task "..." --type claude --repo . --worktree <path>`
  Runs in an existing worktree. No branch created, no merge needed.

- **Code-change tasks** (implement, fix, refactor, test):
  `hydra spawn --task "..." --type claude --repo .`
  Creates a new worktree and branch. Merge the branch when done.

## Workflow

1. Investigate the problem yourself first, form a clear task description
2. Spawn agents (pick the right mode above)
3. **You MUST poll all agents until every one reaches "completed" or "error".**
   Poll each agent every 30s: `termcanvas terminal status <terminalId>`
   Do NOT ask the user whether to poll. Do NOT stop working while agents run.
4. Read each agent's result: `cat <worktreePath>/.hydra-result.md`
   Do NOT read terminal output or try to parse TUI. The result file is the
   only reliable communication channel from sub-agents.
5. For code-change tasks only:
   - Review changes: `termcanvas diff <worktreePath> --summary`
   - Adopt changes: `git merge <branch>`
6. Clean up: `hydra cleanup <agentId>`

## Rules

- After spawning, you are responsible for monitoring until completion.
- Never assume an agent finished just because spawn returned successfully.
- Always read `.hydra-result.md` before cleaning up.
- When NOT to use: simple fixes, high-certainty tasks, faster to do yourself.
