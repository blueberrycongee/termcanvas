---
name: using-termcanvas
description: Use at the start of work in a TermCanvas-managed repo to decide whether to stay in the current agent, invoke Hydra, or use a narrow TermCanvas skill.
alwaysApply: true
---

# Using TermCanvas

Route first. Choose the lightest path that preserves correctness.

## Routing

- If the user asks to rename the current terminal or tab, use `rename`.
- If the user asks to investigate a bug, debug, or diagnose an issue, use `investigate`.
- If the user asks for a security review or audit, use `security-audit`.
- If the user asks for a code review or diff review, use `code-review`.
- If the task is simple, local, high-certainty, or faster in the current
  agent, do it directly. Do not invoke Hydra by default.
- If the task needs an isolated worktree, file evidence, retry/status control,
  or a staged handoff, use `hydra`.
- Before using Hydra in a repo, ensure the project has current Hydra
  instructions via `hydra init` or the TermCanvas Hydra enable action.

## Hydra workflow patterns

- `hydra run --task "..." --repo . --template single-step`
  - one implementer with `result.json` + `done` gates
  - use for clear implementation tasks that still need Hydra evidence
- `hydra run --task "..." --repo .`
  - default planner -> implementer -> evaluator loop
  - use for ambiguous, risky, PRD-driven, or long-running tasks

## Hydra worker primitive

- `hydra spawn --task "..." --repo .`
  - one direct isolated worker terminal
  - use when the task split is already known and you do not need a full workflow

## Guardrails

- Do not describe Hydra workflows as automatic parallelism unless multiple
  spawned workers are actually involved.
- When launching Claude/Codex tasks via TermCanvas CLI, use
  `termcanvas terminal create --prompt "..."` rather than `termcanvas terminal input`.
- After `hydra run` or `hydra spawn`, immediately start `hydra watch` — do not ask whether to watch.
- Use `hydra tick` / `hydra watch` / `hydra status` / `hydra retry` for
  workflow runs created by `hydra run`.
- Use `hydra list` and `hydra cleanup <agentId>` for direct workers created by
  `hydra spawn`.
- Prefer structured Hydra state and files over terminal prose.

## Memory Graph

When the session context contains a `<memory-graph>` block from TermCanvas:

- Check "References" before reading a memory file — referenced files are likely also relevant, follow the links
- If a memory is marked "Time-sensitive" with a date that has clearly passed, verify its content against current project state before acting on it
- Do not cite memory-graph metadata to the user — it's for your navigation, not for display
