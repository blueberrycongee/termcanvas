# Hydra Orchestration Guide

## Architecture boundaries

- Hydra is a **Lead-driven control plane**, not the agent runtime. The Lead terminal owns the workflow and decides what happens at each decision point.
- Worker execution is delegated to local CLIs through TermCanvas. In the UI/runtime bridge this can be a tracked PTY terminal or a one-shot subprocess worker, but the workflow contract is the same either way.
- File evidence is authoritative. `workflow.json`, `assignment.json`, `task.md`, `report.md`, `result.json`, and `ledger.jsonl` define the runtime. Terminal prose is not a source of truth.
- Role files are the source of truth for CLI / model / reasoning. The caller picks `role`; Hydra resolves the terminal profile from that role definition.
- `hydra watch` is the decision loop. It returns structured decision points such as `node_completed`, `node_failed`, `batch_completed`, and `watch_timeout`.
- `hydra spawn` is intentionally separate from workflows: one isolated worker, no Lead-owned DAG, no decision loop.

## Mode selection

- Work directly in the current agent when the task is simple, local, or clearly faster than paying workflow overhead.
- Use `hydra init -> dispatch -> watch` when the task is ambiguous, risky, parallelizable, or has multiple decision points.
- Use `hydra spawn` when you already know the split and only need one isolated worker terminal.
- Run `hydra init-repo` once per repo when the project instructions need to be created or refreshed.

## Lead loop

1. Sync repo instructions once:
   ```bash
   hydra init-repo
   ```
2. Create a workflow:
   ```bash
   hydra init --intent "Add OAuth login" --repo .
   ```
3. Dispatch a node:
   ```bash
   hydra dispatch --workflow <workflowId> --node dev --role dev \
     --intent "Implement OAuth login and the tests that cover it" --repo .
   ```
4. Wait for the next decision point:
   ```bash
   hydra watch --workflow <workflowId> --repo .
   ```
5. At each decision point, choose one of:
   - `hydra approve --workflow <workflowId> --node <nodeId> --repo .`
   - `hydra reset --workflow <workflowId> --node <nodeId> --feedback "..." --repo .`
   - `hydra redispatch --workflow <workflowId> --node <nodeId> --repo .`
   - `hydra ask --workflow <workflowId> --node <nodeId> --message "..." --repo .`
   - `hydra dispatch --workflow <workflowId> --node <nextNode> --role <role> --intent "..." --repo .`
   - `hydra merge --workflow <workflowId> --nodes a,b --repo .`
   - `hydra complete --workflow <workflowId> --repo .`
   - `hydra fail --workflow <workflowId> --repo . --reason "..."`
6. Inspect state when needed:
   ```bash
   hydra status --workflow <workflowId> --repo .
   hydra ledger --workflow <workflowId> --repo .
   hydra list --workflows --repo .
   hydra list-roles --repo .
   ```
7. Clean up when the workflow is done:
   ```bash
   hydra cleanup --workflow <workflowId> --repo . --force
   ```

## Runtime files

```
.hydra/workflows/<workflowId>/
  workflow.json
  ledger.jsonl
  inputs/
    intent.md
  nodes/
    <nodeId>/
      intent.md
      feedback.md           # only when reset with feedback
  assignments/
    <assignmentId>/
      assignment.json
      runs/
        <runId>/
          task.md
          report.md
          result.json
          artifacts/        # optional extra human-readable files
  outputs/
    summary.md              # written by hydra complete --summary
```

- `workflow.json`: workflow metadata, DAG, node status map, approved refs, shared workflow context.
- `ledger.jsonl`: append-only event log of Lead / worker / system decisions.
- `nodes/<nodeId>/intent.md`: the canonical task statement for a node.
- `nodes/<nodeId>/feedback.md`: Lead feedback written by `hydra reset`.
- `assignment.json`: assignment state machine snapshot, retry state, runs, session metadata.
- `task.md`: run-specific task sheet built from workflow context, node intent, upstream outputs, role guidance, and result contract.
- `report.md`: human-readable report written by the worker.
- `result.json`: machine-readable routing result. This is the only completion gate Hydra trusts.

## Result contract

`result.json` must contain exactly these fields:

- `schema_version`
- `workflow_id`
- `assignment_id`
- `run_id`
- `outcome`
- `report_file`
- `stuck_reason` only when `outcome === "stuck"`

Current schema version: `hydra/result/v0.1`

`outcome` values:

- `completed`: the node finished its work
- `stuck`: the node cannot proceed and needs intervention
- `error`: the node hit a technical failure; Hydra may retry it automatically

`stuck_reason` values:

- `needs_clarification`
- `needs_credentials`
- `needs_context`
- `blocked_technical`

Hydra rejects:

- missing `result.json`
- malformed JSON
- schema mismatch
- wrong workflow / assignment / run ids
- missing required fields
- `stuck_reason` on a non-`stuck` outcome
- extra fields outside the allowed contract

Write `report.md` first. Publish `result.json` last, atomically.

## Troubleshooting

- `hydra watch` returns `batch_completed` but the workflow is still `active`:
  - No nodes are currently dispatched.
  - Either dispatch the newly eligible nodes or finish the workflow explicitly with `hydra complete`.
- A node completed but the next step is unclear:
  - Read its `report.md` first.
  - If you only need clarification, use `hydra ask` instead of resetting the node.
- A node needs rework:
  - Use `hydra reset --feedback` to write explicit feedback.
  - Then use `hydra redispatch` to run the same node again.
- The active run fails validation:
  - Open the run's `result.json`.
  - Fix malformed JSON, wrong ids, missing fields, or an invalid `stuck_reason`.
- A workflow appears stalled:
  - Check `hydra status --workflow <workflowId> --repo .`
  - Then inspect telemetry for the workflow / terminal before deciding whether to wait, reset, or fail.
- Cleanup is refused:
  - Hydra detected a live terminal.
  - Use `--force` only after confirming the terminal can be destroyed safely.

## Anti-patterns

- Using `hydra init` as repo setup. Repo setup is `hydra init-repo`; `hydra init` creates a workflow.
- Treating terminal text as completion evidence.
- Skipping `report.md` and trying to encode human explanation into `result.json`.
- Bypassing role definitions with ad hoc CLI assumptions.
- Using `hydra reset` when you only need a short follow-up answer. Use `hydra ask` for that.
- Declaring a workflow done without an explicit `hydra complete`.

## Acceptance

Run the local acceptance harness:

```bash
cd hydra
npm run e2e:acceptance -- --repo /absolute/path/to/repo --report /absolute/path/to/report.md
```

The acceptance harness exercises the Lead-driven control plane:

- `init`
- `dispatch`
- `watch`
- `approve`
- `reset` + `redispatch`
- `complete`
- `cleanup`
