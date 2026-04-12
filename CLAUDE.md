# CLAUDE.md

## Project Overview
- Electron terminal app, primary stack: TypeScript. Use TypeScript for all new code unless otherwise specified.
- Primary languages: TypeScript (main), Python (secondary). Use TypeScript conventions unless working in a Python project. JSON config files are common.

## General Guidelines
- When the user suggests a specific approach or tool (e.g., 'use Hydra', 'use Codex CLI'), follow their suggestion directly instead of trying alternatives like curl or manual workarounds.

## Debugging
- If the user provides specific context (file, symptom, ruled-out causes), form a hypothesis first and verify it — do not scatter-shot.
- If the problem is unclear, systematically explore: read the relevant code paths, check git log for recent changes in the area, and form hypotheses as you go. Document what you've checked and ruled out before moving to the next theory.
- Before committing, run `tsc --noEmit` to catch type errors.

## Terminal / xterm Guidelines
- When debugging scroll, paste, or terminal rendering issues, check xterm's built-in mechanisms first before adding custom workarounds.
- Prefer removing custom scroll/paste code in favor of xterm's native behavior.

## GitHub Issues
- When creating issues, describe only the observed behavior and symptoms. Do not include code snippets, file paths, or implementation details in the issue body.
- Do not close or delete PRs/issues autonomously. If a PR has problems, fix it rather than closing it, unless the user explicitly asks to close.

## Release Process
- Before any release (version bump + publish), always verify CHANGELOG has an entry for the new version.
- The Release workflow is triggered by pushing a tag, not by pushing to main. After committing the version bump, create and push a tag: `git tag v<version> && git push origin v<version>`.
- Run the build and check for CI prerequisites before pushing.
- Ensure old processes are killed before verifying a new version.

## Hydra Orchestration Toolkit

Hydra is an orchestration toolkit. Lead holds system-level context and
dispatches dev/reviewer into isolated context windows. `result.json` is the
only completion evidence.

### Lead

Lead is the human's primary terminal. It holds the system picture (architecture,
module boundaries, dependencies) and dispatches dev/reviewer. Lead always reads
every report.md to keep its system understanding current. Lead never writes
code. For large changes (refactors, new modules, architectural shifts), Lead
uses subagents to research approaches before dispatching.

See `hydra/src/roles/builtin/lead.md` for the full role definition.

### Design rationale
- **SWF decider pattern.** `hydra watch` is `PollForDecisionTask`; `lead_terminal_id` enforces single-decider semantics.
- **Parallel-first.** `dispatch` + `depends_on` + worktree + `merge` are first-class.
- **Typed result contract.** Schema-validated `result.json` (`outcome: completed | stuck | error`).
- **Lead intervention points.** `hydra reset --feedback` for mid-flight course correction.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- An assignment run is only complete when `result.json` exists and passes schema validation.

Workflow patterns:
1. Do the task directly when it is simple, local, or clearly faster without workflow overhead.
2. Use Hydra for ambiguous, risky, parallel, or multi-step work:
   ```
   hydra init --intent "<task>" --repo .
   hydra dispatch --workflow W --node <id> --role <role> --intent "<desc>" --repo .
   hydra watch --workflow W --repo .
   # → DecisionPoint returned, decide next step
   hydra complete --workflow W --repo .
   ```
3. Use a direct isolated dev when only a single task is needed:
   `hydra spawn --task "<specific task>" --repo . [--worktree .]`

Agent launch rule:
- When dispatching Claude/Codex through TermCanvas CLI, start a fresh agent terminal with `termcanvas terminal create --prompt "..."`
- Do not use `termcanvas terminal input` for task dispatch; it is not a supported automation path

Workflow control:
- After dispatching nodes, always call `hydra watch`. It returns at decision points.
1. Watch until decision point: `hydra watch --workflow <workflowId> --repo .`
2. Inspect structured state: `hydra status --workflow <workflowId> --repo .`
3. Reset a node for rework: `hydra reset --workflow W --node N --feedback "..." --repo .`
4. Approve a node's output: `hydra approve --workflow W --node N --repo .`
5. Merge parallel branches: `hydra merge --workflow W --nodes A,B --repo .`
6. View event log: `hydra ledger --workflow <workflowId> --repo .`
7. Clean up: `hydra cleanup --workflow <workflowId> --repo .`

Telemetry polling:
1. Treat `hydra watch` as the main polling loop; do not infer progress from terminal prose alone.
2. Before deciding wait / retry / takeover, query:
   - `termcanvas telemetry get --workflow <workflowId> --repo .`
   - `termcanvas telemetry get --terminal <terminalId>`
   - `termcanvas telemetry events --terminal <terminalId> --limit 20`
3. Trust `derived_status` and `task_status` as the primary decision signals.

`result.json` must contain (slim, schema_version `hydra/result/v0.1`):
- `schema_version`, `workflow_id`, `assignment_id`, `run_id` (passthrough IDs)
- `outcome` (completed/stuck/error — Hydra routes on this)
- `report_file` (path to a `report.md` written alongside `result.json`)

All human-readable content (summary, outputs, evidence, reflection) lives in
`report.md`. Hydra rejects any extra fields in `result.json`. Write `report.md`
first, then publish `result.json` atomically as the final artifact of the run.

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly in the current agent.
