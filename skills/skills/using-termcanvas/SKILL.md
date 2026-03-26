---
name: using-termcanvas
description: Use at the start of work in a TermCanvas-managed repo to decide whether to stay in the current agent, invoke Hydra, or use a narrow TermCanvas skill.
alwaysApply: true
---

# Using TermCanvas

Route first. Choose the lightest path that preserves correctness.

## Routing

- If the user asks to rename the current terminal or tab, use `rename`.
- If the task is simple, local, high-certainty, or faster in the current
  agent, do it directly. Do not invoke Hydra by default.
- If the task needs an isolated worktree, file evidence, retry/status control,
  or a staged handoff, use `hydra`.
- Before using Hydra in a repo, ensure the project has current Hydra
  instructions via `hydra init` or the TermCanvas Hydra enable action.

## Hydra mode choice

- `hydra run --task "..." --repo . --template single-step`
  - one implementer with `result.json` + `done` gates
  - use for clear implementation tasks that still need Hydra evidence
- `hydra run --task "..." --repo .`
  - default planner -> implementer -> evaluator loop
  - use for ambiguous, risky, PRD-driven, or long-running tasks
- `hydra spawn --task "..." --repo .`
  - one direct isolated worker terminal
  - use when the task split is already known

## Guardrails

- Do not describe Hydra workflows as automatic parallelism unless multiple
  spawned workers are actually involved.
- Prefer `hydra status` and workflow files over terminal prose.
