import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { AssignmentStateMachine } from "../src/assignment/state-machine.ts";

function createFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-assignment-sm-"));
  const workflowId = "workflow-123";
  const manager = new AssignmentManager(repoPath, workflowId);
  const stateMachine = new AssignmentStateMachine(manager, {
    now: () => "2026-03-26T12:00:00.000Z",
  });

  const assignment = manager.create({
    workflow_id: workflowId,
    role: "implementer",
    kind: "implementation",
    from_assignment_id: "assignment-research",
    requested_agent_type: "codex",
    max_retries: 1,
  });

  return { repoPath, manager, stateMachine, assignment };
}

function cleanup(repoPath: string): void {
  fs.rmSync(repoPath, { recursive: true, force: true });
}

function seedRun(manager: AssignmentManager, assignmentId: string, runId: string): void {
  const assignment = manager.load(assignmentId);
  if (!assignment) {
    throw new Error(`Assignment not found: ${assignmentId}`);
  }
  assignment.active_run_id = runId;
  assignment.runs.push({
    id: runId,
    terminal_id: "terminal-123",
    agent_type: "codex",
    prompt: "prompt",
    task_file: "/tmp/task.md",
    result_file: "/tmp/result.json",
    artifact_dir: "/tmp/artifacts",
    status: "running",
    started_at: "2026-03-26T12:00:00.000Z",
  });
  manager.save(assignment);
}

test("claimPending and markInProgress are idempotent for the same tick", async (t) => {
  const { repoPath, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanup(repoPath));

  const firstClaim = await stateMachine.claimPending(assignment.id, "tick-1");
  const duplicateClaim = await stateMachine.claimPending(assignment.id, "tick-1");
  const firstInProgress = await stateMachine.markInProgress(assignment.id, {
    tickId: "tick-1",
  });
  const duplicateInProgress = await stateMachine.markInProgress(assignment.id, {
    tickId: "tick-1",
  });
  const persisted = manager.load(assignment.id);

  assert.equal(firstClaim.changed, true);
  assert.equal(duplicateClaim.changed, false);
  assert.equal(firstInProgress.changed, true);
  assert.equal(duplicateInProgress.changed, false);
  assert.equal(persisted?.status, "in_progress");
  assert.equal(persisted?.claim?.tick_id, "tick-1");
});

test("markCompleted records the result and closes the active run", async (t) => {
  const { repoPath, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanup(repoPath));

  seedRun(manager, assignment.id, "run-1");
  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  const completed = await stateMachine.markCompleted(assignment.id, {
    success: true,
    summary: "Implemented the change.",
    outputs: [{ path: "src/index.ts" }],
    evidence: ["npm test"],
    next_action: { type: "complete", reason: "Done" },
  });

  const persisted = manager.load(assignment.id);
  const run = persisted?.runs.find((entry) => entry.id === "run-1");

  assert.equal(completed.changed, true);
  assert.equal(persisted?.status, "completed");
  assert.equal(persisted?.result?.summary, "Implemented the change.");
  assert.equal(run?.status, "completed");
  assert.equal(run?.ended_at, "2026-03-26T12:00:00.000Z");
});

test("scheduleRetry returns timed-out assignments to pending and fails at the retry limit", async (t) => {
  const { repoPath, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanup(repoPath));

  seedRun(manager, assignment.id, "run-1");
  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "ASSIGNMENT_TIMEOUT",
    message: "first timeout",
    stage: "dispatcher.watch",
  });

  const scheduled = await stateMachine.scheduleRetry(assignment.id);
  const retried = manager.load(assignment.id);

  assert.equal(scheduled.changed, true);
  assert.equal(retried?.status, "pending");
  assert.equal(retried?.retry_count, 1);
  assert.equal(retried?.active_run_id, null);
  assert.equal(retried?.claim, undefined);

  seedRun(manager, assignment.id, "run-2");
  await stateMachine.claimPending(assignment.id, "tick-2");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-2", runId: "run-2" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "ASSIGNMENT_TIMEOUT",
    message: "second timeout",
    stage: "dispatcher.watch",
  });

  const exhausted = await stateMachine.scheduleRetry(assignment.id);
  const failed = manager.load(assignment.id);

  assert.equal(exhausted.changed, true);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.retry_count, 1);
  assert.equal(failed?.last_error?.code, "ASSIGNMENT_RETRY_LIMIT_EXCEEDED");
});

test("concurrent duplicate claimPending calls only claim the assignment once", async (t) => {
  const { repoPath, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanup(repoPath));

  const [first, second] = await Promise.all([
    stateMachine.claimPending(assignment.id, "tick-dup"),
    stateMachine.claimPending(assignment.id, "tick-dup"),
  ]);
  const persisted = manager.load(assignment.id);
  const changedCount = [first, second].filter((result) => result.changed).length;

  assert.equal(changedCount, 1);
  assert.equal(persisted?.status, "claimed");
  assert.equal(persisted?.claim?.tick_id, "tick-dup");
});
