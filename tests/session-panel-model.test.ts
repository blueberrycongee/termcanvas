import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanvasTerminalDisplayGroups,
  buildCanvasTerminalSections,
  buildProjectTree,
} from "../src/components/sessionPanelModel.ts";
import type { ProjectGroup } from "../src/components/sessionPanelModel.ts";
import type { SessionInfo } from "../shared/sessions.ts";
import type { TerminalTelemetrySnapshot } from "../shared/telemetry.ts";
import type { ProjectData } from "../src/types/index.ts";

function createProjects(): ProjectData[] {
  return [
    {
      id: "project-1",
      name: "termcanvas",
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
              id: "terminal-focused",
              title: "codex",
              customTitle: "review ui",
              type: "codex",
              minimized: false,
              focused: true,
              ptyId: 100,
              status: "waiting",
              span: { cols: 1, rows: 1 },
              sessionId: "session-focused",
            },
            {
              id: "terminal-running",
              title: "codex",
              type: "codex",
              minimized: false,
              focused: false,
              ptyId: 101,
              status: "running",
              span: { cols: 1, rows: 1 },
              sessionId: "session-running",
              initialPrompt: "Run smoke tests on the renderer",
            },
            {
              id: "terminal-stalled",
              title: "claude",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: 102,
              status: "waiting",
              span: { cols: 1, rows: 1 },
              sessionId: "session-stalled",
            },
            {
              id: "terminal-idle",
              title: "Terminal",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: 103,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
            {
              id: "terminal-hidden",
              title: "codex",
              type: "codex",
              minimized: true,
              focused: false,
              ptyId: 104,
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
): SessionInfo {
  return {
    sessionId,
    projectDir: "/tmp/termcanvas",
    filePath: `/tmp/${sessionId}.jsonl`,
    isLive: true,
    isManaged: true,
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

test("buildCanvasTerminalSections prioritizes focused terminal and groups remaining terminals by attention state", () => {
  const telemetryByTerminalId = new Map<
    string,
    TerminalTelemetrySnapshot | null
  >([
    [
      "terminal-focused",
      createTelemetry("terminal-focused", {
        turn_state: "turn_complete",
        derived_status: "progressing",
        last_meaningful_progress_at: "2026-04-05T12:06:00.000Z",
      }),
    ],
    [
      "terminal-stalled",
      createTelemetry("terminal-stalled", {
        provider: "claude",
        turn_state: "in_turn",
        derived_status: "stall_candidate",
        last_meaningful_progress_at: "2026-04-05T12:04:00.000Z",
      }),
    ],
  ]);
  const sessionsById = new Map<string, SessionInfo>([
    [
      "session-running",
      createSession(
        "session-running",
        "tool_running",
        "2026-04-05T12:05:00.000Z",
      ),
    ],
    [
      "session-focused",
      createSession(
        "session-focused",
        "turn_complete",
        "2026-04-05T12:06:00.000Z",
      ),
    ],
  ]);

  const sections = buildCanvasTerminalSections(
    createProjects(),
    telemetryByTerminalId,
    sessionsById,
  );

  assert.equal(sections.focused?.terminalId, "terminal-focused");
  assert.equal(sections.focused?.state, "done");
  assert.equal(sections.focused?.title, "review ui · codex");

  assert.deepEqual(
    sections.attention.map((item) => item.terminalId),
    ["terminal-stalled"],
  );
  assert.deepEqual(
    sections.progress.map((item) => item.terminalId),
    ["terminal-running"],
  );
  assert.deepEqual(
    sections.idle.map((item) => item.terminalId),
    ["terminal-idle"],
  );
  assert.equal(sections.done.length, 0);
});

test("buildCanvasTerminalSections falls back to the initial prompt when terminal titles are too generic", () => {
  const telemetryByTerminalId = new Map<
    string,
    TerminalTelemetrySnapshot | null
  >();
  const sessionsById = new Map<string, SessionInfo>();

  const sections = buildCanvasTerminalSections(
    createProjects(),
    telemetryByTerminalId,
    sessionsById,
  );

  const runningItem = sections.progress.find(
    (item) => item.terminalId === "terminal-running",
  );
  assert.equal(runningItem?.title, "Run smoke tests on the renderer");
  assert.equal(runningItem?.locationLabel, "termcanvas / main");
});

test("buildCanvasTerminalDisplayGroups keeps only unread completions in fresh results", () => {
  const telemetryByTerminalId = new Map<
    string,
    TerminalTelemetrySnapshot | null
  >();
  const sessionsById = new Map<string, SessionInfo>([
    [
      "session-focused",
      createSession(
        "session-focused",
        "turn_complete",
        "2026-04-05T12:06:00.000Z",
      ),
    ],
    [
      "session-running",
      createSession(
        "session-running",
        "tool_running",
        "2026-04-05T12:05:00.000Z",
      ),
    ],
  ]);

  const sections = buildCanvasTerminalSections(
    createProjects(),
    telemetryByTerminalId,
    sessionsById,
  );
  const groups = buildCanvasTerminalDisplayGroups(
    {
      ...sections,
      done: [
        {
          terminalId: "terminal-running",
          projectId: "project-1",
          projectName: "termcanvas",
          worktreeId: "worktree-1",
          worktreeName: "main",
          title: "Run smoke tests on the renderer",
          locationLabel: "termcanvas / main",
          focused: false,
          state: "done",
          activityAt: "2026-04-05T12:05:00.000Z",
        },
      ],
    },
    new Set(["terminal-running"]),
  );

  assert.equal(groups.freshDone.length, 0);
  assert.deepEqual(
    groups.background.map((item) => item.terminalId),
    ["terminal-running", "terminal-idle"],
  );
});

test("buildProjectTree sorts projects by highest-priority status and handles multiple worktrees", () => {
  const projects: ProjectData[] = [
    {
      id: "proj-idle",
      name: "idle-project",
      path: "/tmp/idle-project",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "wt-idle-main",
          name: "main",
          path: "/tmp/idle-project",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "term-idle-shell",
              title: "shell",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: 200,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
    {
      id: "proj-active",
      name: "active-project",
      path: "/tmp/active-project",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 2,
      worktrees: [
        {
          id: "wt-active-main",
          name: "main",
          path: "/tmp/active-project",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "term-active-claude",
              title: "claude",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: 201,
              status: "running",
              span: { cols: 1, rows: 1 },
              sessionId: "session-active-claude",
            },
          ],
        },
        {
          id: "wt-active-feature",
          name: "feature/new-ui",
          path: "/tmp/active-project-feature",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "term-active-codex",
              title: "codex",
              type: "codex",
              minimized: false,
              focused: false,
              ptyId: 202,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
  ];

  const telemetryByTerminalId = new Map<
    string,
    TerminalTelemetrySnapshot | null
  >();
  const sessionsById = new Map<string, SessionInfo>([
    [
      "session-active-claude",
      createSession(
        "session-active-claude",
        "tool_running",
        "2026-04-05T12:10:00.000Z",
      ),
    ],
  ]);

  const tree = buildProjectTree(projects, telemetryByTerminalId, sessionsById);

  // Two projects in the tree
  assert.equal(tree.length, 2);

  // active-project sorts first (has a running terminal)
  assert.equal(tree[0].projectName, "active-project");
  assert.equal(tree[0].flat, false); // two worktrees
  assert.equal(tree[0].worktrees.length, 2);

  // idle-project sorts second
  assert.equal(tree[1].projectName, "idle-project");
  assert.equal(tree[1].flat, true); // one worktree
});

test("buildProjectTree groups terminals under project/worktree with status summaries", () => {
  const telemetryByTerminalId = new Map<
    string,
    TerminalTelemetrySnapshot | null
  >([
    [
      "terminal-focused",
      createTelemetry("terminal-focused", {
        turn_state: "turn_complete",
        derived_status: "progressing",
        last_meaningful_progress_at: "2026-04-05T12:06:00.000Z",
      }),
    ],
    [
      "terminal-stalled",
      createTelemetry("terminal-stalled", {
        provider: "claude",
        turn_state: "in_turn",
        derived_status: "stall_candidate",
        last_meaningful_progress_at: "2026-04-05T12:04:00.000Z",
      }),
    ],
  ]);
  const sessionsById = new Map<string, SessionInfo>([
    [
      "session-running",
      createSession(
        "session-running",
        "tool_running",
        "2026-04-05T12:05:00.000Z",
      ),
    ],
    [
      "session-focused",
      createSession(
        "session-focused",
        "turn_complete",
        "2026-04-05T12:06:00.000Z",
      ),
    ],
  ]);

  const tree = buildProjectTree(
    createProjects(),
    telemetryByTerminalId,
    sessionsById,
  );

  assert.equal(tree.length, 1);
  assert.equal(tree[0].projectName, "termcanvas");
  assert.equal(tree[0].flat, true);
  assert.equal(tree[0].worktrees.length, 1);

  const wt = tree[0].worktrees[0];
  assert.equal(wt.terminals.length, 3);
  assert.equal(wt.terminals[0].terminalId, "terminal-stalled");
  assert.equal(wt.terminals[0].state, "attention");
  assert.equal(wt.terminals[1].terminalId, "terminal-running");
  assert.equal(wt.terminals[2].terminalId, "terminal-idle");

  assert.equal(tree[0].statusSummary.attention, 1);
  assert.equal(tree[0].statusSummary.running, 1);
  assert.equal(tree[0].statusSummary.idle, 1);
});
