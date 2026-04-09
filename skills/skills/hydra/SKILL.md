---
name: hydra
description: Use when a task should run through Hydra's Lead-driven workflow for multi-agent orchestration, or when an existing workflow must be inspected or cleaned up.
---

# Hydra Orchestration Toolkit

Hydra is a Lead-driven orchestration toolkit. You (the Lead agent) make strategic
decisions; Hydra handles operational management (dispatch, retry, health checks,
result collection).

Sub-agents output semantic intent (`done`/`needs_rework`/`replan`), not routing
information. Hydra manages the lifecycle; you decide what happens next.

## Core workflow

```
hydra init --intent "Add OAuth login" --repo .
# → { workflow_id, worktree_path }

hydra dispatch --workflow W --node researcher --role researcher \
  --intent "Analyze OAuth integration approach" --repo .
# → { node_id, assignment_id, status: "dispatched" }

hydra watch --workflow W --repo .
# → DecisionPoint: researcher completed with result

hydra approve --workflow W --node researcher --repo .

hydra dispatch --workflow W --node dev --role implementer \
  --intent "Implement OAuth middleware" \
  --depends-on researcher --repo .

hydra watch --workflow W --repo .
# → DecisionPoint: dev completed

hydra dispatch --workflow W --node tester --role tester \
  --intent "Verify OAuth flow" \
  --depends-on dev --repo .

hydra watch --workflow W --repo .
# → DecisionPoint: tester completed

hydra complete --workflow W --repo .
```

## Parallel dev

When the research identifies independent work streams, dispatch multiple devs
with isolated worktrees:

```
hydra dispatch --workflow W --node dev-frontend --role implementer \
  --intent "Frontend OAuth components" \
  --depends-on researcher --worktree .worktrees/frontend --repo .

hydra dispatch --workflow W --node dev-backend --role implementer \
  --intent "Backend OAuth middleware" \
  --depends-on researcher --worktree .worktrees/backend --repo .

hydra watch --workflow W --repo .
# → DecisionPoint: both completed

hydra merge --workflow W --nodes dev-frontend,dev-backend --repo .
```

## Handling agent results

When `watchUntilDecision` returns a `node_completed` DecisionPoint:

1. Check `outcome`:
   - **`completed`** — agent finished. Read `summary` to decide next step.
   - **`stuck`** — agent can't proceed. Read `summary` for what's needed.
   - **`error`** — Hydra already retried; if still failing, it reports to you.

2. Read the `summary` field (or the brief file) to decide:
   - Dispatch next node → `hydra dispatch ...`
   - Reset for rework → `hydra reset --workflow W --node dev --feedback "..." --repo .`
   - Reset for replan → `hydra reset --workflow W --node researcher --feedback "..." --repo .`
   - Re-dispatch after reset → `hydra redispatch --workflow W --node dev --repo .`
   - Complete workflow → `hydra complete --workflow W --repo .`

Hydra promotes blocked nodes to eligible automatically, but **you decide
when to dispatch**. Check `newly_eligible` in the DecisionPoint to see
what's ready.

## Agent role guidance

**researcher** — Investigate, plan, produce a brief. Good for Claude.
**implementer** — Write code. Good for Codex.
**tester** — Verify independently. Good for Claude.
**reviewer** — Second opinion on work. Replaces the old challenge mechanism.

Use `--agent-type` to override per node. Default inherits from workflow.

## Commands

| Command | Purpose |
|---------|---------|
| `hydra init` | Create workflow context |
| `hydra dispatch` | Dispatch an agent node |
| `hydra watch` | Wait for next decision point |
| `hydra approve` | Mark a node's output as approved |
| `hydra reset` | Reset a node and downstream |
| `hydra merge` | Merge parallel worktree branches |
| `hydra complete` | Mark workflow completed |
| `hydra fail` | Mark workflow failed |
| `hydra status` | Show workflow state |
| `hydra list` | List workflows |
| `hydra ledger` | Show workflow event log |
| `hydra cleanup` | Clean up workflow state |
| `hydra spawn` | Direct isolated worker (not a full workflow) |

## After `hydra dispatch` or `hydra watch`, always watch

After dispatching nodes, always call `hydra watch` to wait for the next
decision point. Do not poll manually with tick.

## Result contract

Sub-agents write `result.json` with `schema_version: "hydra/result/v2"`.

- `outcome`: `"completed"` / `"stuck"` / `"error"` — Hydra uses this for routing
- `summary`: free text — Lead reads this to decide what to do next
- `outputs`, `evidence`: structured artifact references
- `reflection` (optional): approach, blockers, confidence — Hydra retains for optimization

```json
{
  "outcome": "completed",
  "summary": "OAuth middleware implemented with passport.js. All tests pass.",
  "reflection": {
    "approach": "Grep-first strategy to find auth endpoints",
    "blockers_encountered": ["Missing types for session store"]
  }
}
```

## Ledger

Every workflow action is recorded in `.hydra/workflows/{id}/ledger.jsonl`.
Use `hydra ledger --workflow W --repo .` to inspect the event log.
