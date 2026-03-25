import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";
import { HandoffStateMachine } from "../src/handoff/state-machine.ts";
import {
  hasHandoffTimedOut,
  registerDispatchAttempt,
  retryTimedOutHandoff,
} from "../src/retry.ts";

function createFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-retry-"));
  const manager = new HandoffManager(workspace);
  const stateMachine = new HandoffStateMachine(manager, {
    now: () => "2026-03-26T12:00:00.000Z",
  });

  const handoff = manager.create({
    workflow_id: "workflow-123",
    from: { role: "planner", agent_type: "claude", agent_id: "claude-1" },
    to: { role: "implementer", agent_type: "codex", agent_id: null },
    task: {
      type: "implement-feature",
      title: "Retry timeout handling",
      description: "Ensure timed out dispatches are retried.",
      acceptance_criteria: ["Retry timed out attempts"],
    },
    context: {
      files: [],
      previous_handoffs: [],
    },
    timeout_minutes: 1,
    max_retries: 1,
  });

  return {
    workspace,
    manager,
    stateMachine,
    handoff,
  };
}

function cleanupWorkspace(workspace: string): void {
  fs.rmSync(workspace, { recursive: true, force: true });
}

test("hasHandoffTimedOut detects whether the timeout threshold has been crossed", async (t) => {
  const { workspace, manager, stateMachine, handoff } = createFixture();
  t.after(() => cleanupWorkspace(workspace));

  await stateMachine.claimPending(handoff.id, "tick-1");
  await stateMachine.markInProgress(handoff.id, { tickId: "tick-1" });

  const loaded = manager.load(handoff.id);
  assert.equal(hasHandoffTimedOut(loaded!, "2026-03-26T12:00:30.000Z"), false);
  assert.equal(hasHandoffTimedOut(loaded!, "2026-03-26T12:01:01.000Z"), true);
});

test("retryTimedOutHandoff dispatches a new terminal and records retry_of", async (t) => {
  const { workspace, manager, stateMachine, handoff } = createFixture();
  t.after(() => cleanupWorkspace(workspace));

  await stateMachine.claimPending(handoff.id, "tick-1");
  await stateMachine.markInProgress(handoff.id, { tickId: "tick-1" });
  registerDispatchAttempt(manager, handoff.id, {
    terminalId: "terminal-1",
    agentType: "codex",
    prompt: "prompt-1",
    startedAt: "2026-03-26T12:00:00.000Z",
  });

  const result = await retryTimedOutHandoff(
    {
      handoffId: handoff.id,
      timeoutCheckedAt: "2026-03-26T12:01:02.000Z",
      dispatchRequest: {
        workflowId: handoff.workflow_id,
        handoffId: handoff.id,
        repoPath: "/repo/project",
        worktreePath: "/repo/project/.worktrees/hydra-1",
        agentType: "codex",
        taskFile: "/repo/project/task.md",
        resultFile: "/repo/project/result.json",
      },
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

  const updated = manager.load(handoff.id);

  assert.equal(result.status, "retried");
  assert.equal(updated?.status, "in_progress");
  assert.equal(updated?.retry_count, 1);
  assert.equal(updated?.dispatch?.active_terminal_id, "terminal-2");
  assert.equal(updated?.dispatch?.attempts.length, 2);
  assert.deepEqual(updated?.dispatch?.attempts[1], {
    attempt: 2,
    terminal_id: "terminal-2",
    agent_type: "codex",
    prompt: "prompt-2",
    started_at: "2026-03-26T12:01:02.000Z",
    retry_of: "terminal-1",
  });
});

test("retryTimedOutHandoff converges to failed when the retry limit is exhausted", async (t) => {
  const { workspace, manager, stateMachine, handoff } = createFixture();
  t.after(() => cleanupWorkspace(workspace));

  await stateMachine.claimPending(handoff.id, "tick-1");
  await stateMachine.markInProgress(handoff.id, { tickId: "tick-1" });
  registerDispatchAttempt(manager, handoff.id, {
    terminalId: "terminal-1",
    agentType: "codex",
    prompt: "prompt-1",
    startedAt: "2026-03-26T12:00:00.000Z",
  });

  await retryTimedOutHandoff(
    {
      handoffId: handoff.id,
      timeoutCheckedAt: "2026-03-26T12:01:02.000Z",
      dispatchRequest: {
        workflowId: handoff.workflow_id,
        handoffId: handoff.id,
        repoPath: "/repo/project",
        worktreePath: "/repo/project/.worktrees/hydra-1",
        agentType: "codex",
        taskFile: "/repo/project/task.md",
        resultFile: "/repo/project/result.json",
      },
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

  const retried = manager.load(handoff.id)!;
  retried.status_updated_at = "2026-03-26T12:01:02.000Z";
  manager.save(retried);

  const exhausted = await retryTimedOutHandoff(
    {
      handoffId: handoff.id,
      timeoutCheckedAt: "2026-03-26T12:02:30.000Z",
      dispatchRequest: {
        workflowId: handoff.workflow_id,
        handoffId: handoff.id,
        repoPath: "/repo/project",
        worktreePath: "/repo/project/.worktrees/hydra-1",
        agentType: "codex",
        taskFile: "/repo/project/task.md",
        resultFile: "/repo/project/result.json",
      },
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

  const failed = manager.load(handoff.id);

  assert.equal(exhausted.status, "failed");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.last_error?.code, "HANDOFF_RETRY_LIMIT_EXCEEDED");
});
