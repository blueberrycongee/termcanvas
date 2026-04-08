import test from "node:test";
import assert from "node:assert/strict";
import { enrichWorkflowStatusView } from "../src/telemetry.ts";
import { WORKFLOW_STATE_SCHEMA_VERSION } from "../src/workflow-store.ts";
import type { WorkflowStatusView } from "../src/workflow.ts";

const VIEW: WorkflowStatusView = {
  workflow: {
    schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
    id: "workflow-1",
    template: "single-step",
    task: "Implement telemetry",
    repo_path: "/repo/project",
    worktree_path: "/repo/project",
    branch: null,
    base_branch: "main",
    own_worktree: false,
    created_at: "2026-03-26T00:00:00.000Z",
    updated_at: "2026-03-26T00:00:00.000Z",
    status: "running",
    current_assignment_id: "assignment-1",
    assignment_ids: ["assignment-1"],
    timeout_minutes: 30,
    max_retries: 2,
    auto_approve: false,
  },
  assignments: [],
};

test("enrichWorkflowStatusView returns telemetry when TermCanvas is running", () => {
  const telemetry = { advisory_status: "progressing" };
  const result = enrichWorkflowStatusView(VIEW, {
    isTermCanvasRunning: () => true,
    telemetryWorkflow: (workflowId, repoPath) => {
      assert.equal(workflowId, "workflow-1");
      assert.equal(repoPath, "/repo/project");
      return telemetry;
    },
  });

  assert.equal(result.telemetry, telemetry);
});

test("enrichWorkflowStatusView returns null when TermCanvas is unavailable", () => {
  const result = enrichWorkflowStatusView(VIEW, {
    isTermCanvasRunning: () => false,
    telemetryWorkflow: () => {
      throw new Error("should not be called");
    },
  });

  assert.equal(result.telemetry, null);
});

test("enrichWorkflowStatusView degrades to null on telemetry query failure", () => {
  const result = enrichWorkflowStatusView(VIEW, {
    isTermCanvasRunning: () => true,
    telemetryWorkflow: () => {
      throw new Error("boom");
    },
  });

  assert.equal(result.telemetry, null);
});
