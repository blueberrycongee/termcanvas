import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";

function createManager(): { manager: HandoffManager; workspace: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-handoff-"));
  return {
    manager: new HandoffManager(workspace),
    workspace,
  };
}

function cleanupWorkspace(workspace: string): void {
  fs.rmSync(workspace, { recursive: true, force: true });
}

test("HandoffManager creates the handoff directory", (t) => {
  const { workspace } = createManager();
  t.after(() => cleanupWorkspace(workspace));

  const handoffsDir = path.join(workspace, ".hydra", "handoffs");
  assert.equal(fs.existsSync(handoffsDir), true);
});

test("HandoffManager creates a handoff", (t) => {
  const { manager, workspace } = createManager();
  t.after(() => cleanupWorkspace(workspace));

  const handoff = manager.create({
    workflow_id: "test-workflow",
    from: {
      role: "planner",
      agent_type: "claude",
      agent_id: "claude-1",
    },
    to: {
      role: "implementer",
      agent_type: "codex",
      agent_id: null,
    },
    task: {
      type: "implement-feature",
      title: "Test task",
      description: "Test description",
      acceptance_criteria: ["Criterion 1"],
    },
    context: {
      files: [],
      previous_handoffs: [],
    },
    max_retries: 2,
  });

  assert.match(handoff.id, /^handoff-[a-f0-9]{12}$/);
  assert.equal(handoff.status, "pending");
  assert.equal(handoff.retry_count, 0);
});

test("HandoffManager loads a handoff", (t) => {
  const { manager, workspace } = createManager();
  t.after(() => cleanupWorkspace(workspace));

  const created = manager.create({
    workflow_id: "test-workflow",
    from: { role: "planner", agent_type: "claude", agent_id: "claude-1" },
    to: { role: "implementer", agent_type: "codex", agent_id: null },
    task: {
      type: "implement-feature",
      title: "Test",
      description: "Test",
      acceptance_criteria: [],
    },
    context: { files: [], previous_handoffs: [] },
    max_retries: 2,
  });

  const loaded = manager.load(created.id);
  assert.notEqual(loaded, null);
  assert.equal(loaded?.id, created.id);
});

test("HandoffManager updates handoff status", (t) => {
  const { manager, workspace } = createManager();
  t.after(() => cleanupWorkspace(workspace));

  const handoff = manager.create({
    workflow_id: "test-workflow",
    from: { role: "planner", agent_type: "claude", agent_id: "claude-1" },
    to: { role: "implementer", agent_type: "codex", agent_id: null },
    task: {
      type: "implement-feature",
      title: "Test",
      description: "Test",
      acceptance_criteria: [],
    },
    context: { files: [], previous_handoffs: [] },
    max_retries: 2,
  });

  manager.updateStatus(handoff.id, "in_progress");
  const updated = manager.load(handoff.id);
  assert.equal(updated?.status, "in_progress");
});

test("HandoffManager lists pending handoffs", (t) => {
  const { manager, workspace } = createManager();
  t.after(() => cleanupWorkspace(workspace));

  manager.create({
    workflow_id: "wf-1",
    from: { role: "planner", agent_type: "claude", agent_id: "c1" },
    to: { role: "implementer", agent_type: "codex", agent_id: null },
    task: { type: "test", title: "T1", description: "D1", acceptance_criteria: [] },
    context: { files: [], previous_handoffs: [] },
    max_retries: 2,
  });

  const pending = manager.listPending();
  assert.equal(pending.length, 1);
});
