---
name: hydra
description: Use when a task should run through Hydra's file-contract workflow in an isolated worktree, or when an existing Hydra workflow must be inspected, retried, or cleaned up.
---

# Hydra Sub-Agent Tool

Use this skill after routing has already determined that Hydra is the right
execution path. Hydra is a strict file-contract workflow engine:
`handoff.json`, `task.md`, `result.json`, and `done` are authoritative.
Terminal conversation is not a source of truth.

## Choose the path

- `hydra run --task "..." --repo . --template single-step`
  - one implementer handoff
  - use for clear implementation work that still needs worktree isolation and
    `result.json` / `done` evidence
- `hydra run --task "..." --repo .`
  - default researcher -> implementer -> tester workflow, with research approval before implementation
  - use for ambiguous, risky, PRD-driven, or long-running tasks
  - if the user wants one provider for all roles, pass `--all-type <provider>`
  - if the user wants a mix, pass `--planner-type`, `--implementer-type`, and
    `--evaluator-type` (legacy flag names retained for researcher / implementer / tester)
  - if the user does not specify providers, inherit the current terminal type
    when available rather than hard-coding Claude or Codex

## Agent characteristics (soft guidance, not hard rules)

When choosing providers for each role, consider these observed tendencies:

**Claude** — stronger at reasoning, research, and architectural judgment.
- Good fit for: researcher, tester
- Watch out for: stub implementations (code that looks complete but doesn't work),
  context-window anxiety (rushing to finish when context fills up)

**Codex** — stronger at code generation, tends to complete the full task.
- Good fit for: implementer
- Watch out for: over-engineering (excessive try-catch, unnecessary boundary checks),
  test hacking (over-mocking, tests that pass without exercising real code)

These are defaults from experience, not constraints. The user can override freely
with `--all-type` or per-role flags. When the user does not specify, a reasonable
default is `--planner-type claude --implementer-type codex --evaluator-type claude`.

## Direct worker primitive

- `hydra spawn --task "..." --repo .`
  - one direct isolated worker terminal
  - use when the split is already known and only a separate worker is needed
  - this is not a full workflow run
  - use `--worker-type <provider>` when the user explicitly names the worker
    provider

## Agent launch rule

- When dispatching Claude/Codex through TermCanvas CLI, start a fresh agent
  terminal with `termcanvas terminal create --prompt "..."`
- Do not use `termcanvas terminal input` for task dispatch; it does not
  reliably submit prompts and is not a supported automation path

## Quality bar

- Root cause first. Fix the real implementation problem before changing tests.
- Do not hack tests, fixtures, snapshots, or mocks to force a green result.
- Do not add silent fallbacks, swallowed errors, or default-success paths.
- Tests prove correctness; they do not replace correctness.
- A handoff only passes when `result.json` and `done` both exist and the schema
  validates.

## Workflow control

1. Investigate first and write a concrete task description.
2. Start the chosen workflow or worker path:
   - Existing worktree / read-only workflow: `hydra run --task "..." --repo . --worktree .`
   - Existing worktree / read-only worker: `hydra spawn --task "..." --repo . --worktree .`
3. After `hydra run` or `hydra spawn`, immediately start polling with `hydra watch`. Do not ask whether to watch — always watch.
4. For workflow runs created by `hydra run`, advance or inspect with:
   - `hydra tick --repo . --workflow <workflowId>`
   - `hydra watch --repo . --workflow <workflowId>`
   - `hydra status --repo . --workflow <workflowId>`
   - `hydra challenge --repo . --workflow <workflowId>` to request an explicit challenge at the current workflow boundary
   - `hydra resolve-challenge --repo . --workflow <workflowId> --decision continue`
   - `hydra resolve-challenge --repo . --workflow <workflowId> --decision send_back --to <researcher|implementer|tester>`
   - `hydra retry --repo . --workflow <workflowId>`
4. For direct workers created by `hydra spawn`:
   - `hydra watch --agent <agentId>` to poll until completion
   - `hydra list --repo .` to list all agents
   - `hydra cleanup <agentId>` to clean up
5. Read failures from structured Hydra state; do not parse terminal prose.
6. Before deciding to keep waiting, retry, or take over a live workflow, query telemetry first:
   - `termcanvas telemetry get --workflow <workflowId> --repo .`
   - `termcanvas telemetry get --terminal <terminalId>`
7. Trust `derived_status` and `task_status` as the primary decision signals. Only investigate further when both indicate a problem.
8. Decision rules:
   - `derived_status=progressing` or `task_status=running` → keep waiting
   - `awaiting_contract` → turn is done but `result.json` / `done` still pending
   - `stall_candidate` → investigate with `termcanvas telemetry events --terminal <terminalId> --limit 20` before retry/takeover
   - `error` → check `last_hook_error` for retry/stop guidance
9. Clean up after completion:
   - workflow: `hydra cleanup --workflow <workflowId> --repo .`
   - worker: `hydra cleanup <agentId>`

## Result contract

`result.json` must contain:
- `success`
- `summary`
- `outputs[]`
- `evidence[]`
- `next_action`

The `done` marker must point at the exact `result.json` path for the handoff.
If either file is missing or invalid, Hydra must fail the handoff rather than
assuming success.

## Auto-approve inheritance

When you are already running in auto-approve/full-access mode, pass
`--auto-approve` so Claude/Codex sub-agents inherit the same autonomy.
Do not pass it in restricted approval modes.
