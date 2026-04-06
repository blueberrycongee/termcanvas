# Codex CLI Hook Injection Design

## Problem

When the main-brain agent dispatches tasks to Codex sub-agents via Hydra,
it sometimes misjudges the sub-agent as stalled and takes over prematurely,
even though the sub-agent is still actively working. The root cause is that
TermCanvas lacks a direct, high-confidence signal channel from Codex CLI —
it relies solely on passive JSONL session file parsing, which has latency
and coverage gaps.

## Solution

Inject lifecycle hooks into Codex CLI (mirroring the existing Claude Code
hook integration) so that TermCanvas receives real-time, structured events
via Unix socket whenever Codex starts a session, begins/ends a tool call,
receives a user prompt, or stops.

## Architecture

```
Codex CLI process
  │  (hook fires on PreToolUse/PostToolUse/SessionStart/Stop/UserPromptSubmit)
  │
  ▼
termcanvas-hook.mjs          ← same script used by Claude Code
  │  reads stdin JSON, forwards to TERMCANVAS_SOCKET
  ▼
HookReceiver (Unix socket)   ← already exists, no changes
  │
  ▼
TelemetryService.recordHookEvent()  ← minor adaptation for provider detection
  │
  ▼
Telemetry snapshot (active_tool_calls, turn_state, etc.)
```

## Codex Hook Input JSON (from source)

All events share: `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
`model`, `permission_mode`. Codex adds `turn_id` to all turn-scoped events.

| Event | Extra fields |
|---|---|
| SessionStart | `source` ("startup" / "resume") |
| PreToolUse | `turn_id`, `tool_name` (always "Bash"), `tool_input` ({command}), `tool_use_id` |
| PostToolUse | `turn_id`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id` |
| Stop | `turn_id`, `stop_hook_active`, `last_assistant_message` |
| UserPromptSubmit | `turn_id`, `prompt` |

Codex input is a **superset** of Claude Code input. No field conflicts.

## Changes Required

### 1. `electron/skill-manager.ts` — new functions

- `ensureCodexHooks(scriptPath)`: write `~/.codex/hooks.json`
- `ensureCodexFeatureFlag()`: merge `codex_hooks = true` into `~/.codex/config.toml`
- `removeCodexHooks()`: clean up hooks.json TermCanvas entries on uninstall
- Called from `installSkillLinks` / `ensureSkillLinks` / `uninstallSkillLinks`

### 2. `~/.codex/hooks.json` format

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node '<scriptPath>'", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node '<scriptPath>'", "timeout": 5 }] }],
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node '<scriptPath>'", "timeout": 5 }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node '<scriptPath>'", "timeout": 5 }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node '<scriptPath>'", "timeout": 5 }] }]
  }
}
```

### 3. `~/.codex/config.toml` feature flag

```toml
[features]
codex_hooks = true
```

Safe merge: parse existing TOML, set key, write back. Do not remove on
uninstall (user may have their own hooks).

### 4. `electron/main.ts` — env var injection

Already handled: `pty-launch.ts:437` injects `TERMCANVAS_TERMINAL_ID` when
`options.terminalId` is set. No changes needed.

### 5. `electron/telemetry-service.ts` — provider detection

In `recordHookEvent` SessionStart branch, read provider from
`state.snapshot.provider` instead of hardcoding `"claude"`.

### 6. Tests

- Unit: `ensureCodexHooks` produces valid hooks.json
- Unit: `ensureCodexFeatureFlag` merges config.toml correctly
- Integration: Codex terminal hook events reach HookReceiver

## What does NOT change

- `termcanvas-hook.mjs` — pure JSON pipe, CLI-agnostic
- `hook-receiver.ts` — generic socket server
- `session-watcher.ts` — JSONL parsing stays as fallback layer

## Signal priority (unchanged from current design)

1. Hook events (hard evidence) — highest confidence
2. active_tool_calls count
3. turn_state from session events
4. session_heartbeat
5. pty_alive — lowest confidence
