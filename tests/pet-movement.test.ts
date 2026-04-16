import test from "node:test";
import assert from "node:assert/strict";

import { PET_HALF_SIZE, PET_SIZE } from "../src/pet/constants.ts";
import { getTerminalTitleBarTarget, stepToward } from "../src/pet/petMovement.ts";
import {
  deriveAttentionFromTelemetryTransition,
  derivePetEventFromTelemetryTransition,
  derivePetEventFromWorkflowTransition,
} from "../src/pet/eventMappings.ts";
import type {
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../shared/telemetry.ts";

function buildTelemetry(
  patch: Partial<TerminalTelemetrySnapshot> = {},
): TerminalTelemetrySnapshot {
  return {
    terminal_id: "terminal-1",
    worktree_path: "/tmp/worktree",
    provider: "codex",
    session_attached: true,
    session_attach_confidence: "strong",
    turn_state: "unknown",
    pty_alive: true,
    descendant_processes: [],
    active_tool_calls: 0,
    result_exists: false,
    derived_status: "idle",
    ...patch,
  };
}

function buildWorkflow(
  patch: Partial<WorkflowTelemetrySnapshot> = {},
): WorkflowTelemetrySnapshot {
  return {
    workflow_id: "workflow-1",
    repo_path: "/tmp/repo",
    workflow_status: "active",
    terminal: null,
    contract: {
      result_exists: false,
    },
    retry_budget: {
      used: 0,
      max: 2,
      remaining: 2,
    },
    timeout_budget: {
      minutes: 10,
    },
    advisory_status: "idle",
    ...patch,
  };
}

test("getTerminalTitleBarTarget centers the pet using the current sprite size", () => {
  const target = getTerminalTitleBarTarget({
    x: 100,
    y: 240,
    width: 300,
  });

  assert.equal(target.x, 100 + 300 / 2 - PET_HALF_SIZE);
  assert.equal(target.y, 240);
  assert.equal(target.onTitleBar, true);
});

test("getTerminalTitleBarTarget keeps edge placement aligned to the current pet size", () => {
  const target = getTerminalTitleBarTarget(
    {
      x: 100,
      y: 240,
      width: 300,
    },
    true,
  );

  assert.equal(target.x, 100 + 300 - PET_SIZE - 8);
  assert.equal(target.y, 240);
  assert.equal(target.onTitleBar, true);
});

test("stepToward lands on top of the title bar using the current pet height", () => {
  const result = stepToward(
    { x: 200, y: 110 },
    { x: 200, y: 240, onTitleBar: true },
  );

  assert.equal(result.arrived, true);
  assert.deepEqual(result.position, {
    x: 200,
    y: 240 - 34 - PET_SIZE,
  });
});

test("telemetry transitions emit tool, completion, and stuck pet events", () => {
  assert.deepEqual(
    derivePetEventFromTelemetryTransition(
      buildTelemetry({ turn_state: "in_turn" }),
      buildTelemetry({ turn_state: "tool_running" }),
    ),
    { type: "TOOL_RUNNING" },
  );

  assert.deepEqual(
    derivePetEventFromTelemetryTransition(
      buildTelemetry({ turn_state: "tool_running" }),
      buildTelemetry({ turn_state: "awaiting_input" }),
    ),
    { type: "WORKER_STUCK" },
  );

  assert.deepEqual(
    derivePetEventFromTelemetryTransition(
      buildTelemetry({ turn_state: "in_turn" }),
      buildTelemetry({ turn_state: "turn_complete" }),
    ),
    { type: "TURN_COMPLETE" },
  );
});

test("telemetry-derived completion attention is suppressed after the user already saw it", () => {
  const attention = deriveAttentionFromTelemetryTransition(
    buildTelemetry({ turn_state: "in_turn" }),
    buildTelemetry({ turn_state: "turn_complete" }),
    {
      terminalId: "terminal-1",
      label: "Agent task",
      focused: false,
      seenCompletion: true,
    },
  );

  assert.equal(attention, null);
});

test("workflow transitions emit commanding, triumph, and dispatch failure events", () => {
  assert.deepEqual(
    derivePetEventFromWorkflowTransition(
      null,
      buildWorkflow({ workflow_status: "active" }),
    ),
    { type: "WORKFLOW_STARTED" },
  );

  assert.deepEqual(
    derivePetEventFromWorkflowTransition(
      buildWorkflow({ workflow_status: "active" }),
      buildWorkflow({ workflow_status: "completed" }),
    ),
    { type: "WORKFLOW_COMPLETED" },
  );

  assert.deepEqual(
    derivePetEventFromWorkflowTransition(
      buildWorkflow({ workflow_status: "active" }),
      buildWorkflow({ workflow_status: "failed" }),
    ),
    { type: "DISPATCH_FAILED" },
  );
});
