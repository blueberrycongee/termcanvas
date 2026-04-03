# Live Sessions & Session Replay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add session monitoring and replay to TermCanvas's right sidebar — live session status, history list, and timeline replay with playback controls.

**Architecture:** Extend existing TelemetryService for managed sessions (hooks + JSONL delta). New SessionScanner for external session discovery via JSONL directory scanning. Right sidebar gains a tab system (Usage | Sessions). Replay parses full JSONL into a timeline with setInterval-driven playback.

**Tech Stack:** TypeScript, Electron IPC, Zustand, React, existing `parseSessionTelemetryLine()` parser.

---

### Task 1: Fix Hook Socket Path

**Files:**
- Modify: `electron/hook-receiver.ts:43` (socket path generation)

**Step 1: Change socket path to stable name**

In `electron/hook-receiver.ts`, line 43, change:

```typescript
// Before:
const socketPath = `${os.tmpdir()}/termcanvas-${process.pid}.sock`;

// After:
let socketPath = `${os.tmpdir()}/termcanvas.sock`;
```

Add fallback after the existing `unlinkSync` block (lines 46-50):

```typescript
try {
  fs.unlinkSync(socketPath);
} catch {
  // No stale socket — fine
}

// Start server... (existing code follows)
```

No other changes needed — `unlinkSync` already handles cleanup, and `app.requestSingleInstanceLock()` in `electron/main.ts:71` prevents multi-instance races.

**Step 2: Verify**

Run: `tsc --noEmit`

**Step 3: Manual test**

1. Start Electron dev: `npm run dev`
2. Check socket exists: `ls /var/folders/*/T/termcanvas.sock` (or `ls $TMPDIR/termcanvas.sock`)
3. Send test event: `echo '{"hook_event_name":"test","terminal_id":"t1"}' | nc -U $TMPDIR/termcanvas.sock`
4. Restart Electron, verify new socket at same path

**Step 4: Commit**

```bash
git add electron/hook-receiver.ts
git commit -m "fix: use stable socket path for hook receiver

Removes PID from socket name so old sessions reconnect
after Electron restarts."
```

---

### Task 2: Add Right Panel Tab State to canvasStore

**Files:**
- Modify: `src/stores/canvasStore.ts:6,16-39,67-74,102`

**Step 1: Add types and state**

At line 6, after `LeftPanelTab`:

```typescript
export type RightPanelTab = "usage" | "sessions";
```

In the `CanvasStore` interface (after line 20 `rightPanelCollapsed`), add:

```typescript
rightPanelActiveTab: RightPanelTab;
```

In the interface methods section (after line 33 `setRightPanelCollapsed`), add:

```typescript
setRightPanelActiveTab: (tab: RightPanelTab) => void;
```

In the store initial state (after line 71 `rightPanelCollapsed: true`), add:

```typescript
rightPanelActiveTab: "sessions" as RightPanelTab,
```

In the store actions (after line 102 `setRightPanelCollapsed`), add:

```typescript
setRightPanelActiveTab: (tab) => set({ rightPanelActiveTab: tab }),
```

**Step 2: Verify**

Run: `tsc --noEmit`

**Step 3: Commit**

```bash
git add src/stores/canvasStore.ts
git commit -m "feat: add right panel tab state (usage | sessions)"
```

---

### Task 3: Create RightPanel Component

**Files:**
- Create: `src/components/RightPanel.tsx`
- Modify: `src/App.tsx:579` (replace `<UsagePanel />` with `<RightPanel />`)
- Modify: `src/components/UsagePanel.tsx:463-597` (remove collapse logic, accept props)

**Step 1: Create RightPanel**

Create `src/components/RightPanel.tsx`:

```tsx
import { useCanvasStore, COLLAPSED_TAB_WIDTH, RIGHT_PANEL_WIDTH } from "../stores/canvasStore";
import type { RightPanelTab } from "../stores/canvasStore";
import { UsagePanel } from "./UsagePanel";

const TABS: { id: RightPanelTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "sessions",
    label: "Sessions",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="4" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7.5 4.5h4M7.5 7h3M7.5 9.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "usage",
    label: "Usage",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="3" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="5.5" y="5" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="9.5" y="1" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

export function RightPanel() {
  const collapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const setCollapsed = useCanvasStore((s) => s.setRightPanelCollapsed);
  const activeTab = useCanvasStore((s) => s.rightPanelActiveTab);
  const setActiveTab = useCanvasStore((s) => s.setRightPanelActiveTab);

  return (
    <div className="fixed right-0 z-40 flex" style={{ top: 44, height: "calc(100vh - 44px)" }}>
      {/* Collapsed tab strip */}
      <div
        className="shrink-0 flex flex-col items-center pt-2 gap-1 bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)]"
        style={{
          width: collapsed ? COLLAPSED_TAB_WIDTH : 0,
          transition: "width 0.2s ease",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`flex flex-col items-center py-2 px-1 rounded cursor-pointer hover:bg-[var(--sidebar-hover)] ${
              activeTab === tab.id ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
            }`}
            onClick={() => {
              setActiveTab(tab.id);
              setCollapsed(false);
            }}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Expanded panel */}
      <div
        className="shrink-0 flex flex-col bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)]"
        style={{
          width: collapsed ? 0 : RIGHT_PANEL_WIDTH,
          transition: "width 0.2s ease",
        }}
      >
        {/* Tab bar */}
        <div className="shrink-0 flex items-center border-b border-[var(--border)] h-[34px]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 flex items-center justify-center gap-1.5 h-full text-[10px] uppercase tracking-wider cursor-pointer border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-[var(--accent)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              onClick={() => setActiveTab(tab.id)}
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          <button
            className="shrink-0 px-2 h-full text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            onClick={() => setCollapsed(true)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {activeTab === "usage" && <UsagePanel />}
          {activeTab === "sessions" && (
            <div className="px-3 py-4 text-[11px] text-[var(--text-faint)]">
              Sessions (coming soon)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Refactor UsagePanel — remove collapse/expand shell**

In `src/components/UsagePanel.tsx`, the `UsagePanel` function (starting at line 463):

1. Remove the lines that read `rightPanelCollapsed` and `setRightPanelCollapsed` from canvasStore (lines 465-468). Instead use a simple local `collapsed = false` equivalent — actually, the component now always renders when visible, so just remove the collapsed-dependent early return / outer shell.

2. Remove the outer `<div className="fixed right-0 ...">` wrapper (line 576), the collapsed tab `<button>` (lines 578-597), and the expanded panel `<div>` with width transition (lines 600-605).

3. Keep only the inner content starting from the DateNavigator (line 608) downward. Wrap it in a simple `<div className="flex flex-col h-full">`.

4. The `useEffect` that checks `if (collapsed) return;` (line 494-495) — remove the collapsed guard. Instead, the RightPanel parent only mounts UsagePanel when it's the active tab, so data fetching can run unconditionally when mounted.

**Step 3: Update App.tsx**

In `src/App.tsx:579`, replace:
```tsx
<UsagePanel />
```
with:
```tsx
<RightPanel />
```

Add the import at the top:
```tsx
import { RightPanel } from "./components/RightPanel";
```

Remove the old import:
```tsx
import { UsagePanel } from "./components/UsagePanel";
```

**Step 4: Verify**

Run: `tsc --noEmit`
Run: `npm run dev` — verify right panel shows two tabs, Usage tab works as before, Sessions tab shows placeholder.

**Step 5: Commit**

```bash
git add src/components/RightPanel.tsx src/components/UsagePanel.tsx src/App.tsx
git commit -m "feat: add right panel tab system with Usage and Sessions tabs"
```

---

### Task 4: Session Scanner — Data Layer

**Files:**
- Create: `electron/session-scanner.ts`
- Create: `shared/sessions.ts` (shared types)
- Modify: `electron/main.ts` (initialize scanner, wire IPC)
- Modify: `electron/preload.ts` (expose IPC)

**Step 1: Create shared types**

Create `shared/sessions.ts`:

```typescript
export interface SessionInfo {
  sessionId: string;
  projectDir: string;
  filePath: string;
  isLive: boolean;
  isManaged: boolean;
  status: "idle" | "generating" | "tool_running" | "turn_complete" | "error";
  currentTool?: string;
  startedAt: string;       // ISO string (serializable over IPC)
  lastActivityAt: string;  // ISO string
  messageCount: number;
  tokenTotal: number;
}

export interface TimelineEvent {
  index: number;
  timestamp: string;       // ISO string
  type: "user_prompt" | "assistant_text" | "thinking" | "tool_use" | "tool_result" | "turn_complete" | "error";
  toolName?: string;
  filePath?: string;
  textPreview: string;
  tokenDelta?: number;
}

export interface ReplayTimeline {
  sessionId: string;
  projectDir: string;
  filePath: string;
  events: TimelineEvent[];
  editIndices: Array<{ index: number; filePath: string }>;
  totalTokens: number;
  startedAt: string;
  endedAt: string;
}
```

**Step 2: Create SessionScanner**

Create `electron/session-scanner.ts`:

```typescript
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseSessionTelemetryLine, type SessionType } from "./session-watcher.ts";
import type { SessionInfo, TimelineEvent, ReplayTimeline } from "../shared/sessions.ts";

const SCAN_INTERVAL = 10_000;
const LIVE_THRESHOLD_MS = 60_000;
const FIND_TIMEOUT_MS = 5_000;
const TAIL_BYTES = 65536;

export class SessionScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sessions: SessionInfo[] = [];
  private onChange: ((sessions: SessionInfo[]) => void) | null = null;

  start(onChange: (sessions: SessionInfo[]) => void): void {
    this.onChange = onChange;
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSessions(): SessionInfo[] {
    return this.sessions;
  }

  private scan(): void {
    const claudeDir = path.join(os.homedir(), ".claude", "projects");

    execFile(
      "find",
      [claudeDir, "-maxdepth", "2", "-name", "*.jsonl", "-mmin", "-1440"],
      { timeout: FIND_TIMEOUT_MS },
      (err, stdout) => {
        if (err) return; // skip this cycle

        const files = stdout.trim().split("\n").filter(Boolean);
        const now = Date.now();
        const results: SessionInfo[] = [];

        for (const filePath of files) {
          try {
            const stat = fs.statSync(filePath);
            const isLive = now - stat.mtimeMs < LIVE_THRESHOLD_MS;
            const sessionId = path.basename(filePath, ".jsonl");
            const projectKey = path.basename(path.dirname(filePath));

            const tail = this.readTail(filePath, stat.size);
            const parsed = this.parseTail(tail);

            results.push({
              sessionId,
              projectDir: projectKey,
              filePath,
              isLive,
              isManaged: false,
              status: parsed.status,
              currentTool: parsed.currentTool,
              startedAt: new Date(stat.birthtimeMs).toISOString(),
              lastActivityAt: new Date(stat.mtimeMs).toISOString(),
              messageCount: parsed.messageCount,
              tokenTotal: parsed.tokenTotal,
            });
          } catch {
            // skip unreadable files
          }
        }

        results.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
        this.sessions = results;
        this.onChange?.(results);
      },
    );
  }

  private readTail(filePath: string, fileSize: number): string {
    const start = Math.max(0, fileSize - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(TAIL_BYTES, fileSize));
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  }

  private parseTail(tail: string): {
    status: SessionInfo["status"];
    currentTool?: string;
    messageCount: number;
    tokenTotal: number;
  } {
    const lines = tail.split("\n").filter(Boolean);
    let messageCount = 0;
    let tokenTotal = 0;
    let status: SessionInfo["status"] = "idle";
    let currentTool: string | undefined;

    for (const line of lines) {
      const events = parseSessionTelemetryLine(line, "claude");
      for (const ev of events) {
        messageCount++;
        if (ev.token_total) tokenTotal = ev.token_total;
        if (ev.turn_state === "tool_running") {
          status = "tool_running";
          currentTool = ev.tool_name;
        } else if (ev.turn_state === "thinking" || ev.turn_state === "in_turn") {
          status = "generating";
        } else if (ev.turn_state === "turn_complete") {
          status = "turn_complete";
          currentTool = undefined;
        }
      }
    }
    return { status, currentTool, messageCount, tokenTotal };
  }

  async loadReplay(filePath: string): Promise<ReplayTimeline> {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const sessionId = path.basename(filePath, ".jsonl");
    const projectDir = path.basename(path.dirname(filePath));

    const type: SessionType = filePath.includes(".codex") ? "codex" : "claude";
    const events: TimelineEvent[] = [];
    const editIndices: Array<{ index: number; filePath: string }> = [];
    let totalTokens = 0;

    for (const line of lines) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString();
      const parsed = parseSessionTelemetryLine(line, type);

      for (const ev of parsed) {
        const timelineType = this.mapEventType(ev.event_type);
        if (!timelineType) continue;

        const textPreview = this.extractPreview(raw, ev.event_type);
        const toolFilePath = this.extractToolFilePath(raw, ev.tool_name);

        if (ev.token_total) totalTokens = ev.token_total;

        const idx = events.length;
        events.push({
          index: idx,
          timestamp: ev.at ?? timestamp,
          type: timelineType,
          toolName: ev.tool_name,
          filePath: toolFilePath,
          textPreview,
          tokenDelta: ev.token_total,
        });

        if (toolFilePath && (ev.tool_name === "Edit" || ev.tool_name === "Write")) {
          editIndices.push({ index: idx, filePath: toolFilePath });
        }
      }
    }

    return {
      sessionId,
      projectDir,
      filePath,
      events,
      editIndices,
      totalTokens,
      startedAt: events[0]?.timestamp ?? "",
      endedAt: events[events.length - 1]?.timestamp ?? "",
    };
  }

  private mapEventType(eventType: string): TimelineEvent["type"] | null {
    switch (eventType) {
      case "thinking": return "thinking";
      case "tool_use": return "tool_use";
      case "tool_result": return "tool_result";
      case "assistant_message": return "assistant_text";
      case "turn_complete": return "turn_complete";
      case "assistant_stop": return null;
      case "queue_operation": return null;
      case "progress": return null;
      default: return null;
    }
  }

  private extractPreview(raw: Record<string, unknown>, eventType: string): string {
    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) return "";
    const content = message.content;
    if (typeof content === "string") return content.slice(0, 200);
    if (!Array.isArray(content)) return "";
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (typeof entry.text === "string") return entry.text.slice(0, 200);
      if (typeof entry.thinking === "string") return entry.thinking.slice(0, 200);
      if (typeof entry.input === "object" && entry.input) {
        const input = entry.input as Record<string, unknown>;
        if (typeof input.command === "string") return `$ ${input.command.slice(0, 180)}`;
        if (typeof input.file_path === "string") return input.file_path;
      }
    }
    return "";
  }

  private extractToolFilePath(raw: Record<string, unknown>, toolName?: string): string | undefined {
    if (!toolName || !["Edit", "Write", "Read", "Glob", "Grep"].includes(toolName)) return undefined;
    const message = raw.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message!.content : [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (entry.type === "tool_use" && typeof entry.input === "object" && entry.input) {
        const input = entry.input as Record<string, unknown>;
        if (typeof input.file_path === "string") return input.file_path;
        if (typeof input.path === "string") return input.path;
      }
    }
    return undefined;
  }
}
```

**Step 3: Wire IPC in main.ts**

In `electron/main.ts`, after the TelemetryService initialization:

```typescript
import { SessionScanner } from "./session-scanner.ts";

// Near other service declarations:
const sessionScanner = new SessionScanner();

// In the app.whenReady() block, after hookReceiver.start():
sessionScanner.start((sessions) => {
  // Merge with managed sessions from telemetryService
  const managed = telemetryService.getManagedSessions();
  const managedIds = new Set(managed.map((s) => s.sessionId));
  const external = sessions.filter((s) => !managedIds.has(s.sessionId));
  const merged = [...managed, ...external].sort(
    (a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
  sendToWindow(mainWindow, "sessions:list-changed", merged);
});

// IPC handler for replay:
ipcMain.handle("sessions:load-replay", async (_event, filePath: string) => {
  return sessionScanner.loadReplay(filePath);
});
```

**Step 4: Add `getManagedSessions()` to TelemetryService**

In `electron/telemetry-service.ts`, add a public method that iterates over tracked terminals and returns `SessionInfo[]`:

```typescript
import type { SessionInfo } from "../shared/sessions.ts";

getManagedSessions(): SessionInfo[] {
  const results: SessionInfo[] = [];
  for (const [terminalId, state] of this.terminals) {
    const snap = state.snapshot;
    if (!snap.session_id || !snap.session_file) continue;
    results.push({
      sessionId: snap.session_id,
      projectDir: snap.worktree_path,
      filePath: snap.session_file,
      isLive: snap.pty_alive,
      isManaged: true,
      status: this.mapTurnState(snap.turn_state, snap.derived_status),
      currentTool: snap.foreground_tool,
      startedAt: state.registeredAt ?? new Date().toISOString(),
      lastActivityAt: snap.last_meaningful_progress_at ?? new Date().toISOString(),
      messageCount: state.sessionEventCount ?? 0,
      tokenTotal: state.tokenTotal ?? 0,
    });
  }
  return results;
}

private mapTurnState(
  turn: TelemetryTurnState,
  derived: TelemetryDerivedStatus,
): SessionInfo["status"] {
  if (derived === "error") return "error";
  if (turn === "tool_running" || turn === "tool_pending") return "tool_running";
  if (turn === "thinking" || turn === "in_turn") return "generating";
  if (turn === "turn_complete") return "turn_complete";
  return "idle";
}
```

Note: You'll need to check the actual `this.terminals` Map structure in telemetry-service.ts — adapt the property names to match the existing internal state type.

**Step 5: Expose in preload.ts**

In `electron/preload.ts`, add to the `contextBridge.exposeInMainWorld` object:

```typescript
sessions: {
  onListChanged: (callback: (sessions: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sessions: unknown[]) => callback(sessions);
    ipcRenderer.on("sessions:list-changed", listener);
    return () => ipcRenderer.removeListener("sessions:list-changed", listener);
  },
  loadReplay: (filePath: string) => ipcRenderer.invoke("sessions:load-replay", filePath),
},
```

**Step 6: Verify**

Run: `tsc --noEmit`

**Step 7: Commit**

```bash
git add shared/sessions.ts electron/session-scanner.ts electron/main.ts electron/telemetry-service.ts electron/preload.ts
git commit -m "feat: add session scanner for live + external session discovery"
```

---

### Task 5: Session Store (Zustand)

**Files:**
- Create: `src/stores/sessionStore.ts`

**Step 1: Create the store**

Create `src/stores/sessionStore.ts`:

```typescript
import { create } from "zustand";
import type { SessionInfo, ReplayTimeline } from "../../shared/sessions";

type PanelView = "list" | "replay";

interface SessionStore {
  // Session list
  liveSessions: SessionInfo[];
  historySessions: SessionInfo[];

  // Replay state
  panelView: PanelView;
  replayTimeline: ReplayTimeline | null;
  replayCurrentIndex: number;
  replayIsPlaying: boolean;
  replaySpeed: number;

  // Actions — list
  setSessions: (sessions: SessionInfo[]) => void;

  // Actions — replay
  loadReplay: (filePath: string) => Promise<void>;
  exitReplay: () => void;
  seekTo: (index: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  togglePlayback: () => void;
  stopPlayback: () => void;
  setSpeed: (speed: number) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  liveSessions: [],
  historySessions: [],

  panelView: "list",
  replayTimeline: null,
  replayCurrentIndex: 0,
  replayIsPlaying: false,
  replaySpeed: 1,

  setSessions: (sessions) => {
    const live = sessions.filter((s) => s.isLive);
    const history = sessions.filter((s) => !s.isLive);
    set({ liveSessions: live, historySessions: history });
  },

  loadReplay: async (filePath) => {
    set({ panelView: "replay", replayTimeline: null, replayCurrentIndex: 0, replayIsPlaying: false });
    const timeline = await (window as any).termcanvas.sessions.loadReplay(filePath);
    set({ replayTimeline: timeline });
  },

  exitReplay: () => {
    set({ panelView: "list", replayTimeline: null, replayCurrentIndex: 0, replayIsPlaying: false });
  },

  seekTo: (index) => {
    const timeline = get().replayTimeline;
    if (!timeline) return;
    const clamped = Math.max(0, Math.min(index, timeline.events.length - 1));
    set({ replayCurrentIndex: clamped });
  },

  stepForward: () => {
    const { replayCurrentIndex, replayTimeline } = get();
    if (!replayTimeline) return;
    if (replayCurrentIndex < replayTimeline.events.length - 1) {
      set({ replayCurrentIndex: replayCurrentIndex + 1 });
    }
  },

  stepBackward: () => {
    const { replayCurrentIndex } = get();
    if (replayCurrentIndex > 0) {
      set({ replayCurrentIndex: replayCurrentIndex - 1 });
    }
  },

  togglePlayback: () => {
    set((s) => ({ replayIsPlaying: !s.replayIsPlaying }));
  },

  stopPlayback: () => {
    set({ replayIsPlaying: false });
  },

  setSpeed: (speed) => {
    set({ replaySpeed: speed });
  },
}));

// IPC subscription — call once at app startup
export function initSessionStoreIPC(): () => void {
  const unsub = (window as any).termcanvas.sessions.onListChanged(
    (sessions: SessionInfo[]) => {
      useSessionStore.getState().setSessions(sessions);
    },
  );
  return unsub;
}
```

**Step 2: Initialize IPC in App.tsx**

In `src/App.tsx`, in the main `App` component's `useEffect` block (near other initializations):

```typescript
import { initSessionStoreIPC } from "./stores/sessionStore";

// Inside useEffect:
const unsubSessions = initSessionStoreIPC();
return () => { unsubSessions(); /* ... other cleanup */ };
```

**Step 3: Verify**

Run: `tsc --noEmit`

**Step 4: Commit**

```bash
git add src/stores/sessionStore.ts src/App.tsx
git commit -m "feat: add session store with IPC subscription and replay state"
```

---

### Task 6: SessionsPanel — Live + History List

**Files:**
- Create: `src/components/SessionsPanel.tsx`
- Modify: `src/components/RightPanel.tsx` (replace placeholder)

**Step 1: Create SessionsPanel**

Create `src/components/SessionsPanel.tsx`:

```tsx
import { useSessionStore } from "../stores/sessionStore";
import { SessionReplayView } from "./SessionReplayView";
import type { SessionInfo } from "../../shared/sessions";

const STATUS_COLORS: Record<SessionInfo["status"], string> = {
  generating: "#22c55e",
  tool_running: "#f59e0b",
  turn_complete: "#6b7280",
  idle: "#6b7280",
  error: "#ef4444",
};

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function projectName(dir: string): string {
  // projectDir is often the hashed key like "-Users-foo-myproject"
  const parts = dir.replace(/^-/, "").split("-");
  return parts[parts.length - 1] || dir;
}

function SessionCard({ session }: { session: SessionInfo }) {
  return (
    <div className="px-2 py-1.5 rounded-md bg-[var(--bg-secondary)] flex items-center gap-2">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_COLORS[session.status] }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">{projectName(session.projectDir)}</div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">
          {session.currentTool ? `${session.currentTool}` : session.status}
          {" · "}
          {formatDuration(session.startedAt)}
          {session.isManaged && " · managed"}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ session, onClick }: { session: SessionInfo; onClick: () => void }) {
  return (
    <button
      className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-[var(--sidebar-hover)] rounded cursor-pointer text-left"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[11px] truncate">{projectName(session.projectDir)}</div>
        <div className="text-[10px] text-[var(--text-muted)]">
          {formatTime(session.lastActivityAt)}
          {" · "}
          {session.messageCount} msgs
          {session.tokenTotal > 0 && ` · ${Math.round(session.tokenTotal / 1000)}k tok`}
        </div>
      </div>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-[var(--text-faint)]">
        <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function SessionsPanel() {
  const panelView = useSessionStore((s) => s.panelView);
  const liveSessions = useSessionStore((s) => s.liveSessions);
  const historySessions = useSessionStore((s) => s.historySessions);
  const loadReplay = useSessionStore((s) => s.loadReplay);

  if (panelView === "replay") {
    return <SessionReplayView />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Live Sessions */}
      {liveSessions.length > 0 && (
        <div className="shrink-0 px-3 pt-3 pb-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5" style={{ fontFamily: '"Geist Mono", monospace' }}>
            Live
          </div>
          <div className="flex flex-col gap-1">
            {liveSessions.map((s) => (
              <SessionCard key={s.sessionId} session={s} />
            ))}
          </div>
        </div>
      )}

      {liveSessions.length > 0 && historySessions.length > 0 && (
        <div className="mx-3 h-px bg-[var(--border)]" />
      )}

      {/* History */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pt-2 pb-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1" style={{ fontFamily: '"Geist Mono", monospace' }}>
            History
          </div>
        </div>
        <div className="px-1 pb-3">
          {historySessions.length === 0 ? (
            <div className="px-2 py-4 text-[11px] text-[var(--text-faint)] text-center">
              No sessions found
            </div>
          ) : (
            historySessions.map((s) => (
              <HistoryRow
                key={s.sessionId}
                session={s}
                onClick={() => loadReplay(s.filePath)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update RightPanel to use SessionsPanel**

In `src/components/RightPanel.tsx`, replace the placeholder:

```tsx
import { SessionsPanel } from "./SessionsPanel";

// Replace:
//   {activeTab === "sessions" && (<div>Sessions (coming soon)</div>)}
// With:
//   {activeTab === "sessions" && <SessionsPanel />}
```

**Step 3: Verify**

Run: `tsc --noEmit`
Run: `npm run dev` — sessions tab should show live sessions (if any running) and history list from JSONL scan.

**Step 4: Commit**

```bash
git add src/components/SessionsPanel.tsx src/components/RightPanel.tsx
git commit -m "feat: add sessions panel with live status cards and history list"
```

---

### Task 7: Session Replay View

**Files:**
- Create: `src/components/SessionReplayView.tsx`

**Step 1: Create the replay component**

Create `src/components/SessionReplayView.tsx`:

```tsx
import { useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { TimelineEvent } from "../../shared/sessions";

const EVENT_ICONS: Record<TimelineEvent["type"], string> = {
  user_prompt: "▶",
  assistant_text: "◆",
  thinking: "◌",
  tool_use: "⚙",
  tool_result: "✓",
  turn_complete: "●",
  error: "✗",
};

const EVENT_COLORS: Record<TimelineEvent["type"], string> = {
  user_prompt: "var(--accent)",
  assistant_text: "var(--text-primary)",
  thinking: "var(--text-muted)",
  tool_use: "#f59e0b",
  tool_result: "#22c55e",
  turn_complete: "var(--text-faint)",
  error: "#ef4444",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function TimelineRow({
  event,
  isCurrent,
  onClick,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-full px-2 py-1 flex items-start gap-1.5 text-left cursor-pointer rounded text-[10px] transition-colors ${
        isCurrent ? "bg-[var(--accent-bg)]" : "hover:bg-[var(--sidebar-hover)]"
      }`}
      onClick={onClick}
    >
      <span className="shrink-0 w-3 text-center" style={{ color: EVENT_COLORS[event.type] }}>
        {EVENT_ICONS[event.type]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ color: isCurrent ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {event.toolName ? `${event.toolName}` : event.type.replace("_", " ")}
          {event.filePath && (
            <span className="text-[var(--text-faint)]"> {event.filePath.split("/").pop()}</span>
          )}
        </div>
        {event.textPreview && (
          <div className="truncate text-[var(--text-faint)]">{event.textPreview}</div>
        )}
      </div>
      <span className="shrink-0 text-[var(--text-faint)] tabular-nums">
        {formatTimestamp(event.timestamp)}
      </span>
    </button>
  );
}

const SPEEDS = [1, 2, 4, 8];

export function SessionReplayView() {
  const timeline = useSessionStore((s) => s.replayTimeline);
  const currentIndex = useSessionStore((s) => s.replayCurrentIndex);
  const isPlaying = useSessionStore((s) => s.replayIsPlaying);
  const speed = useSessionStore((s) => s.replaySpeed);
  const exitReplay = useSessionStore((s) => s.exitReplay);
  const seekTo = useSessionStore((s) => s.seekTo);
  const stepForward = useSessionStore((s) => s.stepForward);
  const stepBackward = useSessionStore((s) => s.stepBackward);
  const togglePlayback = useSessionStore((s) => s.togglePlayback);
  const stopPlayback = useSessionStore((s) => s.stopPlayback);
  const setSpeed = useSessionStore((s) => s.setSpeed);

  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to current event
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying || !timeline) return;

    const events = timeline.events;
    if (currentIndex >= events.length - 1) {
      stopPlayback();
      return;
    }

    const current = events[currentIndex];
    const next = events[currentIndex + 1];
    const realDelta = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
    const interval = Math.max(50, Math.min(2000, realDelta / speed));

    const timer = setTimeout(() => {
      stepForward();
    }, interval);

    return () => clearTimeout(timer);
  }, [isPlaying, currentIndex, speed, timeline, stepForward, stopPlayback]);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timeline) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      seekTo(Math.round(fraction * (timeline.events.length - 1)));
    },
    [timeline, seekTo],
  );

  if (!timeline) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="text-[11px] text-[var(--text-faint)]">Loading replay...</div>
      </div>
    );
  }

  const projectDir = timeline.projectDir;
  const progress = timeline.events.length > 1 ? currentIndex / (timeline.events.length - 1) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-2 py-2 border-b border-[var(--border)] flex items-center gap-2">
        <button
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          onClick={exitReplay}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 1L3 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate">
            {projectDir.replace(/^-/, "").split("-").pop()}
          </div>
          <div className="text-[9px] text-[var(--text-faint)]">
            {timeline.events.length} events · {Math.round(timeline.totalTokens / 1000)}k tokens
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        {timeline.events.map((event) => (
          <TimelineRow
            key={event.index}
            ref={event.index === currentIndex ? currentRef : undefined}
            event={event}
            isCurrent={event.index === currentIndex}
            onClick={() => seekTo(event.index)}
          />
        ))}
      </div>

      {/* Playback controls */}
      <div className="shrink-0 border-t border-[var(--border)] px-2 py-1.5">
        {/* Progress bar */}
        <div
          className="h-1 bg-[var(--border)] rounded-full mb-1.5 cursor-pointer"
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-75"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-1">
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={() => seekTo(0)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2v6M8 2L4 5l4 3V2z" fill="currentColor"/></svg>
          </button>
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={stepBackward}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M7 2L3 5l4 3V2z" fill="currentColor"/></svg>
          </button>
          <button className="p-1 text-[var(--text-primary)] cursor-pointer" onClick={togglePlayback}>
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="2" width="3" height="8" rx="0.5" fill="currentColor"/><rect x="7" y="2" width="3" height="8" rx="0.5" fill="currentColor"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="currentColor"/></svg>
            )}
          </button>
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={stepForward}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3V2z" fill="currentColor"/></svg>
          </button>
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={() => seekTo(timeline.events.length - 1)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M8 2v6M2 2l4 3-4 3V2z" fill="currentColor"/></svg>
          </button>

          <div className="flex-1" />

          {/* Speed */}
          <button
            className="text-[9px] tabular-nums text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer px-1"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            onClick={() => {
              const idx = SPEEDS.indexOf(speed);
              setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
            }}
          >
            {speed}x
          </button>

          {/* Position */}
          <span className="text-[9px] tabular-nums text-[var(--text-faint)]" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {currentIndex + 1}/{timeline.events.length}
          </span>
        </div>
      </div>
    </div>
  );
}
```

Note: The `TimelineRow` uses `ref` forwarding — you'll need to wrap it with `forwardRef` or use a different approach for the current-event ref. Simplest fix: use a wrapper `<div ref={...}>` around the button in the map instead.

**Step 2: Verify**

Run: `tsc --noEmit`
Run: `npm run dev` — click a history session → replay view should show timeline + playback controls.

**Step 3: Commit**

```bash
git add src/components/SessionReplayView.tsx
git commit -m "feat: add session replay view with timeline and playback controls"
```

---

### Task 8: Final Integration + Type Check

**Step 1: Full type check**

Run: `tsc --noEmit`

Fix any remaining type errors from integration.

**Step 2: Manual smoke test**

1. Start dev: `npm run dev`
2. Right sidebar → two tabs visible (Sessions, Usage)
3. Sessions tab shows live sessions (if any active in TermCanvas)
4. Sessions tab shows history (from `~/.claude/projects/`)
5. Click a history session → replay view opens
6. Playback controls work (play, pause, step, seek, speed)
7. Back button returns to list
8. Usage tab still works as before
9. Collapsed sidebar shows two icon buttons

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete live sessions and session replay integration"
```
