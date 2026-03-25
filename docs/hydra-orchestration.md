# Hydra Orchestration Guide

## Architecture boundaries

- Hydra is a control plane, not an agent runtime. Agent execution is delegated to local `claude` / `codex` CLIs through `termcanvas terminal create --prompt`.
- File evidence is authoritative. `handoff.json`, `task.md`, `result.json`, and `done` define the lifecycle. Terminal prose is not a source of truth.
- Internal orchestration state lives in repo-local `.hydra/workflows/<workflow>/workflow.json` and `.hydra/handoffs/<handoff>.json`.
- Workflow progression is state-machine-driven. `pending -> claimed -> in_progress -> completed|timed_out|failed` is explicit and idempotent.
- Contract validation is strict-fail. Missing or invalid `result.json` / `done` files fail the handoff instead of being treated as success.

## Runtime SOP

1. Start a workflow:
   ```bash
   hydra run --task "..." --repo . --template planner-implementer-evaluator
   ```
2. Advance once:
   ```bash
   hydra tick --repo . --workflow <workflowId>
   ```
3. Watch until terminal state:
   ```bash
   hydra watch --repo . --workflow <workflowId>
   ```
4. Inspect structured status and failure reasons:
   ```bash
   hydra status --repo . --workflow <workflowId>
   ```
5. Retry when the workflow is retryable:
   ```bash
   hydra retry --repo . --workflow <workflowId>
   ```
6. Clean up runtime state and worktrees:
   ```bash
   hydra cleanup --workflow <workflowId> --repo . --force
   ```

## Result contract

`result.json` must include:

- `success`
- `summary`
- `outputs[]`
- `evidence[]`
- `next_action`

`done` must point to the exact `result.json` path. Hydra rejects:

- missing `done`
- missing `result.json` after `done`
- malformed JSON
- schema mismatch
- wrong `handoff_id` / `workflow_id`
- wrong `result_file` in the done marker

## Troubleshooting

- Workflow stuck in `running`:
  - Run `hydra status --repo . --workflow <workflowId>`
  - Check whether `done` exists for the current handoff
  - If `done` is missing, the handoff is still active or stalled
- Workflow failed with `COLLECTOR_RESULT_INVALID`:
  - Open the handoff package and inspect `result.json`
  - Fix malformed JSON or missing required fields
- Workflow failed with timeout:
  - Inspect the current handoff and retry budget via `hydra status`
  - Use `hydra retry` if the workflow is still retryable
- Cleanup refused because a workflow is still running:
  - Re-run with `--force` after confirming the active terminal can be destroyed safely

## Anti-patterns

- Treating terminal text as completion evidence
- Hacking tests or fixtures so the result looks green
- Adding silent fallbacks or swallowed errors just to keep the workflow moving
- Declaring success without `result.json` and `done`
- Re-dispatching a handoff without idempotency checks

## Acceptance

Run the local acceptance harness:

```bash
cd hydra
npm run e2e:acceptance -- --repo /absolute/path/to/repo --report /absolute/path/to/report.md
```

The acceptance harness:

- launches real Claude/Codex terminals through TermCanvas
- drives a planner -> implementer -> evaluator -> implementer -> evaluator loop
- verifies failure, retry, recovery, and cleanup
- writes a reproducible acceptance report
