import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTelemetryAge,
  getTelemetryBadgeLabel,
  getTelemetryFacts,
} from "../src/terminal/telemetryPresentation.ts";

const SNAPSHOT = {
  terminal_id: "terminal-1",
  worktree_path: "/tmp/project",
  provider: "codex",
  session_attached: true,
  session_attach_confidence: "medium",
  session_id: "session-1",
  last_session_event_at: "2026-03-26T00:00:09.000Z",
  last_session_event_kind: "function_call_output",
  turn_state: "tool_running",
  pty_alive: true,
  descendant_processes: [],
  foreground_tool: "npm run build",
  done_exists: false,
  result_exists: true,
  last_meaningful_progress_at: "2026-03-26T00:00:10.000Z",
  derived_status: "progressing",
} as const;

test("getTelemetryBadgeLabel maps derived status to UI label", () => {
  assert.equal(getTelemetryBadgeLabel(SNAPSHOT), "Progressing");
});

test("getTelemetryBadgeLabel clarifies exited status as process exit", () => {
  assert.equal(
    getTelemetryBadgeLabel({
      ...SNAPSHOT,
      pty_alive: false,
      derived_status: "exited",
    }),
    "Process exited",
  );
});

test("formatTelemetryAge returns compact relative text", () => {
  const nowMs = Date.parse("2026-03-26T00:01:10.000Z");
  assert.equal(formatTelemetryAge("2026-03-26T00:01:08.000Z", nowMs), "just now");
  assert.equal(formatTelemetryAge("2026-03-26T00:01:00.000Z", nowMs), "10s ago");
});

test("getTelemetryFacts surfaces progress, event, tool, and contract facts", () => {
  const facts = getTelemetryFacts(
    SNAPSHOT,
    Date.parse("2026-03-26T00:01:10.000Z"),
  );

  assert.deepEqual(facts, [
    "Provider codex",
    "Session attached",
    "Progress 1m ago",
    "Event function_call_output",
    "Tool npm run build",
    "Contract result / no done",
  ]);
});

test("getTelemetryFacts clarifies exited snapshots as recorded history", () => {
  const facts = getTelemetryFacts(
    {
      ...SNAPSHOT,
      pty_alive: false,
      exit_code: 0,
      derived_status: "exited",
    },
    Date.parse("2026-03-26T00:01:10.000Z"),
  );

  assert.deepEqual(facts, [
    "Provider codex",
    "Process exited (0)",
    "Session recorded",
    "Progress 1m ago",
    "Event function_call_output",
    "Tool npm run build",
    "Contract result / no done",
  ]);
});
