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

## Hydra Sub-Agent Tool

Classify the task before choosing a mode. Hydra is for file-driven
orchestration, not the default path for every change.
Hydra treats `result.json` + `done` as the only completion evidence.
Terminal conversation is not a source of truth.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- A handoff is only complete when both `result.json` and `done` exist and pass schema validation.

Workflow patterns:
1. Do the task directly when it is simple, local, or clearly faster without workflow overhead.
2. Use a single implementer workflow when you still want Hydra evidence and retry control:
   `hydra run --task "<specific task>" --repo . --template single-step [--worktree .]`
3. Use the default planner -> implementer -> evaluator workflow for ambiguous, risky, or PRD-driven work:
   `hydra run --task "<specific task>" --repo . [--worktree .]`
   - If the user says all roles should use one provider, pass `--all-type <provider>`.
   - If the user wants a mix, pass `--planner-type`, `--implementer-type`, and `--evaluator-type`.
   - If the user does not specify providers, Hydra should prefer the current terminal's provider when available.
4. Use a direct isolated worker primitive when the split is already known and you do not need a full workflow:
   `hydra spawn --task "<specific task>" --repo . [--worktree .]`

Agent launch rule:
- When dispatching Claude/Codex through TermCanvas CLI, start a fresh agent terminal with `termcanvas terminal create --prompt "..."`
- Do not use `termcanvas terminal input` for task dispatch; it is not a supported automation path

Workflow control:
- After `hydra run` or `hydra spawn`, immediately start polling with `hydra watch`. Do not ask whether to watch — always watch.
1. Inspect one-shot progress: `hydra tick --repo . --workflow <workflowId>`
2. Watch until terminal state: `hydra watch --repo . --workflow <workflowId>`
3. Inspect structured state and failures: `hydra status --repo . --workflow <workflowId>`
4. Retry a failed/timed-out workflow when allowed: `hydra retry --repo . --workflow <workflowId>`
5. Clean up runtime state or worktrees: `hydra cleanup --workflow <workflowId> --repo .`

Telemetry polling:
1. Treat `hydra watch` as the main-brain polling loop; do not infer progress from terminal prose alone.
2. Before deciding wait / retry / takeover, query:
   - `termcanvas telemetry get --workflow <workflowId> --repo .`
   - `termcanvas telemetry get --terminal <terminalId>`
   - `termcanvas telemetry events --terminal <terminalId> --limit 20`
3. Keep waiting when telemetry shows recent meaningful progress, `thinking`, `tool_running`, `tool_pending`, or a foreground tool.
4. Treat `awaiting_contract` as "turn complete, file contract still pending".
5. Treat `stall_candidate` as "investigate before retry", not automatic failure.
6. Treat `error` as "agent hit an API error". Check `last_hook_error`: `rate_limit`/`server_error` → wait and retry; `billing_error`/`authentication_failed` → stop; `max_output_tokens` → retry with compact; `invalid_request` → stop and investigate.

Worker control:
1. List direct workers: `hydra list --repo .`
2. Clean up a direct worker: `hydra cleanup <agentId>`

`result.json` must contain:
- `success`
- `summary`
- `outputs[]`
- `evidence[]`
- `next_action`

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly in the current agent.