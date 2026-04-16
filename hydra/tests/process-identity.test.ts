import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { captureRunShellPid } from "../src/process-identity.ts";

function makeRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-process-identity-"));
}

function seedAssignment(manager: AssignmentManager, terminalId: string): string {
  const assignment = manager.create({
    workbench_id: "workflow-test",
    worktree_path: "/tmp/worktree",
    role: "dev",
    requested_agent_type: "claude",
    max_retries: 1,
  });
  assignment.runs.push({
    id: "run-1",
    terminal_id: terminalId,
    agent_type: "claude",
    prompt: "go",
    task_file: "task.md",
    result_file: "result.json",
    artifact_dir: "artifacts",
    status: "running",
    started_at: "2026-04-16T00:00:00.000Z",
  });
  assignment.active_run_id = "run-1";
  manager.save(assignment);
  return assignment.id;
}

test("captureRunShellPid persists shell_pid when telemetry returns one", () => {
  const repo = makeRepo();
  try {
    const manager = new AssignmentManager(repo, "workflow-test");
    const assignmentId = seedAssignment(manager, "terminal-xyz");

    captureRunShellPid(manager, assignmentId, "run-1", {
      telemetryTerminal: (id) => {
        assert.equal(id, "terminal-xyz");
        return { shell_pid: 4242 };
      },
      now: () => "2026-04-16T00:01:02.000Z",
    });

    const reloaded = manager.load(assignmentId)!;
    const run = reloaded.runs.find((r) => r.id === "run-1")!;
    assert.deepEqual(run.process_identity, {
      shell_pid: 4242,
      captured_at: "2026-04-16T00:01:02.000Z",
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("captureRunShellPid skips silently when telemetry returns null shell_pid", () => {
  // Shell has not yet spawned — telemetry snapshot exists but its shell_pid
  // is null. Recording process_identity with a null pid would tell the
  // reconcile pass "this run *has* an identity", which is misleading. The
  // helper must leave the field undefined instead.
  const repo = makeRepo();
  try {
    const manager = new AssignmentManager(repo, "workflow-test");
    const assignmentId = seedAssignment(manager, "terminal-xyz");

    captureRunShellPid(manager, assignmentId, "run-1", {
      telemetryTerminal: () => ({ shell_pid: null }),
    });

    const run = manager.load(assignmentId)!.runs[0];
    assert.equal(run.process_identity, undefined);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("captureRunShellPid swallows telemetry errors without failing dispatch", () => {
  // Dispatch must never fail because the telemetry probe threw — a network
  // flake or unreachable daemon would otherwise abort workflows mid-stride.
  // The helper catches, skips, and leaves process_identity untouched.
  const repo = makeRepo();
  try {
    const manager = new AssignmentManager(repo, "workflow-test");
    const assignmentId = seedAssignment(manager, "terminal-xyz");

    assert.doesNotThrow(() =>
      captureRunShellPid(manager, assignmentId, "run-1", {
        telemetryTerminal: () => {
          throw new Error("telemetry unreachable");
        },
      }),
    );

    const run = manager.load(assignmentId)!.runs[0];
    assert.equal(run.process_identity, undefined);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("captureRunShellPid is a no-op for unknown run ids", () => {
  const repo = makeRepo();
  try {
    const manager = new AssignmentManager(repo, "workflow-test");
    const assignmentId = seedAssignment(manager, "terminal-xyz");

    let telemetryCalls = 0;
    captureRunShellPid(manager, assignmentId, "run-does-not-exist", {
      telemetryTerminal: () => {
        telemetryCalls += 1;
        return { shell_pid: 1 };
      },
    });

    assert.equal(telemetryCalls, 0, "must not probe telemetry for a missing run");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
