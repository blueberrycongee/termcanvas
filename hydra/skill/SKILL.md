---
name: hydra
description: Spawn AI sub-agents in isolated git worktrees via Hydra. Use when tasks can be parallelized or decomposed.
alwaysApply: false
---

# Hydra Sub-Agent Tool

When task uncertainty is high (unclear root cause, multiple valid approaches,
decomposable subtasks), investigate first, then use hydra to spawn sub-agents.

Workflow:
1. Investigate the problem yourself first, form a clear task description
2. `hydra spawn --task "<specific task>" --type claude --repo .`
3. Poll progress: `termcanvas terminal status <terminalId>`
4. Review: `termcanvas diff <worktreePath> --summary`
5. Adopt: `git merge <branch>`
6. Clean up: `hydra cleanup <agentId>`

When NOT to use: simple fixes, high-certainty tasks, faster to do yourself.
