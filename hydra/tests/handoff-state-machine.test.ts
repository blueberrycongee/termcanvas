import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";
import { HandoffStateMachine } from "../src/handoff/state-machine.ts";

function createFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-state-machine-"));
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
      title: "Implement the state machine",
      description: "Ensure dispatch is idempotent.",
      acceptance_criteria: ["No duplicate dispatches"],
    },
    context: {
      files: [],
      previous_handoffs: [],
    },
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

test("claimPending and markInProgress are idempotent for the same tick", async (t) => {
  const { workspace, manager, stateMachine, handoff } = createFixture();
  t.after(() => cleanupWorkspace(workspace));

  const firstClaim = await stateMachine.claimPending(handoff.id, "tick-1");
  const duplicateClaim = await stateMachine.claimPending(handoff.id, "tick-1");
  const firstInProgress = await stateMachine.markInProgress(handoff.id, {
    tickId: "tick-1",
    agentId: "codex-session-2",
  });
  const duplicateInProgress = await stateMachine.markInProgress(handoff.id, {
    tickId: "tick-1",
    agentId: "codex-session-2",
  });
  const persisted = manager.load(handoff.id);

  assert.equal(firstClaim.changed, true);
  assert.equal(duplicateClaim.changed, false);
  assert.equal(firstInProgress.changed, true);
  assert.equal(duplicateInProgress.changed, false);
  assert.equal(persisted?.status, "in_progress");
  assert.equal(persisted?.to.agent_id, "codex-session-2");
  assert.equal(persisted?.claim?.tick_id, "tick-1");
});

test("markCompleted rejects invalid transitions from pending", async (t) => {
  const { workspace, stateMachine, handoff } = createFixture();
  t.after(() => cleanupWorkspace(workspace));

  await assert.rejects(
    () =>
      stateMachine.markCompleted(handoff.id, {
        success: true,
        message: "done",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "HANDOFF_INVALID_TRANSITION");
      assert.match(error.message, /pending/);
      return true;
    },
  );
});

test("scheduleRetry returns timed out handoffs to pending and fails at the retry limit", async (t) => {
  const { workspace, manager, stateMachine, handoff } = createFixture();
  t.after(() => cleanupWorkspace(workspace));

  await stateMachine.claimPending(handoff.id, "tick-1");
  await stateMachine.markInProgress(handoff.id, {
    tickId: "tick-1",
    agentId: "codex-session-2",
  });
  await stateMachine.markTimedOut(handoff.id, {
    code: "HANDOFF_TIMEOUT",
    message: "first timeout",
    stage: "dispatcher.watch",
  });

  const scheduled = await stateMachine.scheduleRetry(handoff.id);
  const retried = manager.load(handoff.id);

  assert.equal(scheduled.changed, true);
  assert.equal(retried?.status, "pending");
  assert.equal(retried?.retry_count, 1);
  assert.equal(retried?.to.agent_id, null);
  assert.equal(retried?.claim, undefined);

  await stateMachine.claimPending(handoff.id, "tick-2");
  await stateMachine.markInProgress(handoff.id, {
    tickId: "tick-2",
    agentId: "codex-session-3",
  });
  await stateMachine.markTimedOut(handoff.id, {
    code: "HANDOFF_TIMEOUT",
    message: "second timeout",
    stage: "dispatcher.watch",
  });

  const exhausted = await stateMachine.scheduleRetry(handoff.id);
  const failed = manager.load(handoff.id);

  assert.equal(exhausted.changed, true);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.retry_count, 1);
  assert.equal(failed?.last_error?.code, "HANDOFF_RETRY_LIMIT_EXCEEDED");
});

test("concurrent duplicate claimPending calls only claim the handoff once", async (t) => {
  const { workspace, manager, stateMachine, handoff } = createFixture();
  t.after(() => cleanupWorkspace(workspace));

  const [first, second] = await Promise.all([
    stateMachine.claimPending(handoff.id, "tick-dup"),
    stateMachine.claimPending(handoff.id, "tick-dup"),
  ]);
  const persisted = manager.load(handoff.id);
  const changedCount = [first, second].filter((result) => result.changed).length;

  assert.equal(changedCount, 1);
  assert.equal(persisted?.status, "claimed");
  assert.equal(persisted?.claim?.tick_id, "tick-dup");
});
