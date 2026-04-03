# Live Sessions & Session Replay Design

## Overview

Add session monitoring and replay to TermCanvas via a new "Sessions" tab in the right sidebar. Managed sessions (spawned by TermCanvas) use the existing hook + JSONL delta pipeline for real-time data. External sessions (standalone terminals) are discovered via JSONL directory scanning. Historical sessions can be replayed as a scrollable timeline with playback controls.

Prerequisite: fix the hook socket path to survive Electron restarts.

## 1. Socket Path Fix

**Problem**: Socket at `${tmpdir()}/termcanvas-{pid}.sock` breaks when Electron restarts — old sessions' `TERMCANVAS_SOCKET` env var points to a dead socket.

**Fix**:
- Change socket path to `${tmpdir()}/termcanvas.sock` (drop PID suffix).
- `HookReceiver.start()`: `unlink` existing socket before `listen`.
- `app.requestSingleInstanceLock()` already guarantees single instance — no multi-process race.
- Fallback: if `unlink` fails, fall back to `termcanvas-{pid}.sock` and log warning.
- Hook script `termcanvas-hook.mjs` unchanged — reads path from env var.

**Effect**: After Electron restart, old sessions reconnect on next hook invocation (within 253ms retry window).

## 2. Right Panel Tab System

**Current state**: `UsagePanel` is the sole right panel component. `canvasStore` has `rightPanelCollapsed: boolean` but no tab concept.

**Changes**:

### canvasStore additions
- `RightPanelTab = "usage" | "sessions"`
- `rightPanelActiveTab: RightPanelTab` (default: `"sessions"`)
- `setRightPanelActiveTab(tab: RightPanelTab)`

### New component: `RightPanel`
- Replaces `<UsagePanel />` in App.tsx.
- Renders tab switcher bar at top (icon tabs: chart = Usage, activity = Sessions).
- Renders `<UsagePanel />` or `<SessionsPanel />` based on active tab.
- Owns expand/collapse toggle (lifted from current UsagePanel).

### UsagePanel refactor
- Remove self-managed collapsed state — becomes a pure content component.

### Dimensions
- `RIGHT_PANEL_WIDTH` stays at 240px.

## 3. Live Sessions

### Data layer (Electron main process)

#### SessionScanner (`electron/session-scanner.ts`)
- Discovers all Claude/Codex sessions system-wide (including non-TermCanvas).
- Runs `find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -mmin -1440` every 10 seconds.
- For each file: `stat()` to check activity (written within last 60s = live).
- Reads JSONL tail via `parseSessionTelemetryLine()` to extract: session ID, project dir, last event type, token count.
- Outputs `ExternalSession[]`.

#### Managed sessions
- TelemetryService already tracks these via hooks + JSONL delta + process tree.
- New method `getManagedSessions(): ManagedSession[]` wraps per-terminal telemetry snapshots as session objects.

#### SessionAggregator
- Merges managed + external sessions, deduplicates by sessionId (managed takes priority).
- Pushes `sessions:list-changed` IPC to renderer on changes.

### UI layer (React)

#### useSessionStore (Zustand)
```typescript
interface SessionInfo {
  sessionId: string;
  projectDir: string;
  filePath: string;
  isLive: boolean;
  isManaged: boolean;
  status: "idle" | "generating" | "tool_running" | "turn_complete" | "error";
  currentTool?: string;
  startedAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  tokenTotal: number;
}
```
- `liveSessions: SessionInfo[]`
- `historySessions: SessionInfo[]`
- Subscribes to IPC `sessions:list-changed`.

#### SessionsPanel component
- **Top half — Live Sessions**: Card per session with status indicator dot, project name, current tool, duration.
  - Managed sessions: detailed status from hooks (tool_running, generating, etc.).
  - External sessions: basic status from JSONL tail.
- **Bottom half — History**: Time-sorted list of recent sessions. Each row: project name, timestamp, message count, token cost. Click → enter replay.

## 4. Session Replay

### Data layer (Electron main process)

#### Replay parser (in SessionScanner)
- `loadSessionForReplay(filePath): ReplayTimeline`
- Reads entire JSONL, parses each line via `parseSessionTelemetryLine()`.
- Builds `TimelineEvent[]`:

```typescript
interface TimelineEvent {
  index: number;
  timestamp: Date;
  type: "user_prompt" | "assistant_text" | "thinking" | "tool_use" | "tool_result" | "error";
  toolName?: string;
  filePath?: string;
  textPreview: string;    // first 200 chars
  tokenDelta?: number;
}
```

- Pre-computes `editIndices: Array<{index: number, filePath: string}>` for file activity tracking.

#### IPC
- `sessions:load-replay` → request
- `sessions:replay-loaded` → response with `ReplayTimeline`

### UI layer (React)

#### useSessionStore replay state
- `replayTimeline: ReplayTimeline | null`
- `replayCurrentIndex: number`
- `replayIsPlaying: boolean`
- `replaySpeed: number` (1/2/4/8)
- Actions: `loadReplay()`, `seekTo()`, `stepForward()`, `stepBackward()`, `togglePlayback()`, `setSpeed()`

#### Playback mechanism
- `setInterval` advances `replayCurrentIndex` based on real timestamp gaps between events.
- Interval = clamp(realTimeDelta / playbackSpeed, 50ms, 2000ms).
- Pure React-side logic.

#### SessionReplayView component
- **Top**: Back button + session meta (project, time, total tokens).
- **Middle**: Timeline list (vertical scroll, 240px wide).
  - One row per event: type icon + short description + timestamp.
  - Current position highlighted, auto-scroll follows.
  - Tool events show tool name + target file.
  - Click any event → seekTo.
- **Bottom**: Playback control bar (fixed).
  - Draggable progress bar.
  - ⏮ ◀ ⏸/▶ ▶ ⏭ buttons.
  - Speed selector: 1x / 2x / 4x / 8x.
  - Position indicator: current / total.

#### Panel state
- SessionsPanel switches between `"list"` and `"replay"` views.
- Click history session → `"replay"` + `loadReplay()`.
- Click back → `"list"`.

## 5. Error Handling

| Scenario | Behavior |
|----------|----------|
| Socket unlink fails | Fallback to PID-based path, log warning |
| SessionScanner find timeout (>5s) | Skip scan, retry next 10s cycle |
| JSONL read failure (permission, deleted) | Skip that session, continue others |
| parseSessionTelemetryLine fails | Skip line, continue |
| Replay large file (>10MB) | Load fully, batch-render timeline with requestIdleCallback |
| Replay file deleted during playback | Keep loaded data, show "file removed" notice |
| Managed session exits | TelemetryService onExit handles it, isLive → false, moves to history |
| External session inactive >60s | isLive → false, moves to history |
| Tab switch during replay | Replay state preserved in useSessionStore, restored on return |

## File Changes Summary

### New files
- `electron/session-scanner.ts` — session discovery + replay parser
- `src/stores/sessionStore.ts` — Zustand store for sessions + replay state
- `src/components/RightPanel.tsx` — tab container
- `src/components/SessionsPanel.tsx` — live sessions + history list
- `src/components/SessionReplayView.tsx` — replay timeline + controls

### Modified files
- `electron/hook-receiver.ts` — fixed socket path
- `electron/main.ts` — initialize SessionScanner, wire IPC
- `electron/preload.ts` — expose session IPC to renderer
- `electron/telemetry-service.ts` — add getManagedSessions()
- `src/stores/canvasStore.ts` — add RightPanelTab, rightPanelActiveTab
- `src/components/UsagePanel.tsx` — remove self-managed collapse logic
- `src/App.tsx` — replace UsagePanel with RightPanel
