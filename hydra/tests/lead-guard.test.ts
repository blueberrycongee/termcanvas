import test from "node:test";
import assert from "node:assert/strict";
import { ensureLeadCaller, getCurrentTerminalId } from "../src/lead-guard.ts";
import type { WorkflowRecord } from "../src/workflow-store.ts";
import { WORKFLOW_STATE_SCHEMA_VERSION } from "../src/workflow-store.ts";

function makeWorkflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
    id: "workflow-test",
    lead_terminal_id: "terminal-lead",
    intent_file: "inputs/intent.md",
    repo_path: "/tmp/repo",
    worktree_path: "/tmp/repo",
    branch: null,
    base_branch: "main",
    own_worktree: false,
    created_at: "2026-04-10T00:00:00.000Z",
    updated_at: "2026-04-10T00:00:00.000Z",
    status: "active",
    nodes: {},
    node_statuses: {},
    assignment_ids: [],
    default_timeout_minutes: 30,
    default_max_retries: 1,
    default_agent_type: "claude",
    auto_approve: true,
    ...overrides,
  };
}

function withTerminalId<T>(terminalId: string | undefined, fn: () => T): T {
  const previous = process.env.TERMCANVAS_TERMINAL_ID;
  if (terminalId === undefined) {
    delete process.env.TERMCANVAS_TERMINAL_ID;
  } else {
    process.env.TERMCANVAS_TERMINAL_ID = terminalId;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TERMCANVAS_TERMINAL_ID;
    } else {
      process.env.TERMCANVAS_TERMINAL_ID = previous;
    }
  }
}

test("getCurrentTerminalId returns env var when set", () => {
  withTerminalId("terminal-abc", () => {
    assert.equal(getCurrentTerminalId(), "terminal-abc");
  });
});

test("getCurrentTerminalId returns undefined when env var is missing", () => {
  withTerminalId(undefined, () => {
    assert.equal(getCurrentTerminalId(), undefined);
  });
});

test("ensureLeadCaller permits callers without TERMCANVAS_TERMINAL_ID (tooling/scripts)", () => {
  withTerminalId(undefined, () => {
    const workflow = makeWorkflow({ lead_terminal_id: "terminal-lead" });
    assert.doesNotThrow(() => ensureLeadCaller(workflow));
  });
});

test("ensureLeadCaller permits the matching Lead terminal", () => {
  withTerminalId("terminal-lead", () => {
    const workflow = makeWorkflow({ lead_terminal_id: "terminal-lead" });
    assert.doesNotThrow(() => ensureLeadCaller(workflow));
  });
});

test("ensureLeadCaller rejects a different terminal with WORKFLOW_NOT_LEAD", () => {
  withTerminalId("terminal-other", () => {
    const workflow = makeWorkflow({ lead_terminal_id: "terminal-lead" });
    assert.throws(
      () => ensureLeadCaller(workflow),
      (err: Error & { errorCode?: string }) => {
        assert.equal(err.errorCode, "WORKFLOW_NOT_LEAD");
        assert.match(err.message, /Only the Lead terminal/);
        return true;
      },
    );
  });
});
