---
name: hydra
description: Spawn AI sub-agents in isolated git worktrees via Hydra. Use when tasks can be parallelized or decomposed.
alwaysApply: true
---

# Hydra Sub-Agent Tool

Use Hydra when the task benefits from file-driven multi-agent orchestration.
Hydra's completion gate is the file contract: `handoff.json`, `task.md`,
`result.json`, and `done`. Terminal conversation is not a source of truth.

## Quality bar

- Root cause first. Fix the real implementation problem before changing tests.
- Do not hack tests, fixtures, snapshots, or mocks to force a green result.
- Do not add silent fallbacks, swallowed errors, or default-success paths.
- Tests prove correctness; they do not replace correctness.
- A handoff only passes when `result.json` and `done` both exist and the schema
  validates.

## Workflow

1. Investigate first and write a concrete task description.
2. Start the workflow:
   - Standard: `hydra run --task "..." --repo .`
   - Existing worktree / read-only: `hydra run --task "..." --repo . --worktree .`
   - Multi-hop planner/implementer/evaluator: `hydra run --task "..." --repo . --template planner-implementer-evaluator`
3. Advance or inspect the workflow with structured commands:
   - `hydra tick --repo . --workflow <workflowId>`
   - `hydra watch --repo . --workflow <workflowId>`
   - `hydra status --repo . --workflow <workflowId>`
   - `hydra retry --repo . --workflow <workflowId>`
4. Read workflow failures from `hydra status`; do not parse terminal prose.
5. Clean up after completion: `hydra cleanup --workflow <workflowId> --repo .`

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

## Optional compatibility mode

Hydra still supports direct single-agent compatibility runs through
`hydra spawn`, but the preferred control plane is workflow-driven:
`run/tick/watch/status/retry`.
