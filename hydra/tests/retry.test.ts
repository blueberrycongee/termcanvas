import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { AssignmentStateMachine } from "../src/assignment/state-machine.ts";
import {
  hasAssignmentTimedOut,
  registerDispatchAttempt,
  retryTimedOutAssignment,
} from "../src/retry.ts";

function createFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-retry-"));
  const workflowId = "workflow-123";
  const manager = new AssignmentManager(repoPath, workflowId);
  const stateMachine = new AssignmentStateMachine(manager, {
    now: () => "2026-03-26T12:00:00.000Z",
  });

  const assignment = manager.create({
    id: "assignment-123",
    workflow_id: workflowId,
    role: "implementer",
    kind: "implementation",
    from_assignment_id: null,
    requested_agent_type: "codex",
    timeout_minutes: 1,
    max_retries: 1,
  });

  return {
    repoPath,
    workflowId,
    manager,
    stateMachine,
    assignment,
  };
}

function cleanupWorkspace(workspace: string): void {
  fs.rmSync(workspace, { recursive: true, force: true });
}

test("hasAssignmentTimedOut detects whether the timeout threshold has been crossed", async (t) => {
  const { repoPath, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanupWorkspace(repoPath));

  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  registerDispatchAttempt(manager, assignment.id, {
    runId: "run-1",
    terminalId: "terminal-1",
    agentType: "codex",
    prompt: "prompt-1",
    taskFile: "/repo/project/task.md",
    resultFile: "/repo/project/result.json",
    artifactDir: "/repo/project/artifacts",
    startedAt: "2026-03-26T12:00:00.000Z",
  });

  const loaded = manager.load(assignment.id);
  assert.ok(loaded);
  assert.equal(hasAssignmentTimedOut(loaded, "2026-03-26T12:00:30.000Z"), false);
  assert.equal(hasAssignmentTimedOut(loaded, "2026-03-26T12:01:01.000Z"), true);
});

test("retryTimedOutAssignment dispatches a new terminal and records retry_of_run_id on a new run", async (t) => {
  const { repoPath, workflowId, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanupWorkspace(repoPath));

  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  registerDispatchAttempt(manager, assignment.id, {
    runId: "run-1",
    terminalId: "terminal-1",
    agentType: "codex",
    prompt: "prompt-1",
    taskFile: "/repo/project/task.md",
    resultFile: "/repo/project/result.json",
    artifactDir: "/repo/project/artifacts",
    startedAt: "2026-03-26T12:00:00.000Z",
  });

  const result = await retryTimedOutAssignment(
    {
      assignmentId: assignment.id,
      timeoutCheckedAt: "2026-03-26T12:01:02.000Z",
      dispatchRequest: {
        workflowId,
        assignmentId: assignment.id,
        runId: "run-2",
        repoPath: "/repo/project",
        worktreePath: "/repo/project/.worktrees/hydra-1",
        agentType: "codex",
        taskFile: "/repo/project/task-2.md",
        resultFile: "/repo/project/result-2.json",
      },
      runId: "run-2",
      taskFile: "/repo/project/task-2.md",
      resultFile: "/repo/project/result-2.json",
      artifactDir: "/repo/project/artifacts-2",
    },
    {
      manager,
      stateMachine,
      dispatchCreateOnly: async () => ({
        projectId: "project-1",
        terminalId: "terminal-2",
        terminalType: "codex",
        terminalTitle: "Codex",
        prompt: "prompt-2",
      }),
      now: () => "2026-03-26T12:01:02.000Z",
    },
  );

  const updated = manager.load(assignment.id);
  assert.ok(updated);
  assert.equal(result.status, "retried");
  assert.equal(updated.status, "in_progress");
  assert.equal(updated.retry_count, 1);
  assert.equal(updated.active_run_id, "run-2");
  assert.equal(updated.runs.length, 2);
  assert.deepEqual(updated.runs[0], {
    id: "run-1",
    terminal_id: "terminal-1",
    agent_type: "codex",
    prompt: "prompt-1",
    task_file: "/repo/project/task.md",
    result_file: "/repo/project/result.json",
    artifact_dir: "/repo/project/artifacts",
    status: "timed_out",
    started_at: "2026-03-26T12:00:00.000Z",
    ended_at: "2026-03-26T12:00:00.000Z",
  });
  assert.deepEqual(updated.runs[1], {
    id: "run-2",
    terminal_id: "terminal-2",
    agent_type: "codex",
    prompt: "prompt-2",
    task_file: "/repo/project/task-2.md",
    result_file: "/repo/project/result-2.json",
    artifact_dir: "/repo/project/artifacts-2",
    status: "running",
    started_at: "2026-03-26T12:01:02.000Z",
    retry_of_run_id: "run-1",
  });
});

test("retryTimedOutAssignment converges to failed when the retry limit is exhausted", async (t) => {
  const { repoPath, workflowId, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanupWorkspace(repoPath));

  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  registerDispatchAttempt(manager, assignment.id, {
    runId: "run-1",
    terminalId: "terminal-1",
    agentType: "codex",
    prompt: "prompt-1",
    taskFile: "/repo/project/task.md",
    resultFile: "/repo/project/result.json",
    artifactDir: "/repo/project/artifacts",
    startedAt: "2026-03-26T12:00:00.000Z",
  });

  await retryTimedOutAssignment(
    {
      assignmentId: assignment.id,
      timeoutCheckedAt: "2026-03-26T12:01:02.000Z",
      dispatchRequest: {
        workflowId,
        assignmentId: assignment.id,
        runId: "run-2",
        repoPath: "/repo/project",
        worktreePath: "/repo/project/.worktrees/hydra-1",
        agentType: "codex",
        taskFile: "/repo/project/task-2.md",
        resultFile: "/repo/project/result-2.json",
      },
      runId: "run-2",
      taskFile: "/repo/project/task-2.md",
      resultFile: "/repo/project/result-2.json",
      artifactDir: "/repo/project/artifacts-2",
    },
    {
      manager,
      stateMachine,
      dispatchCreateOnly: async () => ({
        projectId: "project-1",
        terminalId: "terminal-2",
        terminalType: "codex",
        terminalTitle: "Codex",
        prompt: "prompt-2",
      }),
      now: () => "2026-03-26T12:01:02.000Z",
    },
  );

  const retried = manager.load(assignment.id);
  assert.ok(retried);
  retried.runs[1]!.started_at = "2026-03-26T12:01:02.000Z";
  manager.save(retried);

  const exhausted = await retryTimedOutAssignment(
    {
      assignmentId: assignment.id,
      timeoutCheckedAt: "2026-03-26T12:02:30.000Z",
      dispatchRequest: {
        workflowId,
        assignmentId: assignment.id,
        runId: "run-3",
        repoPath: "/repo/project",
        worktreePath: "/repo/project/.worktrees/hydra-1",
        agentType: "codex",
        taskFile: "/repo/project/task-3.md",
        resultFile: "/repo/project/result-3.json",
      },
      runId: "run-3",
      taskFile: "/repo/project/task-3.md",
      resultFile: "/repo/project/result-3.json",
      artifactDir: "/repo/project/artifacts-3",
    },
    {
      manager,
      stateMachine,
      dispatchCreateOnly: async () => {
        throw new Error("must not dispatch after retry limit");
      },
      now: () => "2026-03-26T12:02:30.000Z",
    },
  );

  const failed = manager.load(assignment.id);
  assert.ok(failed);
  assert.equal(exhausted.status, "failed");
  assert.equal(failed.status, "failed");
  assert.equal(failed.last_error?.code, "ASSIGNMENT_RETRY_LIMIT_EXCEEDED");
});

test("retryTimedOutAssignment does not dispatch when another controller claims the retry first", async (t) => {
  const { repoPath, workflowId, manager, stateMachine, assignment } = createFixture();
  t.after(() => cleanupWorkspace(repoPath));

  await stateMachine.claimPending(assignment.id, "tick-1");
  await stateMachine.markInProgress(assignment.id, { tickId: "tick-1", runId: "run-1" });
  registerDispatchAttempt(manager, assignment.id, {
    runId: "run-1",
    terminalId: "terminal-1",
    agentType: "codex",
    prompt: "prompt-1",
    taskFile: "/repo/project/task.md",
    resultFile: "/repo/project/result.json",
    artifactDir: "/repo/project/artifacts",
    startedAt: "2026-03-26T12:00:00.000Z",
  });

  const dispatchCalls: string[] = [];
  const originalClaimPending = stateMachine.claimPending.bind(stateMachine);
  stateMachine.claimPending = async (assignmentId, tickId) => {
    if (tickId.startsWith("retry:")) {
      return {
        changed: false,
        assignment: manager.load(assignmentId)!,
      };
    }
    return originalClaimPending(assignmentId, tickId);
  };

  const result = await retryTimedOutAssignment(
    {
      assignmentId: assignment.id,
      timeoutCheckedAt: "2026-03-26T12:01:02.000Z",
      dispatchRequest: {
        workflowId,
        assignmentId: assignment.id,
        runId: "run-2",
        repoPath: "/repo/project",
        worktreePath: "/repo/project/.worktrees/hydra-1",
        agentType: "codex",
        taskFile: "/repo/project/task-2.md",
        resultFile: "/repo/project/result-2.json",
      },
      runId: "run-2",
      taskFile: "/repo/project/task-2.md",
      resultFile: "/repo/project/result-2.json",
      artifactDir: "/repo/project/artifacts-2",
    },
    {
      manager,
      stateMachine,
      dispatchCreateOnly: async () => {
        dispatchCalls.push("dispatch");
        throw new Error("must not dispatch after ownership is lost");
      },
      now: () => "2026-03-26T12:01:02.000Z",
    },
  );

  const updated = manager.load(assignment.id);
  assert.ok(updated);
  assert.equal(result.status, "noop");
  assert.deepEqual(dispatchCalls, []);
  assert.equal(updated.status, "pending");
  assert.equal(updated.active_run_id, null);
  assert.equal(updated.runs.length, 1);
});
