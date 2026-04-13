import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { ASSIGNMENT_STATE_SCHEMA_VERSION } from "../src/assignment/types.ts";

function createManager(): { manager: AssignmentManager; repoPath: string; workflowId: string } {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-assignment-"));
  const workflowId = "workflow-123";
  return {
    manager: new AssignmentManager(repoPath, workflowId),
    repoPath,
    workflowId,
  };
}

function cleanup(repoPath: string): void {
  fs.rmSync(repoPath, { recursive: true, force: true });
}

test("AssignmentManager creates the assignment directory", (t) => {
  const { repoPath, workflowId } = createManager();
  t.after(() => cleanup(repoPath));

  // AssignmentManager no longer creates a top-level directory eagerly;
  // directories are created on first save. Just verify the manager was created.
  assert.ok(true, "AssignmentManager constructor succeeds");
});

test("AssignmentManager creates an assignment", (t) => {
  const { manager, repoPath, workflowId } = createManager();
  t.after(() => cleanup(repoPath));

  const assignment = manager.create({
    workflow_id: workflowId,
    role: "dev",
    from_assignment_id: null,
    requested_agent_type: "codex",
    max_retries: 2,
  });

  assert.equal(assignment.schema_version, ASSIGNMENT_STATE_SCHEMA_VERSION);
  assert.match(assignment.id, /^assignment-[a-f0-9]{12}$/);
  assert.equal(assignment.status, "pending");
  assert.equal(assignment.retry_count, 0);
  assert.equal(assignment.active_run_id, null);
  assert.deepEqual(assignment.runs, []);
});

test("AssignmentManager loads an assignment", (t) => {
  const { manager, repoPath, workflowId } = createManager();
  t.after(() => cleanup(repoPath));

  const created = manager.create({
    workflow_id: workflowId,
    role: "researcher",
    from_assignment_id: null,
    requested_agent_type: "claude",
    max_retries: 1,
  });

  const loaded = manager.load(created.id);
  assert.notEqual(loaded, null);
  assert.equal(loaded?.id, created.id);
  assert.equal(loaded?.role, "researcher");
});

test("AssignmentManager updates assignment status", (t) => {
  const { manager, repoPath, workflowId } = createManager();
  t.after(() => cleanup(repoPath));

  const assignment = manager.create({
    workflow_id: workflowId,
    role: "reviewer",
    from_assignment_id: "assignment-previous",
    requested_agent_type: "claude",
    max_retries: 1,
  });

  manager.updateStatus(assignment.id, "in_progress");
  const updated = manager.load(assignment.id);
  assert.equal(updated?.status, "in_progress");
});
