import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectTaskPackage,
  writeDoneMarker,
  writeResultContract,
} from "../src/collector.ts";
import { buildTaskPackageContext, writeTaskPackage } from "../src/task-package.ts";

function createTaskPackageRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-collector-"));
}

function createContract(rootDir: string) {
  const context = buildTaskPackageContext({
    workspaceRoot: rootDir,
    workflowId: "workflow-auth",
    handoffId: "handoff-abc123",
    createdAt: "2026-03-26T12:00:00.000Z",
    from: {
      role: "planner",
      agent_type: "claude",
      agent_id: "claude-session-1",
    },
    to: {
      role: "implementer",
      agent_type: "codex",
      agent_id: null,
    },
    task: {
      type: "implement-feature",
      title: "Implement collector",
      description: "Read result.json and done.",
      acceptance_criteria: ["Reject invalid results"],
    },
    context: {
      files: [],
      previous_handoffs: [],
    },
  });

  writeTaskPackage(context.contract);
  return context.contract;
}

test("collectTaskPackage returns completed when done and result are both valid", () => {
  const rootDir = createTaskPackageRoot();

  try {
    const contract = createContract(rootDir);
    writeResultContract(contract, {
      version: "hydra/v2",
      handoff_id: contract.handoff_id,
      workflow_id: contract.workflow_id,
      success: true,
      summary: "Implemented the collector flow.",
      outputs: [{ path: "hydra/src/collector.ts", description: "Collector implementation" }],
      evidence: ["npm test"],
      next_action: { type: "complete", reason: "No more work required." },
    });
    writeDoneMarker(contract);

    const collected = collectTaskPackage(contract);

    assert.equal(collected.status, "completed");
    assert.equal(collected.result?.summary, "Implemented the collector flow.");
    assert.equal(collected.advance, true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("collectTaskPackage returns waiting when done is missing", () => {
  const rootDir = createTaskPackageRoot();

  try {
    const contract = createContract(rootDir);
    writeResultContract(contract, {
      version: "hydra/v2",
      handoff_id: contract.handoff_id,
      workflow_id: contract.workflow_id,
      success: true,
      summary: "Implemented the collector flow.",
      outputs: [{ path: "hydra/src/collector.ts", description: "Collector implementation" }],
      evidence: ["npm test"],
      next_action: { type: "complete", reason: "No more work required." },
    });

    const collected = collectTaskPackage(contract);

    assert.deepEqual(collected, {
      status: "waiting",
      advance: false,
      reason: "done_missing",
    });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("collectTaskPackage fails when done exists but result.json is missing", () => {
  const rootDir = createTaskPackageRoot();

  try {
    const contract = createContract(rootDir);
    writeDoneMarker(contract);

    const collected = collectTaskPackage(contract);

    assert.equal(collected.status, "failed");
    assert.equal(collected.advance, false);
    assert.equal(collected.failure?.code, "COLLECTOR_RESULT_MISSING");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("collectTaskPackage fails when result.json does not satisfy the schema", () => {
  const rootDir = createTaskPackageRoot();

  try {
    const contract = createContract(rootDir);
    fs.writeFileSync(
      contract.artifacts.result_file,
      JSON.stringify({
        version: "hydra/v2",
        handoff_id: contract.handoff_id,
        workflow_id: contract.workflow_id,
        success: "yes",
      }, null, 2),
      "utf-8",
    );
    writeDoneMarker(contract);

    const collected = collectTaskPackage(contract);

    assert.equal(collected.status, "failed");
    assert.equal(collected.advance, false);
    assert.equal(collected.failure?.code, "COLLECTOR_RESULT_INVALID");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
