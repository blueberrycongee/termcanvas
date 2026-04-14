import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { AssignmentStateMachine, computeNextRetryAt } from "../src/assignment/state-machine.ts";

function createFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-assignment-sm-"));
  const workflowId = "workflow-123";
  const manager = new AssignmentManager(repoPath, workflowId);
  const stateMachine = new AssignmentStateMachine(manager, {
    now: () => "2026-03-26T12:00:00.000Z",
  });

  const assignment = manager.create({
    workbench_id: workflowId,
    role: "dev",

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
    outcome: "completed",
    report_file: "report.md",
  });

  const persisted = manager.load(assignment.id);
  const run = persisted?.runs.find((entry) => entry.id === "run-1");

  assert.equal(completed.changed, true);
  assert.equal(persisted?.status, "completed");
  assert.equal(persisted?.result?.outcome, "completed");
  assert.equal(persisted?.result?.report_file, "report.md");
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

test("computeNextRetryAt returns undefined when no policy or no initial_interval_ms", () => {
  assert.equal(computeNextRetryAt(undefined, 1, "2026-04-12T00:00:00.000Z"), undefined);
  assert.equal(
    computeNextRetryAt({ maximum_attempts: 5 }, 1, "2026-04-12T00:00:00.000Z"),
    undefined,
  );
  assert.equal(
    computeNextRetryAt({ initial_interval_ms: 0 }, 1, "2026-04-12T00:00:00.000Z"),
    undefined,
  );
});

test("computeNextRetryAt applies exponential backoff with default coefficient 2", () => {
  const base = "2026-04-12T00:00:00.000Z";
  const policy = { initial_interval_ms: 1000 };
  // retry_count=1 → 1000ms × 2^0 = 1000ms
  assert.equal(computeNextRetryAt(policy, 1, base), "2026-04-12T00:00:01.000Z");
  // retry_count=2 → 1000ms × 2^1 = 2000ms
  assert.equal(computeNextRetryAt(policy, 2, base), "2026-04-12T00:00:02.000Z");
  // retry_count=3 → 1000ms × 2^2 = 4000ms
  assert.equal(computeNextRetryAt(policy, 3, base), "2026-04-12T00:00:04.000Z");
});

test("computeNextRetryAt honors a custom backoff_coefficient", () => {
  const base = "2026-04-12T00:00:00.000Z";
  const policy = { initial_interval_ms: 500, backoff_coefficient: 3 };
  // retry_count=1 → 500ms × 3^0 = 500ms
  assert.equal(computeNextRetryAt(policy, 1, base), "2026-04-12T00:00:00.500Z");
  // retry_count=2 → 500ms × 3^1 = 1500ms
  assert.equal(computeNextRetryAt(policy, 2, base), "2026-04-12T00:00:01.500Z");
});

test("scheduleRetry honors retry_policy.maximum_attempts over the legacy max_retries field", async (t) => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-retry-policy-attempts-"));
  t.after(() => cleanup(repoPath));
  const manager = new AssignmentManager(repoPath, "workflow-policy");
  const stateMachine = new AssignmentStateMachine(manager, {
    now: () => "2026-04-12T00:00:00.000Z",
  });
  // max_retries=1 (legacy budget = 1 retry) but maximum_attempts=3 → 2 retries.
  const assignment = manager.create({
    workbench_id: "workflow-policy",
    role: "dev",

    requested_agent_type: "claude",
    max_retries: 1,
    retry_policy: { maximum_attempts: 3 },
  });

  // First retry — allowed (retry_count goes 0 → 1).
  seedRun(manager, assignment.id, "run-1");
  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "ASSIGNMENT_TIMEOUT", message: "t1", stage: "test",
  });
  const first = await stateMachine.scheduleRetry(assignment.id);
  assert.equal(first.assignment.status, "pending");
  assert.equal(first.assignment.retry_count, 1);

  // Second retry — would have been blocked by max_retries=1 (legacy), but
  // the policy raises the ceiling so this is still allowed.
  seedRun(manager, assignment.id, "run-2");
  await stateMachine.claimPending(assignment.id, "tick-2");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-2", runId: "run-2" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "ASSIGNMENT_TIMEOUT", message: "t2", stage: "test",
  });
  const second = await stateMachine.scheduleRetry(assignment.id);
  assert.equal(second.assignment.status, "pending");
  assert.equal(second.assignment.retry_count, 2);

  // Third retry — exhausts maximum_attempts=3.
  seedRun(manager, assignment.id, "run-3");
  await stateMachine.claimPending(assignment.id, "tick-3");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-3", runId: "run-3" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "ASSIGNMENT_TIMEOUT", message: "t3", stage: "test",
  });
  const exhausted = await stateMachine.scheduleRetry(assignment.id);
  assert.equal(exhausted.assignment.status, "failed");
  assert.equal(exhausted.assignment.last_error?.code, "ASSIGNMENT_RETRY_LIMIT_EXCEEDED");
});

test("scheduleRetry stamps next_retry_at when initial_interval_ms is set", async (t) => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-retry-policy-backoff-"));
  t.after(() => cleanup(repoPath));
  const manager = new AssignmentManager(repoPath, "workflow-backoff");
  const stateMachine = new AssignmentStateMachine(manager, {
    now: () => "2026-04-12T00:00:00.000Z",
  });
  const assignment = manager.create({
    workbench_id: "workflow-backoff",
    role: "dev",

    requested_agent_type: "claude",
    max_retries: 5,
    retry_policy: { initial_interval_ms: 2000, backoff_coefficient: 2 },
  });

  seedRun(manager, assignment.id, "run-1");
  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "ASSIGNMENT_TIMEOUT", message: "t1", stage: "test",
  });
  const first = await stateMachine.scheduleRetry(assignment.id);
  // retry_count=1 → 2000ms × 2^0 = 2000ms
  assert.equal(first.assignment.next_retry_at, "2026-04-12T00:00:02.000Z");

  seedRun(manager, assignment.id, "run-2");
  await stateMachine.claimPending(assignment.id, "tick-2");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-2", runId: "run-2" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "ASSIGNMENT_TIMEOUT", message: "t2", stage: "test",
  });
  const second = await stateMachine.scheduleRetry(assignment.id);
  // retry_count=2 → 2000ms × 2^1 = 4000ms
  assert.equal(second.assignment.next_retry_at, "2026-04-12T00:00:04.000Z");
});

test("scheduleRetry fails immediately when last_error.code is in non_retryable_error_codes", async (t) => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-retry-policy-nonretry-"));
  t.after(() => cleanup(repoPath));
  const manager = new AssignmentManager(repoPath, "workflow-nonretry");
  const stateMachine = new AssignmentStateMachine(manager, {
    now: () => "2026-04-12T00:00:00.000Z",
  });
  const assignment = manager.create({
    workbench_id: "workflow-nonretry",
    role: "dev",

    requested_agent_type: "claude",
    max_retries: 5,
    retry_policy: {
      maximum_attempts: 10,
      non_retryable_error_codes: ["AGENT_REPORTED_ERROR"],
    },
  });

  seedRun(manager, assignment.id, "run-1");
  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  await stateMachine.markTimedOut(assignment.id, {
    code: "AGENT_REPORTED_ERROR",
    message: "agent said error",
    stage: "workflow.agent_error",
  });
  const result = await stateMachine.scheduleRetry(assignment.id);

  // Even though we have 9 attempts left in the budget, the non-retryable
  // error code short-circuits the retry decision and fails immediately.
  assert.equal(result.assignment.status, "failed");
  assert.equal(result.assignment.last_error?.code, "AGENT_REPORTED_ERROR");
  assert.equal(result.assignment.retry_count, 0);
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
