# Hydra: Lead delegation + shared context + hydra ask + subprocess workers

Branch: `feat/hydra-satisfaction-loop`
Commits: `7f63707` + `40d6c41` (on top of `4ebb81e`)

## TL;DR

Expands Hydra's interface so the Lead can stop being the hub-and-spoke
middleman between dev/reviewer and focus on decider-level routing. Lands
four related capabilities, all opt-in or additive:

1. **Lead/Dev/Reviewer role formalization** — Lead is now a first-class
   role file, tester is gone, dev absorbs test-writing responsibilities.
2. **Workflow-level shared context** — `human_request`, `overall_plan`,
   and `shared_constraints[]` are broadcast to every dispatched node's
   `task.md` via a new `## Workflow Context` section.
3. **Upstream node visibility** — dispatched nodes get a new
   `## Upstream Nodes` section in their `task.md` listing each
   dependency's role, report path, and session id, so reviewer (and
   any downstream dev) can read dev's output and ask follow-ups
   directly without routing through Lead.
4. **`hydra ask` + opt-in subprocess worker mode** — new command and
   infrastructure for Lead (or any other actor) to ask a completed
   node a follow-up question via the CLI's native
   `--resume`/`exec resume` path, spawning a one-shot subprocess that
   preserves the original session.

No existing workflows change behavior. Every new field is optional;
every new path is opt-in.

## Architectural framing: Lead as kernel scheduler

Post-merge, the Lead's operational surface collapses to **6 verbs**:
`init / dispatch / watch / approve|reset / merge / complete|fail`
(plus `ask` occasionally and `status|ledger` for introspection).

Everything Lead used to do as a coordinator —

- Transcribing dev's conclusions for reviewer
- Answering reviewer's questions about dev
- Re-distributing constraints across nodes
- Holding cross-node state in its context window
- Translating between agents via reset feedback

— is now done by the agents themselves through **disk + subprocess**
primitives: sibling reports in readFiles, upstream pointers in
`## Upstream Nodes`, and `hydra ask` for targeted follow-ups.

This is closer to a SWF/Unix-kernel split than a coordinator: Lead's
job is `select()` + dispatch, not middleware. Its context window usage
drops because it no longer needs to hold cross-node state — downstream
agents read report.md fresh from disk each time.

### What Lead still does (and why it can't be delegated)

| Verb | Why Lead and only Lead |
|---|---|
| `init` | Translating human intent into workflow structure; only Lead holds the outer conversation |
| `dispatch` | Plan-to-concrete choice of role/intent/deps; needs global codebase understanding |
| `watch` + `approve/reset` | Trust boundary — "is this output good enough" is Lead's judgment call as the human's proxy |
| `merge` | Conflict arbitration — structurally non-delegable to the parties in conflict |
| `complete/fail` | Terminal lifecycle acts — explicit audit boundary |

### What Lead stops doing (delegated to agents)

| Old Lead duty | New owner |
|---|---|
| Transcribing dev's report to reviewer | Reviewer reads it via `readFiles` / `## Upstream Nodes` |
| Answering reviewer's questions about dev | Reviewer → `hydra ask --node dev` directly |
| Pasting workflow constraints into each dispatch intent | `shared_constraints[]` broadcast at init |
| Holding cross-node state in working memory | Gone. Agents re-read from disk. Lead forgets after DecisionPoint |

## What ships in this PR

### Commit 1 — `refactor(hydra): formalize Lead/Dev/Reviewer roles; drop tester`

Pure refactor. Pure rename. No behavior change beyond the new lineup.

- New `hydra/src/roles/builtin/lead.md` — not dispatchable, but codifies
  Lead's model pin (claude-opus-4-6/max), decision rules, and acceptance
  criteria as a first-class role file.
- New `hydra/src/roles/builtin/dev.md` — absorbs implementer + tester.
  "Dev owns its own test surface" is now in the decision_rules.
- Deleted `implementer.md` and `tester.md`. Cross-model check is now
  reviewer's job (already codex-primary).
- Dead code removal: `resolveWorkflowAgentTypes` and friends in
  `hydra/src/agent-selection.ts` (leftover from pre-9afea3b schema).
- Rename `implementer → dev` and `tester → reviewer` throughout tests,
  fixtures, e2e script, and SKILL.md templates.
- Fixes two pre-existing `headless-workflow-control.test.ts` failures
  as a side effect (they were asserting `shell === "codex"` against the
  old implementer role which had become claude-primary in `9afea3b`).

### Commit 2 — `feat(hydra): shared context, upstream refs, hydra ask + subprocess worker`

All four capabilities land together because they share the
`workflow-lead.ts`/`workflow-control.ts`/`task-spec-builder.ts` surface.

**Workflow-level shared context**:
- `WorkflowRecord` gains optional `human_request`, `overall_plan`,
  `shared_constraints[]`.
- `hydra init` gets `--human-request`, `--overall-plan`,
  `--shared-constraint` (repeatable) flags. Agent tool + HTTP endpoint
  follow.
- `task-spec-builder` injects a `## Workflow Context` section into
  every dispatched `task.md`.

**Upstream node visibility**:
- `task-spec-builder` also injects a `## Upstream Nodes` section listing
  each `depends_on`'s role, report path, result path, and session id
  (plus a pointer telling the worker that `hydra ask` is available).

**`hydra ask` command**:
- New `hydra/src/ask.ts` — standalone subprocess runner for
  `claude --resume --fork-session` and `codex exec resume`.
- New `askNode` in `workflow-lead.ts` — loads node → session,
  delegates to `askFollowUp`, writes a `lead_asked_followup` ledger
  entry with message/answer excerpts. Unit tested with `spawnImpl`
  injection.
- Surfaces: `hydra ask` CLI, `HydraWorkflow.ask` agent tool action,
  `POST /workflow/:id/node/:nodeId/ask` HTTP endpoint.
- New ledger event `lead_asked_followup` with one-line scannable
  formatter for `hydra ledger` output.

**Opt-in subprocess worker dispatch** (`HYDRA_WORKER_MODE=subprocess`):
- New `headless-runtime/subprocess-worker.ts` spawns `claude -p` /
  `codex exec --json` as non-interactive subprocess workers.
- Registers with `projectStore`/`telemetryService` via `ptyId=null`
  (already supported by `telemetry-service.ts:381`).
- `workflow-control.ts` branches `dispatchCreateOnly` on `workerMode`;
  PTY path is the default and 100% preserved for rollback.
- Session id captured from CLI stdout (claude result JSON / codex
  `thread.started.thread_id`) instead of session-file tailing.
- Standalone verification script at
  `hydra/scripts/spike-subprocess-worker.ts` exercises claude path
  end-to-end: real subprocess + resume + fork-session + content
  recall all pass.

## Test results

- **tsc --noEmit** clean on both hydra and headless configs
- **164/164** hydra tests pass (was 158; net +6: +4 `ask.ts` unit tests,
  +3 `askNode` orchestration tests, −1 dead `resolveWorkflowAgentTypes`
  test)
- **6/6** `tests/subprocess-worker.test.ts` pass
- **3/3** `tests/headless-workflow-control.test.ts` pass (fixes 2
  previously broken assertions)

One pre-existing `telemetry-service.test.ts` failure
("workflow snapshot reads contract truth from Hydra assignment run")
is unrelated to this work — it's residual debt from `4ebb81e` where
the test fixture still writes `default_agent_type` and a result.json
with an extra `summary` field that violates slim v0.1's
no-extra-fields rule.

## Experimental validation checklist (run locally before merging to main)

The empirical surface this PR can't verify from the sandbox:

- [ ] `HYDRA_WORKER_MODE=subprocess hydra dispatch --role dev ...` end
      to end against a real claude-authenticated termcanvas environment
- [ ] Same with `--role reviewer` against codex (source-verified only,
      never run against a real codex in this PR)
- [ ] `hydra ask --node dev --message "..."` against a real completed
      dev node — verify the answer comes back and `hydra ledger` shows
      a `lead_asked_followup` entry
- [ ] `hydra init --human-request "..." --overall-plan "..."
      --shared-constraint "..."` followed by a dispatch — verify the
      `## Workflow Context` section appears in the worker's `task.md`
- [ ] Dispatch a reviewer node with `--depends-on dev` and verify the
      worker's `task.md` has a `## Upstream Nodes` section pointing at
      dev's report and session id
- [ ] Long-task stability: dispatch a node that takes >10 minutes with
      `HYDRA_WORKER_MODE=subprocess` and confirm subprocess stdout
      doesn't hit `maxBuffer` (the spike only validated 20s / 5 turns)

## Deferred work — thinking to preserve

### `hydra annotate` (not done, but designed and intentional)

While evaluating how far Lead could delegate, we identified a gap:
after dispatch, Lead has no way to insert "read this carefully" kind
of guidance for **future** dispatched workers without doing a full
`reset`. The lightweight fix is an annotation primitive:

```
hydra annotate --workflow W --node dev \
  --note "reviewer should pay extra attention to a11y — we had an
          accessibility audit last month that flagged this component" \
  --repo .
```

Implementation sketch (≈50 lines):

1. `WorkflowRecord.nodes[id]` gets a new optional `lead_annotation?: string`
2. `task-spec-builder` renders `## Upstream Nodes` with the annotation
   (bolded as "Lead annotation") ahead of the report pointer, so the
   downstream worker sees Lead's directed attention before the raw
   report
3. Ledger records a new `lead_annotated { node_id, note_excerpt }`
   event
4. New CLI command, agent tool action, HTTP endpoint

**Why deferred**: the PR is already dense. This is a clean follow-up
that doesn't depend on new infrastructure. Not urgent until we have a
real workflow showing Lead wanted to annotate but couldn't.

### mailbox / worker uplink (not done, not designed)

Evaluated and explicitly dropped. The mailbox model would require
workers to poll their own inbox mid-turn, which means co-opting the
agent's run loop. That conflicts with Hydra's parasitic-upper-layer
positioning — we can only affect workers via the surfaces the CLI
already exposes (task.md, result.json, `--resume`, signals). No
in-loop polling without control of the agent's own scheduler.

Consequence: `shared_constraints` cannot be updated mid-flight for
running workers. Only newly-dispatched workers see updated values.
Lead's only mid-flight intervention for a running worker remains
`reset` (kill + restart with session resume). Acceptable.

### Lead being ask-able by other agents

Lead has a `session_id` too (it's a claude terminal driving Hydra).
A future extension could let downstream agents `hydra ask --lead`
to query Lead's accumulated understanding. Not done because:
1. Lead is not a dispatched node and has no `assignment_id`
2. The security model (who can ask Lead what) needs thought
3. It crosses a trust boundary we haven't designed yet

### Codex headless fork

`codex exec --fork` (openai/codex#13537) is still unmerged upstream.
Until it lands, codex follow-ups via `hydra ask` append to the
original session rather than forking. Documented as asymmetry in
`hydra/src/ask.ts` comments; no workaround attempted.

### CLI stats / cost aggregation (explicitly out of scope)

User-requested deferral: no budget-related work in this PR. The
subprocess worker does capture `total_cost_usd` from claude's result
envelope but it's not surfaced anywhere in Hydra state. Future work.

## Known limitations

- `human_request` / `overall_plan` / `shared_constraints[]` are free
  text. Very long values bloat every worker's `task.md` and could
  push context limits. No length caps enforced.
- `hydra ask` does not limit who can call it. In a single-Lead
  single-user workflow this is fine; any future multi-Lead or
  guest-agent work needs a caller identity check.
- `hydra ask` has a 5-minute default timeout. Nothing prevents an
  infinite reviewer→dev→reviewer→dev loop within one Lead turn; the
  timeout is the only backstop.
- Subprocess mode's session id extraction assumes claude's result
  JSON and codex's `thread.started` event. If either CLI changes its
  stdout format, extraction breaks silently (session id becomes null,
  `hydra ask` on that node fails with "no session_id captured").
- Subprocess mode captures stdout incrementally to a file at
  `.hydra/workflows/<wf>/subprocess/<terminal_id>.stream.jsonl` but
  nothing in the UI reads that file yet. No human observability
  affordance is restored in this PR.
