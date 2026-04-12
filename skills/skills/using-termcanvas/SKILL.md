---
name: using-termcanvas
description: Use when starting work in a TermCanvas-managed repo to route between direct work, Hydra, or a narrow TermCanvas skill.
alwaysApply: true
---

# Using TermCanvas

Route first. Choose the lightest path that preserves correctness.

## Routing

- If the user wants to challenge, stress-test, or critically review an idea, argument, or proposal, use `challenge`.
- If the user asks to investigate a bug, debug, or diagnose an issue, use `investigate`.
- If the user asks for a security review or audit, use `security-audit`.
- If the user asks for a code review or diff review, use `code-review`.
- If the user asks to test a site, QA a page, or verify a deploy, use `qa`.
- If the task is simple, local, high-certainty, or faster in the current
  agent, do it directly. Do not invoke Hydra by default.
- If the task needs an isolated worktree, file evidence, retry/status control,
  or a staged workflow, use `hydra`.
- Before using Hydra in a repo, ensure the project has current Hydra
  instructions via `hydra init-repo` or the TermCanvas Hydra enable action.

## Hydra workflow patterns

Lead-driven, decision-point oriented. The Lead reads the codebase, picks
the strategy, and dispatches workers for the steps that need a fresh
agent process. Roles available: `lead` (the decider — not itself dispatched),
`dev` (writes code AND its tests), `reviewer` (independent cross-model
check). No separate researcher — the Lead does its own research. No
separate tester — dev owns its own test surface.

- `hydra init --intent "..." --repo .` then dispatch `dev` -> `reviewer`
  for ambiguous, risky, or PRD-driven work
  - call `hydra watch` after each dispatch to wait for the decision point
- `hydra spawn --task "..." --repo .` for a single isolated worker
  - use when the task split is already known and you do not need the
    full Lead-driven loop

## Hydra worker primitive

- `hydra spawn --task "..." --repo .`
  - one direct isolated worker terminal
  - use when the task split is already known and you do not need a full workflow

## Guardrails

- Do not describe Hydra workflows as automatic parallelism unless multiple
  spawned workers are actually involved.
- When launching Claude/Codex tasks via TermCanvas CLI, use
  `termcanvas terminal create --prompt "..."` rather than `termcanvas terminal input`.
- After `hydra dispatch`, immediately start `hydra watch` — do not ask whether to watch.
- Use `hydra watch` / `hydra status` / `hydra ledger` / `hydra list --workflows`
  for workflows created by `hydra init`.
- Use `hydra list` and `hydra cleanup <agentId>` for direct workers created by
  `hydra spawn`.
- Prefer structured Hydra state and files over terminal prose.

## Memory Graph

When the session context contains a `<memory-graph>` block from TermCanvas:

- Check "References" before reading a memory file — referenced files are likely also relevant, follow the links
- If a memory is marked "Time-sensitive" with a date that has clearly passed, verify its content against current project state before acting on it
- Do not cite memory-graph metadata to the user — it's for your navigation, not for display
