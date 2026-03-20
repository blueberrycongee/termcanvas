---
name: hydra
description: Spawn AI sub-agents in isolated git worktrees via Hydra. Use when tasks can be parallelized or decomposed.
alwaysApply: false
---

# Hydra Sub-Agent Tool

When task uncertainty is high (unclear root cause, multiple valid approaches,
decomposable subtasks), investigate first, then use hydra to spawn sub-agents.

## Choosing the right mode

Supported agent types currently include `claude`, `codex`, and `kimi`.

- **Read-only tasks** (audit, review, analysis, investigation):
  `hydra spawn --task "..." --type <agent-type> --repo . --worktree <path>`
  Runs in an existing worktree. No branch created, no merge needed.

- **Code-change tasks** (implement, fix, refactor, test):
  `hydra spawn --task "..." --type <agent-type> --repo .`
  Creates a new worktree and branch. Merge the branch when done.

## Permission inheritance

Sub-agents run as independent CLI processes. If they lack permissions, they
will stall on approval prompts with no way for you to intervene.

**Rule: if you are currently running in a permissionless / auto-approve mode
and spawning a Claude Code or Codex sub-agent, always pass `--auto-approve`
so sub-agents inherit the same level of autonomy.**

`--auto-approve` is currently supported for `--type claude` and `--type codex`
only. For other agent types it is silently ignored.

```
hydra spawn --task "..." --type codex --repo . --auto-approve
```

For `kimi`, do not rely on `--auto-approve`; the flag is ignored and Hydra
will launch the agent without extra approval arguments.

How to tell if you are in auto-approve mode:
- **Claude Code**: you were launched with `--dangerously-skip-permissions`,
  or your permission mode is `bypassPermissions`.
- **Codex**: your approval policy is `full-auto` / `full-access`,
  or you were launched with `--full-auto`.
- **When in doubt**: if tool calls (Bash, Write, Edit) execute without
  asking the user for approval, you are in auto-approve mode.

Do NOT pass `--auto-approve` if you are running in a restricted or
interactive-approval mode — the sub-agent should respect the same constraints.

## Explore-first strategy (optional)

For complex or unfamiliar codebases, spawn read-only explore agents **before**
writing implementation task descriptions. This parallelizes investigation and
keeps the results out of your own context window.

1. Spawn 2-3 read-only agents with focused exploration tasks:
   ```
   hydra spawn --task "Find all callers of X and trace the data flow" --type <agent-type> --repo . --worktree .
   hydra spawn --task "List existing test patterns for module Y" --type <agent-type> --repo . --worktree .
   hydra spawn --task "Explore the repository structure and key entry points" --type kimi --repo . --worktree .
   ```
2. Poll and collect their results (same polling rules as below)
3. Use the exploration results to write precise task descriptions for
   implementation agents

When to use: broad refactors, unfamiliar modules, unclear dependencies.
When to skip: you already know the codebase, the task is well-scoped.

## Workflow

1. Investigate the problem yourself first (or use the explore-first strategy
   above for broader tasks), then form a clear task description
2. Spawn agents (pick the right mode above)
3. **You MUST poll all agents until every one reaches "completed" or "error".**
   Poll each agent every 30s: `termcanvas terminal status <terminalId>`
   Do NOT ask the user whether to poll. Do NOT stop working while agents run.

   **Result file as primary completion signal**: The terminal status system
   can sometimes fail to transition to "completed" (especially on macOS).
   During each poll cycle, ALSO check if the result file exists:
   `test -f <resultFile> && echo "DONE" || echo "PENDING"`
   If the result file exists, the agent has finished — proceed to step 4
   regardless of what the terminal status says. Do NOT send any input to a
   terminal whose result file already exists.

   **Unblocking stalled agents**: If status is NOT "completed"/"error" AND
   the result file does NOT exist, check the last 20 lines of terminal output:
   `termcanvas terminal output <terminalId> --lines 20`
   Only send Enter if the output contains an **explicit permission prompt**:
   patterns like "Do you want to proceed?", "Allow", "❯ Yes", or
   "[Y/n]". Do NOT send Enter just because the agent appears idle or shows
   a bare input prompt (e.g. `>`, `❯`) — that means the agent is between
   turns, not stalled.
   `termcanvas terminal input <terminalId> $'\r'`
   Log what you approved so you can report it to the user later. If the
   prompt appears dangerous or irreversible (e.g. "delete all data",
   "force push to main"), do NOT auto-approve — instead report the situation
   to the user and wait for explicit instructions.
4. Read each agent's result: `cat <resultFile>` (path returned by spawn)
   Do NOT read terminal output or try to parse TUI. The result file is the
   only reliable communication channel from sub-agents.
5. For code-change tasks only:
   - Review changes: `termcanvas diff <worktreePath> --summary`
   - Adopt changes: `git merge <branch>`
6. Clean up: `hydra cleanup <agentId>`

## Rules

- After spawning, you are responsible for monitoring until completion.
- Never assume an agent finished just because spawn returned successfully.
- Always read the `resultFile` returned by `spawn` before cleaning up.
- When NOT to use: simple fixes, high-certainty tasks, faster to do yourself.
