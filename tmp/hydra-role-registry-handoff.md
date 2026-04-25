# Hydra Role Registry — Next Session Handoff

**Date written**: 2026-04-11
**Branch**: `feat/hydra-satisfaction-loop`
**PR**: #126 — `refactor(hydra): Lead-driven orchestration toolkit`
**Status**: PR is open, mergeable=CLEAN. 5 new commits pushed in this session (`c1fe0dd..4e5f4c3`).

---

# ✅ COMPLETION REPORT (2026-04-12 session)

This handoff was executed in the 2026-04-12 session. Everything in §1–§13
below is **historical context** — the original plan as written before the
session ran. What actually shipped is summarized here. **All five Tier 1
items are done; the role schema design evolved during execution; the ledger
was redesigned twice as the framing got sharper.** 10 new commits on top
of `4e5f4c3`, pushed to origin as `4e5f4c3..4ebb81e`.

## Commits shipped (10)

| commit | summary |
|---|---|
| `acfe104` | feat(hydra): role registry loader + 8 builtin role files |
| `2088541` | refactor(hydra): drive dispatch + task.md from role registry, add list-roles |
| `04a5f8d` | feat(hydra): add stuck_reason sub-states to result contract |
| `1af8b7f` | docs(hydra): flag the four design principles that distinguish Hydra |
| `567009b` | docs(hydra): resync init.ts HYDRA_SECTION + skill copy with current contract |
| `8008caf` | feat(hydra): declarative RetryPolicy with backoff and non-retryable codes |
| `a29ed81` | test(hydra): event-sourcing replay test for ledger.jsonl with gap inventory |
| `a0e7232` | refactor(hydra): redesign ledger as decision-centric audit log |
| `9afea3b` | refactor(hydra): role schema -> terminals[] + drop researcher |
| `4ebb81e` | chore(hydra): post-refactor cleanup — drop default_agent_type, fix headless workflow-control, finalize model names |

## Tier 1 status

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Role registry | ✅ | Shipped in `acfe104` + `2088541`, then **schema-evolved** in `9afea3b` (see §A below) |
| 2 | Declarative RetryPolicy | ✅ | `8008caf` — Temporal-style policy, backoff, non-retryable error codes, snapshot onto AssignmentRecord, sleep-respecting redispatch |
| 3 | `stuck_reason` sub-states | ✅ | `04a5f8d` — `needs_clarification` / `needs_credentials` / `needs_context` / `blocked_technical`, validated, surfaced through DecisionPoint |
| 4 | Ledger replay test | ✅ | `a29ed81` then **completely reframed** in `a0e7232` (see §B below) |
| 5 | Docs flagging | ✅ | `1af8b7f` — four design principles in CLAUDE.md and SKILL.md |

## §A — How the role registry diverged from the original §2 design

The original §2 design pinned each role to **one** CLI via a frontmatter
`agent_type` field. During execution the user pushed back: roles should
declare an **ordered priority list** of CLI/model/reasoning_effort
choices, modeled after Amp's per-role SOTA model page. The schema became:

```yaml
---
name: implementer
description: ...
terminals:
  - cli: claude
    model: claude-opus-4-6
    reasoning_effort: max
  - cli: codex
    model: gpt-5.4
    reasoning_effort: high
---
```

`terminals[0]` is the dispatcher's choice today; future fallback logic
walks the list. The user also dropped the `researcher` role entirely
(it duplicated work the Lead already does at decision points). Final
builtin lineup is **3 roles**, not 8:

| role | terminals[0] | terminals[1] (fallback) |
|---|---|---|
| `implementer` | claude `claude-opus-4-6` / max | codex `gpt-5.4` / high |
| `tester` | codex `gpt-5.4` / high | claude `claude-opus-4-6` / high |
| `reviewer` | codex `gpt-5.4` / xhigh | claude `claude-opus-4-6` / max |

`tester` deliberately uses a **different model family** from `implementer`
so blind spots don't overlap (multi-judge pattern). `reviewer` runs at
`xhigh` because it is the last line of defense before Lead approves.

The reasoning_effort values are **per-CLI native vocabulary** — Hydra
does not normalize between them. Verified flags:

- claude: `--effort low|medium|high|max` (verified from `claude --help`)
- codex: `-c model_reasoning_effort=low|medium|high|xhigh` (verified
  from [OpenAI Codex CLI docs](https://developers.openai.com/codex/models)
  and [openai/codex#2715](https://github.com/openai/codex/issues/2715))

`gpt-5.4` is the actual current Codex frontier model per
developers.openai.com/codex/models — *not* the placeholder
`gpt-5-codex-max` we initially used.

## §B — How Tier 1 #4 (ledger replay) became a ledger redesign

The original §6 plan described #4 as an "event sourcing replay test" that
would delete `*.json` and rebuild from ledger. I shipped the first
version (`a29ed81`) following that framing and produced a `KNOWN_REPLAY_GAPS`
inventory of "fields that aren't in the ledger yet".

The user pushed back on the framing: **"从第一性原理来看，ledger 的主要
目的是为了优化 hydra"** — the ledger isn't an event source, it's an
audit log read periodically by humans/agents to judge whether decisions
were correct. This is a different design pattern (decision-centric
activity feed, not state-recovery layer).

I admitted the framing was wrong and rewrote (`a0e7232`):

- Every entry now carries `actor: "lead" | "worker" | "system"` — the
  reader's first question is "who decided this", and the three classes
  have completely different judgment criteria
- `node_dispatched` gains `cause: "initial" | "system_retry" | "lead_redispatch"`
- `node_failed` gains `failure_message` + `report_file` (drill-down)
- `node_completed` gains `stuck_reason`
- `workflow_failed` gains `failed_node_id`
- New events for previously-silent system decisions:
  `assignment_retried` (with cause + attempt + max_attempts + next_retry_at)
  and `node_promoted_eligible` (with triggered_by deps)
- `hydra ledger` CLI default output is now one-line scannable with
  `[L]` / `[W]` / `[S]` actor prefixes; `--json` preserves machine output
- `KNOWN_REPLAY_GAPS` was reframed and renamed to `INTENTIONALLY_NOT_LEDGERED`
  with documented rationale per category — these fields live in `*.json`
  by design, not by debt
- The replay test became 5 user-story-driven cases (Q1 lifecycle / Q2
  Lead decisions / Q3 system decisions / Q4 worker verdicts / Q5
  drill-down refs) plus a change-detector for the inventory

## §C — Beyond the Tier 1 list: cleanups the user asked for

After the user pointed out that the 3 "pre-existing" failing tests I had
been calling "unrelated" were actually in the same surface I had just
edited, I cleaned the chain (`567009b`):

- `init.ts` HYDRA_SECTION rewritten to mirror the current root CLAUDE.md
  verbatim (was still on the legacy "v2 result.json" shape and the
  legacy `## Hydra Sub-Agent Tool` marker)
- `skills/skills/hydra/SKILL.md` gained a "Lead operational rules"
  section (root-cause-first / no test hacking / no silent fallbacks /
  agent launch rule / telemetry polling)
- `init.test.ts` and `skills-template.test.ts` updated to match the
  current marker + content; assertions for removed features (`hydra run
  --task`, `--template single-step`) dropped

After the role refactor, a final cleanup pass (`4ebb81e`) removed loose
ends:

- `default_agent_type` zombie field removed from `WorkflowRecord`,
  `InitWorkflowOptions`, `cliInit`, api-server, agent tool, termcanvas
  CLI, e2e-acceptance, all test fixtures, and the `INTENTIONALLY_NOT_LEDGERED`
  inventory. It looked like a control knob but controlled nothing after
  the role refactor.
- 4 real bugs caught in `headless-runtime/workflow-control.ts` —
  stale references to the dropped `RoleDefinition.agent_type` /
  `model` fields. These would have failed `tsconfig.headless.json` typecheck
  during a real build; the sandbox couldn't run that until I installed
  root `node_modules`. Now passes.
- `task.md` Run Context block now shows `- Model: ...` and
  `- Reasoning effort: ...` so the worker (and any human reading
  task.md) can see the exact CLI configuration the dispatcher chose.
- builtin role files repinned from `gpt-5-codex-max` → `gpt-5.4` (the
  actual current Codex frontier model, not the placeholder I had been
  using). Claude side stays `claude-opus-4-6`.

## §D — Final state

**Hydra test suite**: **158 / 158 ✓** (started at ~127/130 with 3
pre-existing failures; the failures were resolved as part of `567009b`,
and 28 new tests landed across all 10 commits).

**Typecheck**:
- `hydra/` `tsc --noEmit` ✓
- root `tsc --noEmit -p tsconfig.headless.json` ✓ (this one was actually
  run after `npm install` at the root — caught the 4 workflow-control
  bugs that the sandbox-only setup had missed)

**Open soft risks**:
- `e2e-acceptance.ts` was source-updated but never run in a real
  termcanvas environment. The sandbox doesn't have a live termcanvas
  + claude/codex setup, so end-to-end behavior of the new role schema
  is only verified through unit + integration tests, not a real
  workflow run.

**Out-of-scope debt noted but not touched**:
- `agent/src/tool.ts` has 8 pre-existing zod tsc errors (`$ZodTypeDef`
  internals). They're on the parent commit `4e5f4c3` too, unrelated to
  this session's work. Separate cleanup.
- The `sub-agent → worker` rename and `workflow → mission` rename
  noted in §7 below are still pending (user explicitly deferred to a
  separate pre-release rename PR).

**What the next session would pick up if it wanted to keep going**:
- The "fallback logic" for `terminals[]` — Hydra always picks `[0]` today.
  A future change can walk the array if `[0].cli` is not on PATH.
- The `assignment.runs[]` → `node_dispatched`-with-attempt connection in
  the ledger — currently we emit `assignment_retried` and `node_dispatched
  cause=system_retry` separately, the audit log reader has to chain them
  by `node_id` + timestamp. A `correlation_id` could make this explicit
  if scanning becomes painful at scale.
- e2e validation in a real termcanvas environment.
- `agent/src/tool.ts` zod errors.
- The `sub-agent → worker` / `workflow → mission` renames.

---

## TL;DR for the next session

You (the new session) need to implement a **role registry** for Hydra. The design has been fully decided after extensive research across 10 coding-agent products and 4 CLI flag surveys. Don't redo the research — read this document, confirm the design with the user if they want, and start implementation at the 10-step plan in §3.

The biggest realization from this session: **Hydra's "sub-agents" are not subagents in the Claude Code / Gemini CLI sense**. They are real, independent CLI processes (full claude/codex agents). The role file is therefore an **agent invocation profile**, not a "subagent persona definition." This reframing changes how the file format and the dispatch CLI work — see §2.

---

## 1. Where Hydra is right now

### Already done in this session (committed and pushed)

- `c1fe0dd` — docs(hydra): document slim result.json + report.md contract
- `b2bf794` — refactor(hydra): adopt slim result + wire resume session_id
- `ed2c7d7` — feat(headless): pass resumeSessionId through terminal launch path
- `f21b1eb` — refactor(cli): rewrite termcanvas workflow group for Lead-driven HTTP routes
- `4e5f4c3` — test(headless): rewrite workflow control + CLI tests for Lead-driven flow

These finished the PR body's "what's left for the next session" TODO list. PR #126 should now be reviewable; it's mergeable=CLEAN with no failing CI (there's no CI gate for tests).

### Architectural facts to keep in mind

- **Hydra is the SWF/Cadence "decider pattern"** — confirmed by research. Lead = decider, `DecisionPoint` = decision task, `hydra watch` = `PollForDecisionTask`, `lead_terminal_id` = single-decider guard. Reference this in any new docs you write.
- Hydra sub-agents = **real OS processes** running full claude/codex CLIs with their own session, tools, compaction, etc. They are NOT in-process LLM context isolations.
- Result contract is slim v0.1: only `outcome` + `report_file` in `result.json`; everything else in `report.md`.
- File layout: `.hydra/workflows/{id}/{inputs,outputs,nodes/{nodeId},assignments/{id}/runs/{id}}/` plus `ledger.jsonl`.
- Append-only JSONL ledger records all events.
- Single Lead identity locked by `lead_terminal_id` + `ensureLeadCaller` guard.
- Resume session_id wired end-to-end (commit `b2bf794`), claude only.

---

## 2. The role registry design (FINAL — don't relitigate)

After multiple rounds of discussion the user agreed to this exact design. The user explicitly said they only want to support **claude + codex** for now, and only the **role body / persona** dimension first (no `tools`, no `max_turns`, no `permission_mode` etc. — those are explicitly deferred).

### File format

```yaml
---
name: claude-researcher
description: Deep codebase investigation with Opus-level reasoning, produces research brief.
agent_type: claude              # REQUIRED, locked, NOT overridable at dispatch
model: opus                     # OPTIONAL default, passed to CLI as --model
decision_rules:                 # OPTIONAL structured array
  - Read user-request.md before forming any architecture conclusion.
  - Investigate the current codebase instead of restating the task.
acceptance_criteria:            # OPTIONAL structured array
  - Produce a research brief grounded in the current codebase.
  - Call out structural blockers, unknowns, and verification focus.
---

For this task, you are additionally playing a **researcher** role.
Your focus is producing an actionable research brief grounded in the
current codebase. Start from user-request.md, then confirm how the
codebase changes the real problem...
```

### Critical design decisions (don't change without user approval)

1. **`agent_type` is REQUIRED in frontmatter**, not a default. Loader fails fast if missing.
2. **No `--agent-type` flag at `hydra dispatch`**. Role determines CLI. Lead picks the right role. `hydra dispatch <wf> --role claude-researcher --intent "..."` is the only form.
3. **Role body is ADDITIVE BRIEFING**, not REPLACEMENT. Write "For this task, you are additionally playing X" — never "You are X." This respects the CLI's built-in persona (claude/codex have their own system prompts).
4. **Role body is prepended to `task.md` as a `## Role` section**, NOT passed via CLI's `--system-prompt-file` flag. Reasons: Codex has no equivalent flag (only `experimental_instructions_file` which REPLACES instead of appends), and uniform behavior across CLIs is more important than using each CLI's "native" mechanism.
5. **Only `--model` flag needs `CLI_LAUNCH` wiring**. Both claude and codex support it. Everything else goes through `task.md`.
6. **`decision_rules` and `acceptance_criteria` are frontmatter array fields**, not body content. They populate task.md's structured sections (existing Hydra task.md structure already has these sections via `task-spec-builder.ts`).
7. **Portability is at the WORKFLOW level, not the role level**. A workflow can mix roles from claude and codex (e.g., research on claude, implementation on codex, review on claude). Roles themselves are CLI-locked.
8. **Drop the `compatible_agents` hint field** I had earlier proposed. Each role pins to one CLI; no portability hint needed.

### File locations and fallback chain

```
Project: .hydra/roles/<name>.md
User:    ~/.hydra/roles/<name>.md
Builtin: hydra/src/roles/builtin/<name>.md  (shipped with Hydra)
```

Fallback order: project → user → builtin. Same as Claude Code's scope priority.

### Naming convention for builtin roles

`<agent_type>-<concept>` recommended, e.g., `claude-researcher`, `codex-implementer`. This makes `ls` filtering easy and reads naturally. **Not enforced** for user roles — `name` field in frontmatter is canonical.

### `CLI_LAUNCH` becomes an adapter layer

Currently `headless-runtime/terminal-launch.ts:13` `CLI_LAUNCH` is a flat record. Upgrade it to an adapter pattern with capability queries:

```ts
interface CliAdapter {
  shell: string;
  // capability queries
  supportsModel(): boolean;
  // args builders (return [] when not applicable)
  autoApproveArgs(): string[];
  resumeArgs(sessionId: string): string[];
  modelArgs(model: string): string[];
}
```

The validation flow at dispatch time: load role → check `CLI_LAUNCH[role.agent_type]` exists → if role declares `model`, check `adapter.supportsModel()` → fail fast if mismatch.

For now both claude and codex `supportsModel() === true`, so the check is currently always green, but make it future-proof.

---

## 3. Implementation plan (10 steps, ~7 hours total)

| # | Step | File | Time |
|---|------|------|------|
| 1 | Create `hydra/src/roles/loader.ts` — read `.md` + parse YAML frontmatter + 3-level fallback chain | new file | 45 min |
| 2 | Create 8 builtin role files in `hydra/src/roles/builtin/`: `claude-researcher.md`, `claude-implementer.md`, `claude-tester.md`, `claude-reviewer.md`, `codex-*` (4 same). Extract content from current `task-spec-builder.ts:34-128` `getRoleDefaults()` | 8 new files | 1.5h |
| 3 | Rewrite `hydra/src/task-spec-builder.ts` `getRoleDefaults()` → load via role registry instead of hardcoded switch | edit | 45 min |
| 4 | `hydra/src/run-task.ts` `renderRunTask()` add `## Role` section at top with role body content | edit | 20 min |
| 5 | `hydra/src/workflow-store.ts` `WorkflowNode` schema add `model?: string`. `hydra/src/workflow-lead.ts` `DispatchNodeOptions` REMOVE `agentType` field (now derived from role). `dispatchNode()` reads agent_type from loaded role. | edit | 30 min |
| 6 | `headless-runtime/terminal-launch.ts` `CLI_LAUNCH` claude/codex add `modelArgs: (model) => [...]`. `launchTrackedTerminal()` accept new `model?: string` parameter and inject into args via adapter. | edit | 45 min |
| 7 | `hydra/src/dispatcher.ts` `DispatchCreateOnlyRequest` add `model?: string`. `hydra/src/workflow-lead.ts` `buildDispatchRequest()` pass `node.model`. `headless-runtime/workflow-control.ts` thread `request.model` to `launchTrackedTerminal`. | edit | 20 min |
| 8 | New `hydra list-roles` command: add `cliListRoles` in `hydra/src/cli-commands.ts`, register in `hydra/src/cli.ts`, add HTTP route in `headless-runtime/api-server.ts`, add agent tool action in `agent/src/tools/hydra-workflow.ts`. Output: name + agent_type + description, supports `--agent-type <t>` filter. | multi-file | 45 min |
| 9 | Tests: (a) loader 3-level fallback finds correct file (b) loader fails fast on missing required fields (c) task.md includes Role section with role body (d) `CLI_LAUNCH.modelArgs` generates `--model X` for claude and `-m X` for codex (e) `dispatchNode` uses role's `agent_type`, ignores any CLI-level override attempt (f) `hydra list-roles` filters by agent_type | new tests | 1.5h |
| 10 | `tsc --noEmit` clean + run existing tests to ensure no regressions | sanity | 15 min |

**Total: ~7 hours of focused work.**

---

## 4. Critical files to reference (don't search for them)

| File | What it does | Why you need it |
|---|---|---|
| `hydra/src/task-spec-builder.ts:24-128` | Current hardcoded `BRIEF_ROLES` set + `getRoleDefaults()` switch with 4 role defaults | This is what step 3 replaces |
| `hydra/src/run-task.ts:78+` | `renderRunTask()` builds task.md sections | Step 4 modifies this |
| `hydra/src/workflow-store.ts:36-57` | `WorkflowNode` schema | Step 5 adds `model?` field |
| `hydra/src/workflow-lead.ts:417-538` | `dispatchNode()` and surrounding | Step 5 changes how `agent_type` is derived |
| `hydra/src/workflow-lead.ts:262-296` | `buildDispatchRequest()` and `findResumableSessionId()` | Step 7 adds `model` to the request |
| `hydra/src/dispatcher.ts:8-46` | `DispatchCreateOnlyRequest` interface and `DispatcherDependencies` | Step 7 adds `model?` field |
| `headless-runtime/terminal-launch.ts:6-110` | `CliLaunchConfig`, `CLI_LAUNCH`, `launchTrackedTerminal` | Step 6 — this is the CLI adapter layer that needs upgrading |
| `headless-runtime/workflow-control.ts:116-153` | `dispatchCreateOnly()` thin wrapper | Step 7 — passes model through |
| `headless-runtime/api-server.ts:586-622` | `workflowInit` and `workflowDispatch` route handlers | Step 8 — adds `list-roles` route |
| `agent/src/tools/hydra-workflow.ts` | Agent tool with all `action` enum values | Step 8 — add `list-roles` action |
| `cli/termcanvas.ts:208-356` | termcanvas CLI workflow group (rewritten in commit `f21b1eb`) | Step 8 — pattern reference for adding new command |
| `hydra/src/cli-commands.ts` | Hydra CLI command implementations | Step 8 — adds `cliListRoles` |
| `hydra/src/cli.ts` | Top-level command dispatch in hydra binary | Step 8 — registers new command |

---

## 5. Things to watch out for

### Watch out 1: `task-spec-builder.ts` current logic must be REPLACED, not augmented

The current `getRoleDefaults()` switch at `hydra/src/task-spec-builder.ts:34-128` is for `researcher / implementer / tester / reviewer`. The user explicitly said hard cutover (no fallback to old hardcoded defaults). After step 2-3, this switch should be GONE, replaced by registry lookup.

### Watch out 2: `agent_type` removal from `DispatchNodeOptions` is a breaking API change

Currently `DispatchNodeOptions` has an optional `agentType` field. Removing it (or at least ignoring it in favor of role's agent_type) breaks the agent tool's `HydraWorkflow` action signature in `agent/src/tools/hydra-workflow.ts`. You need to update:
- The Zod schema (remove `agentType` from dispatch action)
- The HTTP route body parsing in `api-server.ts:603-622` `workflowDispatch`
- The CLI flag handling in `cli/termcanvas.ts` workflow dispatch command
- Any tests that pass `--agent-type` to dispatch

The user's call: hard cutover. No backwards compat shim.

### Watch out 3: The `model` field needs to flow through 5 layers

When a role declares `model: opus`, it needs to reach the spawned CLI process. The path is:
```
role file → loader → WorkflowNode.model → DispatchCreateOnlyRequest.model
  → workflow-control.dispatchCreateOnly → launchTrackedTerminal options
  → CLI_LAUNCH[type].modelArgs(model) → spawned CLI with --model X
```

Each of these 5 hops needs to be wired. Easy to miss a layer. Add a test that verifies the full path end-to-end with a dummy adapter.

### Watch out 4: Role body content guideline is a soft contract

Role body should be ADDITIVE ("For this task, you are additionally playing X"), not REPLACING ("You are X"). This is a writing convention. The 8 builtin role files in step 2 MUST follow this convention to set the example. If you write them as "You are a researcher" you're modeling bad usage and users will copy it.

### Watch out 5: Codex's `agent_type` test fixtures

Existing tests in `tests/headless-workflow-control.test.ts:166-190` and `tests/headless-cli-control.test.ts:122-160` (rewritten in commit `4e5f4c3`) currently use `--agent-type codex` or set `defaultAgentType: "codex"` at workflow init. After step 5 these tests need to be updated:
- `init` still takes `default_agent_type` (this is the workflow's default; not affected)
- `dispatch` no longer takes `--agent-type` — instead the role file's agent_type wins
- Tests should use `--role codex-implementer` or similar

The 4 builtin roles you create in step 2 will be used by these tests after the migration.

### Watch out 6: `task-spec-builder.ts` `BRIEF_ROLES` set is also referenced elsewhere

Grep for `BRIEF_ROLES` and `getRoleDefaults` before deleting them. Make sure you catch all callers.

### Watch out 7: Don't forget `hydra/scripts/e2e-acceptance.ts`

The e2e script (rewritten in commit `b2bf794` to use slim result) has hardcoded role names in its `dispatchNode` calls. After the role registry lands, those role names need to match builtin role files. Update the script.

---

## 6. Other Tier 1 items NOT YET DONE (still pending after role registry)

These were also identified as high-value low-cost in the same conversation but were sequenced after the role registry. Pick them up after step 10 if you have time.

### Tier 1 #2 — Declarative `RetryPolicy` per node (Temporal style)

Add to `WorkflowNode` schema:
```ts
retry_policy?: {
  initial_interval_ms?: number;
  backoff_coefficient?: number;       // default 2.0
  maximum_attempts?: number;          // replaces current max_retries
  non_retryable_error_codes?: string[];
};
```
Update `hydra/src/retry.ts` and `hydra/src/assignment/state-machine.ts` to honor it. ~1h.

### Tier 1 #3 — `stuck` typed sub-states (A2A inspired)

Add to `SubAgentResult` (`hydra/src/protocol.ts:15-23`):
```ts
stuck_reason?: "needs_clarification" | "needs_credentials" | "needs_context" | "blocked_technical";
```
Surface in `DecisionPoint.completed`. Update validator to accept the field. ~20 min.

### Tier 1 #4 — Event sourcing replay test

Write a test that:
1. Initializes workflow → dispatches node → writes result → watches → approves → completes
2. **Deletes** `workflow.json` and all `assignment.json` files
3. Rebuilds them by replaying `ledger.jsonl`
4. Deep-equal compares to original

If it fails, identifies which state is NOT in the ledger. Then either move that state into ledger events or document it as derived cache. Architectural validation. ~half day with possible follow-up fixes.

### Tier 1 #5 — Docs 打旗 (free, do anytime)

Add 4 statements to `CLAUDE.md` and/or `skills/skills/hydra/SKILL.md`:

1. "Hydra implements the SWF decider pattern, specialized for LLM deciders."
2. "Parallel-first, not bolted on" (Factory.ai's Droid docs explicitly say parallelization is open research; Hydra's `dispatch` + `depends_on` + worktree + `merge` are first-class).
3. "Typed result contract" (Amp/Droid/Claude Code subagents return free-text final messages; Hydra has schema validation).
4. "Lead intervention points" (other products are block-and-join; Hydra's `watch` + `reset --feedback` lets Lead actually intervene at decision points).

~30 min.

---

## 7. Naming debt — defer to a separate cleanup PR

Don't do these now, but record them to do together as a future "pre-release rename" PR:

1. `sub-agent` / `subagent` / `subAgent` → `worker` / `worker agent`
   - `SubAgentResult` → `WorkerResult` (in `protocol.ts`)
   - `SubAgentOutcome` → `WorkerOutcome`
   - `validateSubAgentResult` → `validateWorkerResult`
   - Documentation prose throughout
2. `workflow` → `mission` (already tracked in `.claude/projects/-workspace-project-termcanvas/memory/project_hydra_rename_pending.md`)

Bundle these two renames into one PR after schema is otherwise stable. The reason for the rename: Hydra's "sub-agents" are actually full independent CLI processes, not LLM context isolations like Claude Code's subagents. The name is misleading and pushes designs in the wrong direction (e.g., the role registry could have been over-engineered as a "subagent persona" if the user hadn't pushed back on this terminology).

---

## 8. Open questions for the new session to confirm with the user

Before starting implementation, confirm with the user:

1. **Build now or write design doc first?** The user offered both options at the end of the previous session. They might prefer a `docs/plans/2026-04-11-hydra-role-registry-design.md` first to lock the design, or they might prefer just doing it.
2. **Builtin role content quality**: should the 8 builtin files be near-duplicates of current hardcoded `getRoleDefaults()` content, or should they be tuned per-CLI from the start? Probably the former (faster to ship, can tune later).
3. **`hydra list-roles` output format**: human-readable table by default, `--json` for machine-readable. Confirm.
4. **Should `description` field be limited in length?** Droid limits to ≤500 chars. Consider adding the same constraint to make Lead's `list-roles` output not blow up.

---

## 9. Don't repeat the research

In this session we did 4 deep research surveys. **Do not redo them.** The findings are in the conversation context but if you need a refresher, the key points:

- **Survey 1** (Coding agents broad): Claude Code, Codex CLI, Gemini CLI, Qoder, Kimi, Cursor, LangGraph. Key finding: **Hydra is the SWF/Cadence decider pattern**. Claude Code's "agent teams" experimental mode is the closest cousin to Hydra (file-locked task list + mailbox + per-process teammates). 5 of 7 products use markdown+YAML frontmatter for role definitions with `description` as the routing key.
- **Survey 2** (Amp/Droid/Pi): Amp has pre-built specialty subagents (Search/Review/Librarian/Oracle); **Droid has the cleanest `tools` field with category-string expansion** (`read-only` → `[Read, LS, Grep, Glob]`); Pi (badlogic OSS, NOT Poolside) has typed turn-level RPC events; Factory.ai admits parallelization is open research.
- **Survey 3** (CLI flag survey): Claude `--model`, `--system-prompt[-file]`, `--append-system-prompt[-file]`, `--tools`, `--allowed-tools`, `--permission-mode`. Codex `-m`, `-c experimental_instructions_file=<path>` (replaces system prompt), `--sandbox`. Gemini `-m`, no system prompt flag (uses `GEMINI.md` file). Kimi `--model`, `--agent-file`. **Only `--model` is universal across all four.** Wall-clock timeout is parent-enforced for all CLIs.
- **Survey 4** (initial general multi-agent frameworks): AutoGen, CrewAI, MetaGPT, etc. Mostly irrelevant to Hydra; user said "you found projects I haven't heard of, the list was biased toward academic frameworks." Replaced by Survey 1.

**Don't go back to AutoGen/CrewAI/MetaGPT/smolagents/OpenHands.** The user explicitly said those are not real coding agent products and the architectural patterns don't transfer.

---

## 10. Memory updates already made in this session

The persistent memory at `/workspace/.claude/projects/-workspace-project-termcanvas/memory/` was updated this session:

- `project_hydra_dag_refactor.md` — updated to reflect that the original "remaining work" list is fully complete and added a list of subsequent improvements landed in this PR.

If you write any new memories, use the file-based memory system per the project conventions.

---

## 11. The user's communication style preferences (observed)

- Likes direct, opinion-based answers; doesn't like hedging or listicles
- Will push back on sloppy thinking (e.g., the "subagent" terminology critique that triggered the role reframing)
- Wants tradeoffs surfaced explicitly, even for decisions you recommend
- Prefers small focused commits by module
- Tolerates long technical explanations when they have substance, but rejects "academic survey" style
- Explicitly asks clarifying questions when uncertain — answer them, don't guess

---

## 12. End state if you successfully complete the role registry

After step 10, Hydra will have:

- `hydra/src/roles/loader.ts` — role registry loader with 3-level fallback
- `hydra/src/roles/builtin/{claude,codex}-{researcher,implementer,tester,reviewer}.md` — 8 builtin role files
- `hydra/src/task-spec-builder.ts` — refactored to use registry (no more hardcoded `getRoleDefaults`)
- `hydra/src/run-task.ts` — task.md now has `## Role` section at top
- `hydra/src/workflow-store.ts` — `WorkflowNode` has `model?: string` field
- `hydra/src/workflow-lead.ts` — `dispatchNode` reads agent_type from role, `buildDispatchRequest` passes model
- `hydra/src/dispatcher.ts` — `DispatchCreateOnlyRequest` has `model?: string`
- `headless-runtime/terminal-launch.ts` — `CLI_LAUNCH` adapter pattern with `modelArgs` for claude+codex
- `headless-runtime/workflow-control.ts` — threads `request.model` through to `launchTrackedTerminal`
- `headless-runtime/api-server.ts` — new `GET /workflow/list-roles` route (or similar)
- `cli/termcanvas.ts` — new `workflow list-roles` command
- `agent/src/tools/hydra-workflow.ts` — new `listRoles` action
- `hydra/src/cli-commands.ts` + `hydra/src/cli.ts` — new `hydra list-roles` command
- `hydra/scripts/e2e-acceptance.ts` — updated to use new role names
- Tests for all the above
- `tsc --noEmit` clean

That's the deliverable. After it's done, ask the user if they want to commit and push, and discuss next steps (Tier 1 #2, #3, #4, #5 are still on the table).

---

## End of handoff
