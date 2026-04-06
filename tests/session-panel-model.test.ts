import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionSections,
  collectCanvasSessionMeta,
} from "../src/components/sessionPanelModel.ts";
import type { SessionInfo } from "../shared/sessions.ts";
import type { ProjectData } from "../src/types/index.ts";

function createProjects(): ProjectData[] {
  return [
    {
      id: "project-1",
      name: "TermCanvas",
      path: "/tmp/termcanvas",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "worktree-1",
          name: "main",
          path: "/tmp/termcanvas",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-1",
              title: "codex",
              customTitle: "fix sessions",
              type: "codex",
              minimized: false,
              focused: true,
              ptyId: 100,
              status: "running",
              span: { cols: 1, rows: 1 },
              sessionId: "session-canvas-running",
            },
            {
              id: "terminal-2",
              title: "claude",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: 101,
              status: "idle",
              span: { cols: 1, rows: 1 },
              sessionId: "session-canvas-idle",
            },
            {
              id: "terminal-3",
              title: "codex",
              type: "codex",
              minimized: true,
              focused: false,
              ptyId: 102,
              status: "idle",
              span: { cols: 1, rows: 1 },
              sessionId: "session-hidden",
            },
          ],
        },
      ],
    },
  ];
}

function createSession(
  sessionId: string,
  status: SessionInfo["status"],
  lastActivityAt: string,
  isLive: boolean,
): SessionInfo {
  return {
    sessionId,
    projectDir: "/tmp/termcanvas",
    filePath: `/tmp/${sessionId}.jsonl`,
    isLive,
    isManaged: false,
    status,
    startedAt: "2026-04-05T10:00:00.000Z",
    lastActivityAt,
    messageCount: 3,
    tokenTotal: 1200,
  };
}

function createTelemetry(
  terminalId: string,
  overrides: Partial<TerminalTelemetrySnapshot>,
): TerminalTelemetrySnapshot {
  return {
    terminal_id: terminalId,
    worktree_path: "/tmp/termcanvas",
    provider: "codex",
    session_attached: true,
    session_attach_confidence: "medium",
    session_id: `session-${terminalId}`,
    turn_state: "unknown",
    pty_alive: true,
    descendant_processes: [],
    active_tool_calls: 0,
    done_exists: false,
    result_exists: false,
    derived_status: "starting",
    ...overrides,
  };
}

test("collectCanvasSessionMeta only includes visible canvas terminals", () => {
  const meta = collectCanvasSessionMeta(createProjects());

  assert.deepEqual(
    [...meta.keys()],
    ["session-canvas-running", "session-canvas-idle"],
  );
  assert.equal(meta.get("session-canvas-running")?.focused, true);
  assert.equal(
    meta.get("session-canvas-running")?.title,
    "fix sessions · codex",
  );
});

test("buildSessionSections prioritizes visible canvas sessions before recent and history", () => {
  const meta = collectCanvasSessionMeta(createProjects());
  const liveSessions: SessionInfo[] = [
    createSession(
      "session-offcanvas-live",
      "tool_running",
      "2026-04-05T12:05:00.000Z",
      true,
    ),
    createSession(
      "session-canvas-idle",
      "idle",
      "2026-04-05T12:04:00.000Z",
      true,
    ),
    createSession(
      "session-canvas-running",
      "generating",
      "2026-04-05T12:06:00.000Z",
      true,
    ),
  ];
  const historySessions: SessionInfo[] = [
    createSession(
      "session-old",
      "turn_complete",
      "2026-04-05T09:00:00.000Z",
      false,
    ),
  ];

  const sections = buildSessionSections(liveSessions, historySessions, meta);

  assert.deepEqual(
    sections.onCanvas.map((session) => session.sessionId),
    ["session-canvas-running", "session-canvas-idle"],
  );
  assert.deepEqual(
    sections.recent.map((session) => session.sessionId),
    ["session-offcanvas-live"],
  );
  assert.deepEqual(
    sections.history.map((session) => session.sessionId),
    ["session-old"],
  );
});
