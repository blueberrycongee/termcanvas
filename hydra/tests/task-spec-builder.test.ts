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
import { writeNodeFeedback, writeNodeIntent, writeWorkflowIntent } from "../src/artifacts.ts";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-taskspec-"));
}

function setupWorkflow(repoPath: string, intent: string): string {
  const intentAbs = writeWorkflowIntent(repoPath, "workflow-test", intent);
  return path.relative(repoPath, intentAbs);
}

function makeWorkflow(repoPath: string, overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
    id: "workflow-test",
    lead_terminal_id: "terminal-lead",
    intent_file: "inputs/intent.md",
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

function setupNode(repoPath: string, nodeId: string, role: string, intent: string): string {
  const abs = writeNodeIntent(repoPath, "workflow-test", nodeId, role, intent);
  return path.relative(repoPath, abs);
}

function makeNode(repoPath: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  const id = overrides.id ?? "test-node";
  const role = overrides.role ?? "claude-implementer";
  const intentFile = overrides.intent_file ?? setupNode(repoPath, id, role, "Implement feature X");
  return {
    id,
    role,
    depends_on: overrides.depends_on ?? [],
    agent_type: overrides.agent_type ?? "claude",
    intent_file: intentFile,
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    schema_version: "hydra/assignment-state/v0.1",
    id: "assignment-test",
    workflow_id: "workflow-test",
    created_at: "2026-04-09T00:00:00.000Z",
    updated_at: "2026-04-09T00:00:00.000Z",
    role: "claude-implementer",
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

test("buildTaskSpecFromIntent produces valid RunTaskSpec for claude-implementer", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test workflow intent");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode(repoPath, { role: "claude-implementer" }),
      assignment: makeAssignment({ role: "claude-implementer" }),
      runId: "run-001",
    });

    assert.equal(spec.role, "claude-implementer");
    assert.equal(spec.agentType, "claude");
    assert.equal(spec.workflowId, "workflow-test");
    assert.equal(spec.assignmentId, "assignment-test");
    assert.equal(spec.runId, "run-001");
    assert.ok(spec.objective.some((line) => line.includes("Implement")));
    assert.ok(spec.readFiles.some((f) => f.label === "Workflow intent"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Result JSON"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Report"));
    // Role body comes from the registry, decisionRules from the role frontmatter.
    assert.ok(spec.roleBody && spec.roleBody.length > 0);
    assert.ok(spec.decisionRules.some((r) => /implementation problem|silent fallbacks/i.test(r)));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent surfaces researcher briefing via the role body for claude-researcher", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test");
    const node = makeNode(repoPath, {
      id: "researcher",
      role: "claude-researcher",
      intent_file: setupNode(repoPath, "researcher", "claude-researcher", "Analyze auth options"),
    });

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node,
      assignment: makeAssignment({ role: "claude-researcher" }),
      runId: "run-001",
    });

    // Researcher framing now lives in the role body, not in the objective prefix
    // or an extraSections "Research Strategy" entry.
    assert.ok(spec.roleBody && /research brief/i.test(spec.roleBody));
    assert.ok(spec.roleBody && /Research Strategy/.test(spec.roleBody));
    assert.ok(spec.decisionRules.some((r) => r.toLowerCase().includes("codebase")));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent includes context_refs in readFiles", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test");
    const contextFile = path.join(repoPath, "context.md");
    fs.writeFileSync(contextFile, "# Context\n", "utf-8");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode(repoPath, { context_refs: [{ label: "Research brief", path: contextFile }] }),
      assignment: makeAssignment(),
      runId: "run-001",
    });

    assert.ok(spec.readFiles.some((f) => f.label === "Research brief" && f.path === contextFile));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent reads feedback file when feedback_file is set", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test");
    const feedbackAbs = writeNodeFeedback(repoPath, "workflow-test", "test-node", "Tests fail on edge case X");
    const feedbackRel = path.relative(repoPath, feedbackAbs);

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode(repoPath, { feedback_file: feedbackRel }),
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

test("buildTaskSpecFromIntent includes result contract section with schema version", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode(repoPath),
      assignment: makeAssignment(),
      runId: "run-001",
    });

    const contractSection = spec.extraSections?.find((s) => s.title === "Result Contract");
    assert.ok(contractSection, "should include Result Contract section");
    assert.ok(contractSection!.lines.some((l) => l.includes(RESULT_SCHEMA_VERSION)));
    assert.ok(contractSection!.lines.some((l) => l.includes("outcome")));
    assert.ok(contractSection!.lines.some((l) => l.includes("report_file")));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent fails fast when the role is not in the registry", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test");

    assert.throws(
      () =>
        buildTaskSpecFromIntent({
          workflow: makeWorkflow(repoPath),
          node: makeNode(repoPath, { role: "custom-checker" }),
          assignment: makeAssignment({ role: "custom-checker" }),
          runId: "run-001",
        }),
      /custom-checker/,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent always includes Report and Result write targets", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test");

    const spec = buildTaskSpecFromIntent({
      workflow: makeWorkflow(repoPath),
      node: makeNode(repoPath),
      assignment: makeAssignment(),
      runId: "run-001",
    });

    // Both report and result are always required regardless of role
    assert.ok(spec.writeTargets.some((t) => t.label === "Report"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Result JSON"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
