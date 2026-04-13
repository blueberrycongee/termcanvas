import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTaskSpecFromIntent } from "../src/task-spec-builder.ts";
import { WORKBENCH_STATE_SCHEMA_VERSION } from "../src/workflow-store.ts";
import type { WorkbenchRecord, Dispatch } from "../src/workflow-store.ts";
import type { AssignmentRecord } from "../src/assignment/types.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { writeDispatchFeedback, writeDispatchIntent, writeWorkbenchIntent } from "../src/artifacts.ts";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-taskspec-"));
}

function setupWorkflow(repoPath: string, intent: string): string {
  const intentAbs = writeWorkbenchIntent(repoPath, "workflow-test", intent);
  return path.relative(repoPath, intentAbs);
}

function makeWorkbench(repoPath: string, overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    schema_version: WORKBENCH_STATE_SCHEMA_VERSION,
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
    dispatches: {},
    default_timeout_minutes: 30,
    default_max_retries: 1,
    auto_approve: true,
    ...overrides,
  };
}

function setupDispatch(repoPath: string, dispatchId: string, role: string, intent: string): string {
  const abs = writeDispatchIntent(repoPath, "workflow-test", dispatchId, role, intent);
  return path.relative(repoPath, abs);
}

function makeDispatch(repoPath: string, overrides: Partial<Dispatch> = {}): Dispatch {
  const id = overrides.id ?? "test-node";
  const role = overrides.role ?? "dev";
  const intentFile = overrides.intent_file ?? setupDispatch(repoPath, id, role, "Implement feature X");
  return {
    id,
    role,
    agent_type: overrides.agent_type ?? "claude",
    status: overrides.status ?? "dispatched",
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
    role: "dev",
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

test("buildTaskSpecFromIntent produces valid RunTaskSpec for dev", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test workflow intent");

    const spec = buildTaskSpecFromIntent({
      workbench: makeWorkbench(repoPath),
      dispatch: makeDispatch(repoPath, { role: "dev" }),
      assignment: makeAssignment({ role: "dev" }),
      runId: "run-001",
    });

    assert.equal(spec.role, "dev");
    assert.equal(spec.agentType, "claude");
    assert.equal(spec.workbenchId, "workflow-test");
    assert.equal(spec.assignmentId, "assignment-test");
    assert.equal(spec.runId, "run-001");
    assert.ok(spec.objective.some((line) => line.includes("Implement")));
    assert.ok(spec.readFiles.some((f) => f.label === "Workflow intent"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Result JSON"));
    assert.ok(spec.writeTargets.some((t) => t.label === "Report"));
    // Role-specific rules now live in the role body (markdown), not in decisionRules.
    assert.ok(spec.roleBody && spec.roleBody.length > 0);
    assert.ok(/implementation problem|silent fallbacks/i.test(spec.roleBody));
    // decisionRules contains only Hydra operational rules (outcome guidance).
    assert.ok(spec.decisionRules.some((r) => /outcome=completed/i.test(r)));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("buildTaskSpecFromIntent surfaces reviewer briefing via the role body", () => {
  const repoPath = makeTmpDir();
  try {
    setupWorkflow(repoPath, "Test");
    const disp = makeDispatch(repoPath, {
      id: "review",
      role: "reviewer",
      intent_file: setupDispatch(repoPath, "review", "reviewer", "Review the implementation"),
    });

    const spec = buildTaskSpecFromIntent({
      workbench: makeWorkbench(repoPath),
      dispatch: disp,
      assignment: makeAssignment({ role: "reviewer" }),
      runId: "run-001",
    });

    // Reviewer framing lives in the role body (additive briefing), not in
    // an objective prefix or extraSections.
    assert.ok(spec.roleBody && /reviewer/i.test(spec.roleBody));
    // "independent judgment" rule now lives in the role body, not decisionRules.
    assert.ok(/independent judgment/i.test(spec.roleBody));
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
      workbench: makeWorkbench(repoPath),
      dispatch: makeDispatch(repoPath, { context_refs: [{ label: "Research brief", path: contextFile }] }),
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
    const feedbackAbs = writeDispatchFeedback(repoPath, "workflow-test", "test-node", "Tests fail on edge case X");
    const feedbackRel = path.relative(repoPath, feedbackAbs);

    const spec = buildTaskSpecFromIntent({
      workbench: makeWorkbench(repoPath),
      dispatch: makeDispatch(repoPath, { feedback_file: feedbackRel }),
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
      workbench: makeWorkbench(repoPath),
      dispatch: makeDispatch(repoPath),
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
          workbench: makeWorkbench(repoPath),
          dispatch: makeDispatch(repoPath, { role: "custom-checker" }),
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
      workbench: makeWorkbench(repoPath),
      dispatch: makeDispatch(repoPath),
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
