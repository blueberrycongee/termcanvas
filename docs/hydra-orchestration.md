# Hydra Orchestration Guide

## Architecture boundaries

- Hydra is a **Lead-driven control plane**, not the agent runtime. The Lead terminal owns the workbench and decides what happens at each decision point.
- Worker execution is delegated to local CLIs through TermCanvas. In the UI/runtime bridge this can be a tracked PTY terminal or a one-shot subprocess worker, but the workbench contract is the same either way.
- File evidence is authoritative. `workbench.json`, `assignment.json`, `task.md`, `report.md`, `result.json`, and `ledger.jsonl` define the runtime. Terminal prose is not a source of truth.
- Role files are the source of truth for CLI / model / reasoning. The caller picks `role`; Hydra resolves the terminal profile from that role definition.
- `hydra watch` is the decision loop. It returns structured decision points: `dispatch_completed`, `dispatch_failed`, `dispatch_failed_final`, `batch_completed`, `watch_timeout`, `stall_advisory`.
- `hydra spawn` is intentionally separate from workbenches: one isolated worker, no Lead-owned DAG, no decision loop.

## Mode selection

- Work directly in the current agent when the task is simple, local, or clearly faster than paying workbench overhead.
- Use `hydra init -> dispatch -> watch` when the task is ambiguous, risky, parallelizable, or has multiple decision points.
- Use `hydra spawn` when you already know the split and only need one isolated worker terminal.
- Run `hydra init-repo` once per repo when the project instructions need to be created or refreshed.

## Lead loop

1. Sync repo instructions once:
   ```bash
   hydra init-repo
   ```
2. Create a workbench:
   ```bash
   hydra init --intent "Add OAuth login" --repo .
   ```
3. Dispatch a unit of work:
   ```bash
   hydra dispatch --workbench <workbenchId> --dispatch dev --role dev \
     --intent "Implement OAuth login and the tests that cover it" --repo .
   ```
4. Wait for the next decision point:
   ```bash
   hydra watch --workbench <workbenchId> --repo .
   ```
5. At each decision point, choose one of:
   - `hydra approve --workbench <workbenchId> --dispatch <dispatchId> --repo .`
   - `hydra reset --workbench <workbenchId> --dispatch <dispatchId> --feedback "..." --repo .`
   - `hydra redispatch --workbench <workbenchId> --dispatch <dispatchId> --repo .`
   - `hydra ask --workbench <workbenchId> --dispatch <dispatchId> --message "..." --repo .`
   - `hydra dispatch --workbench <workbenchId> --dispatch <nextDispatchId> --role <role> --intent "..." --repo .`
   - `hydra merge --workbench <workbenchId> --dispatches a,b --repo .`
   - `hydra complete --workbench <workbenchId> --repo .`
   - `hydra fail --workbench <workbenchId> --repo . --reason "..."`
6. Inspect state when needed:
   ```bash
   hydra status --workbench <workbenchId> --repo .
   hydra ledger --workbench <workbenchId> --repo .
   hydra list --workbenches --repo .
   hydra list-roles --repo .
   ```
7. Clean up when the workbench is done:
   ```bash
   hydra cleanup --workbench <workbenchId> --repo . --force
   ```

## Decision points returned by `hydra watch`

- `dispatch_completed` — the active dispatch published a `result.json` with `outcome: completed` (or `stuck`). Lead reads `report.md` and chooses the next move.
- `dispatch_failed` — the active dispatch reported `outcome: error` or the run failed validation. Retry budget may allow automatic redispatch.
- `dispatch_failed_final` — retry budget exhausted. Lead has to reset, reroute, or fail the workbench.
- `batch_completed` — all dispatched units finished; no new work is in flight. Lead dispatches the next batch or calls `complete`.
- `watch_timeout` — `hydra watch` hit its timeout without a state change. Usually a signal to check telemetry or `hydra status` before continuing.
- `stall_advisory` — PTY liveness probe detected a worker that's still nominally active but hasn't made meaningful progress for a while. Lead can wait, `reset`, or take over. Introduced in 0.29.0 — earlier releases reported the same condition as `watch_timeout`.

## Runtime files

```
.hydra/workbenches/<workbenchId>/
  workbench.json
  ledger.jsonl
  inputs/
    intent.md
  dispatches/
    <dispatchId>/
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
    summary.md              # text passed to hydra complete --summary
```

- `workbench.json`: workbench metadata, DAG, dispatch status map, approved refs, shared workbench context.
- `ledger.jsonl`: append-only event log of Lead / worker / system decisions.
- `dispatches/<dispatchId>/intent.md`: the canonical task statement for a dispatch.
- `dispatches/<dispatchId>/feedback.md`: Lead feedback written by `hydra reset`.
- `assignment.json`: assignment state machine snapshot, retry state, runs, session metadata.
- `task.md`: run-specific task sheet built from workbench context, dispatch intent, upstream outputs, role guidance, and result contract.
- `report.md`: human-readable report written by the worker.
- `result.json`: machine-readable routing result. This is the only completion gate Hydra trusts.

## Result contract

`result.json` must contain exactly these fields:

- `schema_version`
- `workbench_id`
- `assignment_id`
- `run_id`
- `outcome`
- `report_file`
- `stuck_reason` only when `outcome === "stuck"`

Current schema version: `hydra/result/v0.1`

`outcome` values:

- `completed`: the dispatch finished its work
- `stuck`: the dispatch cannot proceed and needs intervention
- `error`: the dispatch hit a technical failure; Hydra may retry it automatically

`stuck_reason` values:

- `needs_clarification`
- `needs_credentials`
- `needs_context`
- `blocked_technical`

Hydra rejects:

- missing `result.json`
- malformed JSON
- schema mismatch
- wrong workbench / assignment / run ids
- missing required fields
- `stuck_reason` on a non-`stuck` outcome
- extra fields outside the allowed contract

Write `report.md` first. Publish `result.json` last, atomically.

## Troubleshooting

- `hydra watch` returns `batch_completed` but the workbench is still `active`:
  - No dispatches are currently in flight.
  - Either dispatch the newly eligible units or finish the workbench explicitly with `hydra complete`.
- A dispatch completed but the next step is unclear:
  - Read its `report.md` first.
  - If you only need clarification, use `hydra ask` instead of resetting the dispatch.
- A dispatch needs rework:
  - Use `hydra reset --feedback` to write explicit feedback.
  - Then use `hydra redispatch` to run the same dispatch again.
- The active run fails validation:
  - Open the run's `result.json`.
  - Fix malformed JSON, wrong ids, missing fields, or an invalid `stuck_reason`.
- A workbench appears stalled:
  - Check `hydra status --workbench <workbenchId> --repo .`
  - Then inspect telemetry for the workbench / terminal before deciding whether to wait, reset, or fail.
- `hydra watch` surfaces a `stall_advisory`:
  - The worker PTY is still alive but hasn't made meaningful progress recently.
  - Read `report.md` so far (if any), check telemetry events, and decide: keep waiting, `reset --feedback`, or take over manually.
- Cleanup is refused:
  - Hydra detected a live terminal.
  - Use `--force` only after confirming the terminal can be destroyed safely.

## Anti-patterns

- Using `hydra init` as repo setup. Repo setup is `hydra init-repo`; `hydra init` creates a workbench.
- Treating terminal text as completion evidence.
- Skipping `report.md` and trying to encode human explanation into `result.json`.
- Bypassing role definitions with ad hoc CLI assumptions.
- Using `hydra reset` when you only need a short follow-up answer. Use `hydra ask` for that.
- Declaring a workbench done without an explicit `hydra complete`.

## Acceptance

Run the local acceptance harness:

```bash
cd hydra
pnpm e2e:acceptance -- --repo /absolute/path/to/repo --report /absolute/path/to/report.md
```

The acceptance harness exercises the Lead-driven control plane:

- `init`
- `dispatch`
- `watch`
- `approve`
- `reset` + `redispatch`
- `complete`
- `cleanup`
