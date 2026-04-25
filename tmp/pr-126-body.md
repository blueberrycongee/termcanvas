## Summary

Refactors Hydra from an autonomous workflow engine into a **Lead-driven
orchestration toolkit**, then progressively delegates coordination from
Lead to workers themselves via session-resume primitives.

Three waves of work, all on this branch:

1. **Lead-driven core** — Hydra stops auto-executing and becomes a
   decider pattern (SWF/Cadence-style). Lead calls `dispatch` then
   `watch`, receives a `DecisionPoint`, decides the next action.
2. **Role registry + typed sub-states + declarative retry** — roles
   become `terminals[]`-pinned agent invocation profiles loaded from
   markdown+frontmatter. `stuck_reason` sub-states let Lead route
   interventions without reading `report.md` first. Retry policy is
   per-node Temporal-style with backoff and non-retryable codes. The
   ledger is redesigned as a decision-centric audit log with
   `actor: lead|worker|system` on every entry.
3. **Lead delegation via shared context + `hydra ask`** *(latest push)* —
   Lead/Dev/Reviewer role formalization; workflow-level shared context
   broadcast to every dispatched node's `task.md`; upstream visibility
   so reviewers can read dev's output directly; `hydra ask` command that
   spawns a one-shot `claude --resume --fork-session` / `codex exec
   resume` subprocess for follow-up questions without re-dispatch. Plus
   an opt-in `HYDRA_WORKER_MODE=subprocess` path that dispatches workers
   as non-interactive subprocesses via claude `-p` / codex `exec --json`
   instead of PTY-backed terminals (default is still PTY).

## Architectural framing: Lead as kernel scheduler

After this PR, Lead's operational surface collapses to **6 verbs**:
`init / dispatch / watch / approve|reset / merge / complete|fail`
(plus `ask` occasionally and `status|ledger` for introspection).

Everything Lead used to do as a coordinator — transcribing dev's
conclusions for reviewer, answering reviewer's questions about dev,
holding cross-node state in its context window, redistributing
constraints across nodes — is now done by the agents themselves via
**disk + subprocess** primitives:

- Sibling reports appear in `task.md`'s `readFiles`
- Upstream pointers (role, report path, session id) appear in a new
  `## Upstream Nodes` section of `task.md`
- Follow-up questions go via `hydra ask --node <id> --message "..."`,
  which resumes the target node's session through the CLI's native
  `--resume` / `exec resume` path — no worker-side cooperation needed

This is closer to a SWF/Unix-kernel split than a coordinator. Lead's
context window usage drops because it no longer needs to hold
cross-node state — downstream agents re-read `report.md` from disk
when they need it.

## File layout (per workflow)

```
.hydra/workflows/{id}/
├── workflow.json              # Hydra-only metadata (now with optional
│                              # human_request / overall_plan /
│                              # shared_constraints[])
├── ledger.jsonl               # Decision-centric event log with actor
│                              # + cause on every entry
├── inputs/intent.md           # User intent (human-readable)
├── outputs/summary.md?        # Final summary on completion
├── nodes/{nodeId}/
│   ├── intent.md              # Per-node intent
│   └── feedback.md?           # Reset feedback
├── assignments/{id}/runs/{id}/
│   ├── task.md                # Generated task file (now includes
│   │                          # ## Workflow Context + ## Upstream Nodes
│   │                          # when applicable)
│   ├── result.json            # Slim: outcome + report_file
│   ├── report.md              # Worker's human-readable report
│   └── artifacts/             # Other agent outputs
└── subprocess/{terminalId}.stream.jsonl?
                               # Only when HYDRA_WORKER_MODE=subprocess
                               # — raw CLI JSONL stream for observability
```

## Schemas (all still v0.1)

**SubAgentResult** — unchanged:
```ts
{ schema_version, workflow_id, assignment_id, run_id, outcome, report_file }
```
`outcome` is `completed | stuck | error`. When `outcome === "stuck"` a
`stuck_reason` field may accompany it:
`needs_clarification | needs_credentials | needs_context | blocked_technical`.
Hydra auto-retries `error`; reports `completed / stuck` to Lead via
`DecisionPoint`.

**WorkflowRecord** — adds three optional fields in the latest wave:
- `human_request?: string` — original human-written request (set at init)
- `overall_plan?: string` — Lead's plan/DAG summary (set at init)
- `shared_constraints?: string[]` — constraints broadcast to every
  dispatched node's `task.md`

Everything else stays put. Optional fields mean old `workflow.json` files
on disk continue to load unchanged.

**LedgerEvent** — adds one new variant:
```ts
{ type: "lead_asked_followup"; node_id; role; agent_type; session_id;
  new_session_id?; message_excerpt; answer_excerpt; duration_ms }
```
One-line scannable formatter in `hydra ledger` output, same as the
other event types.

**Role registry** — roles live in `hydra/src/roles/builtin/*.md`
(and `~/.hydra/roles/*.md` and `<repo>/.hydra/roles/*.md` for user /
project overrides). After this PR the builtin lineup is:
- `lead.md` — the decider, not dispatchable, codifies Lead's model
  pin (claude-opus-4-6/max) and operational rules as a first-class
  role file
- `dev.md` — writes code and the tests that cover it (absorbs the
  old `implementer` + `tester`). Default: claude opus max, codex
  fallback.
- `reviewer.md` — independent cross-model (different CLI family)
  review at the highest available reasoning effort. Default: codex
  xhigh, claude max fallback.

No more `implementer`, no more `tester`, no more `researcher`. Lead
does its own research; dev owns its own test surface; reviewer
provides the cross-model check.

## New Hydra commands / interfaces

- `hydra init ... --human-request "..." --overall-plan "..." --shared-constraint "..."`
  (the last is repeatable). Sets workflow-level context that broadcasts
  to every dispatched node.
- `hydra ask --workflow W --node N --message "..." --repo .` — spins
  up a one-shot subprocess that resumes N's session and asks a
  follow-up. Returns `{ answer, new_session_id?, duration_ms }`.
  Writes a `lead_asked_followup` ledger entry.
- `hydra list-roles [--cli claude|codex]` — filters the role registry
  by primary terminal type.
- `HYDRA_WORKER_MODE=subprocess` environment variable — opts into the
  new subprocess dispatch path. `HYDRA_WORKER_MODE=pty` (default)
  preserves the existing behavior exactly.
- Agent tool `HydraWorkflow` gains `ask` action plus `humanRequest /
  overallPlan / sharedConstraints` input fields.
- `POST /workflow/:id/node/:nodeId/ask` HTTP endpoint.

## Implementation highlights

### Lead-driven core (early commits, see `refactor(hydra): Lead-driven`)
- `workflow-lead.ts` exports `initWorkflow / dispatchNode /
  watchUntilDecision / approveNode / resetNode / mergeWorktrees /
  completeWorkflow / failWorkflow / getWorkflowStatus` as the primary
  API. `lead-guard.ts` enforces single-Lead semantics via
  `lead_terminal_id` + `TERMCANVAS_TERMINAL_ID` env.
- `artifacts.ts` owns all per-workflow file I/O (intent.md,
  feedback.md, summary.md, task.md, result.json).
- `assignment/state-machine.ts` is the retry / timeout gatekeeper.

### Role registry + retry + ledger redesign
- `roles/loader.ts` implements the 3-level fallback (project → user →
  builtin). `task-spec-builder.ts` reads the role's `terminals[0]` and
  renders the role body into `task.md` as an additive briefing
  (never replaces the CLI's built-in persona).
- `retry.ts` + `assignment/state-machine.ts` — declarative RetryPolicy
  snapshotted onto assignment at dispatch; backoff + next_retry_at +
  non_retryable_error_codes; `dispatchAssignment` sleeps via the
  injected sleep dep (so tests don't wait wall-clock).
- `ledger.ts` — every entry has `actor: lead | worker | system`;
  events carry cause (`initial | system_retry | lead_redispatch`),
  failure_message + report_file on failed nodes, and so on. `hydra
  ledger` default output is one-line scannable with `[L]/[W]/[S]`
  actor prefixes.

### Shared context + upstream visibility
- `task-spec-builder.ts` injects a `## Workflow Context` section when
  any of `human_request / overall_plan / shared_constraints` are set.
- It also injects a `## Upstream Nodes` section listing each
  `depends_on` dependency's role, report path, result path, and
  `session_id` (along with a `hydra ask` hint) — so reviewer doesn't
  have to grep for dev's output.

### `hydra ask` and the delegation model
- `hydra/src/ask.ts` owns the subprocess spawning. Wraps
  `claude -p --output-format json --resume <sid> --fork-session <msg>`
  and `codex exec resume <sid> --json --skip-git-repo-check --cd <workdir> <msg>`,
  handles timeout, stderr capture, and structured answer parsing.
  Codex has no headless fork (openai/codex#13537 unmerged), so codex
  follow-ups append to the original session — documented.
- `askNode` in `workflow-lead.ts` loads the node's latest run's
  session info, delegates to `askFollowUp`, and writes a
  `lead_asked_followup` ledger entry with message/answer excerpts.
  Injected `askFollowUp` dependency for deterministic tests.

### Subprocess worker dispatch (`HYDRA_WORKER_MODE=subprocess`)
- `headless-runtime/subprocess-worker.ts` — parallel to
  `terminal-launch.ts`'s `launchTrackedTerminal`. Spawns `claude -p` /
  `codex exec --json`, captures stdout incrementally to a log file
  under `.hydra/workflows/<wf>/subprocess/<id>.stream.jsonl`,
  registers the worker in `projectStore` + `telemetryService` with
  `ptyId: null` (already supported by `telemetry-service.ts:381`).
- `workflow-control.ts` branches `dispatchCreateOnly` on
  `workerMode`; PTY path is unchanged and remains the default.
- Session id is extracted from the CLI's structured stdout (claude's
  result JSON `session_id`, codex's `thread.started.thread_id` —
  source-verified against codex-rs/exec/src/cli.rs and exec_events.rs).
- Standalone verification script at
  `hydra/scripts/spike-subprocess-worker.ts` exercises the claude
  path end-to-end: real subprocess + resume + fork-session + content
  recall all pass.

## Test results

- `tsc --noEmit` clean on both hydra and headless configs
- **173/173** tests pass across hydra/, subprocess-worker, and
  headless-workflow-control
- `headless-workflow-control.test.ts` went from 1/3 to 3/3 in the
  latest wave — the 2 previously-failing tests were asserting
  `shell === "codex"` against the old `implementer` role, which
  became claude-primary in `9afea3b`. Re-pointing them at `reviewer`
  (now the codex-primary role) restored the intended cross-CLI
  assertion.

One pre-existing `telemetry-service.test.ts` failure ("workflow
snapshot reads contract truth from Hydra assignment run") is
unrelated to this work — residual debt from `4ebb81e` where the
fixture still writes `default_agent_type` and a `result.json` with
an extra `summary` field that violates slim v0.1's no-extra-fields
rule. Documented, deferred.

## Experimental validation checklist

Before promoting this PR from "experimental merge" to "ready for
main", run these in a real termcanvas + claude/codex authenticated
environment:

- [ ] `HYDRA_WORKER_MODE=subprocess hydra dispatch --role dev ...`
      end-to-end against claude (sandbox only tested PTY path for
      real workflows)
- [ ] Same with `--role reviewer` against codex — source-verified
      only, never run against real codex in this PR
- [ ] `hydra ask --node dev --message "..."` against a real completed
      dev node. Verify the answer comes back and `hydra ledger` shows
      a `lead_asked_followup` entry
- [ ] `hydra init --human-request "..." --overall-plan "..." --shared-constraint "..."`
      followed by a dispatch — verify `## Workflow Context` appears
      in the worker's `task.md`
- [ ] Dispatch a reviewer node with `--depends-on dev` — verify
      `## Upstream Nodes` section appears and contains dev's session
      id (for follow-up via `hydra ask`)
- [ ] Long-task stability — dispatch a >10-minute node with
      `HYDRA_WORKER_MODE=subprocess` and verify subprocess stdout
      doesn't hit `maxBuffer` (spike only validated ~20s / 5 turns)

## Deferred work (intentional)

### `hydra annotate` (designed, not built)

Lightweight Lead-side primitive for annotating a completed node with
"here's what downstream workers should watch for" guidance, without
doing a full `reset`. Design sketch:

```
hydra annotate --workflow W --node dev \
  --note "reviewer should pay extra attention to a11y — we had an
          accessibility audit last month that flagged this component"
```

Implementation (~50 lines): `WorkflowNode.lead_annotation?: string` +
render it into downstream task.md's `## Upstream Nodes` section +
new `lead_annotated` ledger event + CLI/tool/HTTP surfaces. Not
urgent until a real workflow asks for it.

### mailbox / worker uplink (evaluated, dropped)

A mailbox model would require workers to poll their own inbox
mid-turn, which means co-opting the agent's run loop. That conflicts
with Hydra's parasitic-upper-layer positioning — we can only affect
workers via surfaces the CLI already exposes (task.md, result.json,
`--resume`, signals). No in-loop polling without control of the
agent's own scheduler.

Consequence: `shared_constraints` cannot be updated mid-flight for
running workers. Only newly-dispatched workers see updated values.
Lead's only mid-flight intervention for a running worker remains
`reset` (kill + restart with session resume). Acceptable.

### Others

- `workflow → mission` rename — deferred to a separate pre-release PR
- `sub-agent → worker` rename — same
- Cost / budget aggregation view — explicitly excluded by user ask
- Lead being ask-able by downstream agents — future extension, trust
  model needs design
- `codex exec --fork` — waiting on openai/codex#13537

## Known limitations

- `human_request` / `overall_plan` / `shared_constraints[]` are free
  text with no length caps. Very long values bloat every worker's
  `task.md`.
- `hydra ask` has a 5-minute default timeout and no caller identity
  check. Single-Lead single-user workflows are fine; future multi-Lead
  work will need a caller identity gate.
- Subprocess mode extracts session ids from CLI-specific stdout
  shapes. If claude's `result.session_id` or codex's
  `thread.started.thread_id` ever get renamed, extraction silently
  returns null and downstream `hydra ask` on that node fails with
  "no session_id captured". Monitored by the subprocess-worker tests.
- The subprocess `cli-stream.jsonl` log is captured but no UI reads
  it yet — human observability affordance for HYDRA_WORKER_MODE=subprocess
  is not restored in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
