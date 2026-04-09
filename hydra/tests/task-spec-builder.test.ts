import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTaskSpecFromIntent } from "../src/task-spec-builder.ts";
import { WORKFLOW_STATE_SCHEMA_VERSION } from "../src/workflow-store.ts";
import type { WorkflowRecord, WorkflowNode } from "../src/workflow-store.ts";
import type { AssignmentRecord } from "../src/assignment/types.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-taskspec-"));
}

function makeWorkflow(repoPath: string, overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
    id: "workflow-test",
    intent: "Test task",
    repo_path: repoPath,
    worktree_path: repoPath,
    branch: null,
    base_branch: "main",
    own_worktree: false,
    created_at: "2026-04-09T00:00:00.000Z",
    updated_at: "2026-04-09T00:00:00.000Z",
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

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "test-node",
    role: "implementer",
    depends_on: [],
    agent_type: "claude",
    intent: "Implement feature X",
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    schema_version: "hydra/assignment-state/v3",
    id: "assignment-test",
    workflow_id: "workflow-test",
    created_at: "2026-04-09T00:00:00.000Z",
    updated_at: "2026-04-09T00:00:00.000Z",
    role: "implementer",
    from_assignment_id: null,
    requested_agent_type: "claude",
    status: "pending",
    retry_count: 0,
    max_retries: 1,
    active_run_id: null,
    runs: [],
    ...overrides,
  } as AssignmentRecord;
}

test("buildTaskSpecFromIntent produces valid RunTaskSpec for implementer", () => {
  const repoPath = makeTmpDir();
  try {
    // Create user-request.md so readFiles resolves
    const inputsDir = path.join(repoPath, ".hydra", "workflows", "workflow-test", "inputs");
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.writeFileSync(path.join(inputsDir, "user-request.md"), "# Test request\n", "utf-8");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode({ role: "implementer", intent: "Add OAuth login" }),
      assignment: makeAssignment({ role: "implementer" }),
      runId: "run-001",
    });

    assert.equal(spec.role, "implementer");
    assert.equal(spec.workflowId, "workflow-test");
    assert.equal(spec.assignmentId, "assignment-test");
    assert.equal(spec.runId, "run-001");
    assert.ok(spec.objective.some((line) => line.includes("Add OAuth login")));
    assert.ok(spec.objective.some((line) => line.includes("Implement")));
    assert.ok(spec.readFiles.some((f) => f.label === "User request"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Result JSON"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Brief"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent uses researcher framing for researcher role", () => {
  const repoPath = makeTmpDir();
  try {
    const inputsDir = path.join(repoPath, ".hydra", "workflows", "workflow-test", "inputs");
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.writeFileSync(path.join(inputsDir, "user-request.md"), "# Test\n", "utf-8");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode({ role: "researcher", intent: "Analyze auth options" }),
      assignment: makeAssignment({ role: "researcher" }),
      runId: "run-001",
    });

    assert.ok(spec.objective.some((line) => line.includes("research brief")));
    assert.ok(spec.decisionRules.some((r) => r.includes("codebase")));
    assert.ok(spec.extraSections?.some((s) => s.title === "Research Strategy"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent includes context_refs in readFiles", () => {
  const repoPath = makeTmpDir();
  try {
    const inputsDir = path.join(repoPath, ".hydra", "workflows", "workflow-test", "inputs");
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.writeFileSync(path.join(inputsDir, "user-request.md"), "# Test\n", "utf-8");

    const contextFile = path.join(repoPath, "context.md");
    fs.writeFileSync(contextFile, "# Context\n", "utf-8");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode({ context_refs: [{ label: "Research brief", path: contextFile }] }),
      assignment: makeAssignment(),
      runId: "run-001",
    });

    assert.ok(spec.readFiles.some((f) => f.label === "Research brief" && f.path === contextFile));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent writes feedback file when feedback is set", () => {
  const repoPath = makeTmpDir();
  try {
    const inputsDir = path.join(repoPath, ".hydra", "workflows", "workflow-test", "inputs");
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.writeFileSync(path.join(inputsDir, "user-request.md"), "# Test\n", "utf-8");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode({ feedback: "Tests fail on edge case X" }),
      assignment: makeAssignment(),
      runId: "run-001",
    });

    const feedbackRef = spec.readFiles.find((f) => f.label === "Feedback from Lead");
    assert.ok(feedbackRef, "should include feedback in readFiles");
    assert.ok(fs.existsSync(feedbackRef!.path), "feedback file should exist");
    const content = fs.readFileSync(feedbackRef!.path, "utf-8");
    assert.ok(content.includes("Tests fail on edge case X"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent includes result contract section mentioning v2", () => {
  const repoPath = makeTmpDir();
  try {
    const inputsDir = path.join(repoPath, ".hydra", "workflows", "workflow-test", "inputs");
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.writeFileSync(path.join(inputsDir, "user-request.md"), "# Test\n", "utf-8");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode(),
      assignment: makeAssignment(),
      runId: "run-001",
    });

    const contractSection = spec.extraSections?.find((s) => s.title === "Result Contract");
    assert.ok(contractSection, "should include Result Contract section");
    assert.ok(contractSection!.lines.some((l) => l.includes(RESULT_SCHEMA_VERSION)));
    assert.ok(contractSection!.lines.some((l) => l.includes("intent")));
    assert.ok(contractSection!.lines.some((l) => l.includes("reflection")));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent omits brief for unknown roles", () => {
  const repoPath = makeTmpDir();
  try {
    const inputsDir = path.join(repoPath, ".hydra", "workflows", "workflow-test", "inputs");
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.writeFileSync(path.join(inputsDir, "user-request.md"), "# Test\n", "utf-8");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode({ role: "custom-checker" }),
      assignment: makeAssignment({ role: "custom-checker" }),
      runId: "run-001",
    });

    assert.ok(!spec.writeTargets.some((t) => t.label === "Brief"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Result JSON"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
