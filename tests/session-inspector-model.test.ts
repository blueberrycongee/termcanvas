import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInspectorTrace,
  pickInspectedTerminal,
} from "../src/components/sessionInspectorModel.ts";
import type { TelemetryEvent } from "../shared/telemetry.ts";
import type { CanvasTerminalSections } from "../src/components/sessionPanelModel.ts";

function createEvent(
  id: string,
  at: string,
  kind: string,
  data: Record<string, unknown> = {},
): TelemetryEvent {
  return {
    id,
    at,
    terminal_id: "terminal-1",
    source: "session",
    kind,
    data,
  };
}

test("buildInspectorTrace keeps the most recent meaningful trace events", () => {
  const trace = buildInspectorTrace([
    createEvent("1", "2026-04-05T12:00:00.000Z", "session_attached"),
    createEvent("2", "2026-04-05T12:01:00.000Z", "session_turn_state_changed", {
      to: "thinking",
    }),
    createEvent("3", "2026-04-05T12:02:00.000Z", "foreground_tool_changed", {
      to: "node /tmp/playwright-mcp.js",
    }),
    createEvent("4", "2026-04-05T12:03:00.000Z", "session_turn_state_changed", {
      to: "turn_complete",
    }),
    createEvent("5", "2026-04-05T12:04:00.000Z", "pty_exit", {
      exit_code: 1,
    }),
  ]);

  assert.deepEqual(
    trace.map((item) => [item.kind, item.toolName, item.exitCode]),
    [
      ["process_exited", undefined, 1],
      ["turn_complete", undefined, undefined],
      ["using_tool", "playwright-mcp", undefined],
      ["thinking", undefined, undefined],
      ["session_attached", undefined, undefined],
    ],
  );
});

test("pickInspectedTerminal prefers the focused item before other groups", () => {
  const focused = {
    terminalId: "focused",
    projectId: "project-1",
    projectName: "termcanvas",
    worktreeId: "worktree-1",
    worktreeName: "main",
    title: "Focused terminal",
    locationLabel: "termcanvas / main",
    focused: true,
    state: "running" as const,
  };

  const sections: CanvasTerminalSections = {
    focused,
    attention: [],
    progress: [],
    done: [],
    idle: [],
  };

  assert.equal(pickInspectedTerminal(sections)?.terminalId, "focused");
});
