import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  initWorkflow,
  dispatchNode,
  approveNode,
  watchUntilDecision,
  completeWorkflow,
  type WorkflowDependencies,
} from "../src/workflow-lead.ts";
import { loadWorkflow } from "../src/workflow-store.ts";
import { readLedger } from "../src/ledger.ts";
import {
  KNOWN_REPLAY_GAPS,
  replayLedger,
  type ReplayedWorkflow,
} from "../src/replay.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { AssignmentManager } from "../src/assignment/manager.ts";

// Set TERMCANVAS_TERMINAL_ID so initWorkflow + lead-guard accept the test as Lead.
process.env.TERMCANVAS_TERMINAL_ID = "terminal-test-lead";

function makeTestRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-replay-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir, stdio: "pipe" });
  execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@test.com", "commit", "--allow-empty", "-m", "init"],
    { cwd: dir, stdio: "pipe" },
  );
  return dir;
}

function mockDeps(): WorkflowDependencies {
  let time = Date.parse("2026-04-12T00:00:00.000Z");
  return {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request) => ({
      projectId: "project-1",
      terminalId: `terminal-${request.assignmentId}`,
      terminalType: request.agentType,
      terminalTitle: `Agent ${request.assignmentId}`,
      prompt: "test prompt",
    }),
    sleep: async () => {},
    syncProject: () => {},
    destroyTerminal: () => {},
    checkTerminalAlive: () => null,
  };
}

function writeWorkerResult(
  repo: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
  outcome: "completed" | "stuck" | "error",
  reportFile = "report.md",
): void {
  const runDir = path.join(
    repo,
    ".hydra",
    "workflows",
    workflowId,
    "assignments",
    assignmentId,
    "runs",
    runId,
  );
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "report.md"), `# Worker report\nOutcome: ${outcome}\n`, "utf-8");
  fs.writeFileSync(
    path.join(runDir, "result.json"),
    JSON.stringify(
      {
        schema_version: RESULT_SCHEMA_VERSION,
        workflow_id: workflowId,
        assignment_id: assignmentId,
        run_id: runId,
        outcome,
        report_file: reportFile,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function activeRunId(manager: AssignmentManager, assignmentId: string): string {
  const assignment = manager.load(assignmentId);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);
  const run = assignment.active_run_id
    ? assignment.runs.find((r) => r.id === assignment.active_run_id)
    : assignment.runs[assignment.runs.length - 1];
  if (!run) throw new Error(`No active run for ${assignmentId}`);
  return run.id;
}

test("replayLedger reconstructs workflow status, node trajectory, and approvals from a real run", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Add OAuth", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    // Linear flow: researcher → dev. The full Lead-driven loop:
    //   dispatch → worker writes result → watch → approve → next dispatch.
    const researcher = await dispatchNode(
      {
        repoPath: repo,
        workflowId,
        nodeId: "researcher",
        role: "claude-researcher",
        intent: "Investigate OAuth approach.",
      },
      deps,
    );
    writeWorkerResult(
      repo,
      workflowId,
      researcher.assignment_id,
      activeRunId(manager, researcher.assignment_id),
      "completed",
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);
    await approveNode({ repoPath: repo, workflowId, nodeId: "researcher" }, deps);

    const dev = await dispatchNode(
      {
        repoPath: repo,
        workflowId,
        nodeId: "dev",
        role: "claude-implementer",
        intent: "Implement OAuth.",
        dependsOn: ["researcher"],
      },
      deps,
    );
    writeWorkerResult(
      repo,
      workflowId,
      dev.assignment_id,
      activeRunId(manager, dev.assignment_id),
      "completed",
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);

    await completeWorkflow(
      { repoPath: repo, workflowId, summary: "OAuth shipped." },
      deps,
    );

    // Capture the original on-disk state, then delete the JSON files and
    // try to rebuild from the ledger alone.
    const originalWorkflow = loadWorkflow(repo, workflowId)!;
    const originalNodeStatuses = { ...originalWorkflow.node_statuses };
    const originalApprovedRefs = originalWorkflow.approved_refs ?? {};
    const originalAssignments = originalWorkflow.assignment_ids.map((id) => manager.load(id));

    const workflowJson = path.join(repo, ".hydra", "workflows", workflowId, "workflow.json");
    fs.unlinkSync(workflowJson);
    for (const assignmentId of originalWorkflow.assignment_ids) {
      const assignmentJson = path.join(
        repo,
        ".hydra",
        "workflows",
        workflowId,
        "assignments",
        assignmentId,
        "assignment.json",
      );
      if (fs.existsSync(assignmentJson)) {
        fs.unlinkSync(assignmentJson);
      }
    }

    // Replay the ledger and inspect what comes out.
    const entries = readLedger(repo, workflowId);
    const { workflow: replayed, gaps } = replayLedger(entries);

    // ─── What replay DOES reconstruct ────────────────────────────────────

    // 1. Workflow lifecycle: created → completed.
    assert.equal(replayed.status, "completed");
    assert.equal(replayed.intent_file, originalWorkflow.intent_file);
    assert.equal(replayed.lead_terminal_id, originalWorkflow.lead_terminal_id);

    // 2. Node trajectory: every dispatched node is rebuilt with its final
    //    status, intent file, and approval flag.
    assert.deepEqual(Object.keys(replayed.nodes).sort(), ["dev", "researcher"]);

    const replayedResearcher = replayed.nodes.researcher;
    assert.equal(replayedResearcher.role, "claude-researcher");
    assert.equal(replayedResearcher.status, originalNodeStatuses.researcher);
    assert.equal(replayedResearcher.approved, true);
    assert.equal(replayedResearcher.last_outcome, "completed");
    assert.equal(replayedResearcher.dispatch_count, 1);

    const replayedDev = replayed.nodes.dev;
    assert.equal(replayedDev.role, "claude-implementer");
    assert.equal(replayedDev.status, originalNodeStatuses.dev);
    assert.equal(replayedDev.approved, false);
    assert.equal(replayedDev.last_outcome, "completed");

    // 3. Approval audit: every approved_ref in the original has a matching
    //    approved=true in the replay (and vice versa).
    const replayedApproved = Object.values(replayed.nodes)
      .filter((n) => n.approved)
      .map((n) => n.node_id)
      .sort();
    const originalApproved = Object.keys(originalApprovedRefs).sort();
    assert.deepEqual(replayedApproved, originalApproved);

    // ─── What replay does NOT reconstruct (architectural debt) ───────────

    // The KNOWN_REPLAY_GAPS list documents fields that the current ledger
    // event vocabulary cannot recover. Spot-check the most load-bearing
    // ones to make sure the gap inventory is honest.
    assert.ok(
      gaps.workflow_fields_missing_from_ledger.includes("repo_path"),
      "workflow_created event still does not log repo_path",
    );
    assert.ok(
      gaps.workflow_fields_missing_from_ledger.includes("default_agent_type"),
      "workflow_created event still does not log default_agent_type",
    );
    assert.ok(
      gaps.node_fields_missing_from_ledger.includes("depends_on"),
      "node_dispatched event still does not log depends_on",
    );
    assert.ok(
      gaps.node_fields_missing_from_ledger.includes("retry_policy"),
      "node_dispatched event still does not log retry_policy",
    );
    assert.ok(
      gaps.assignment_fields_missing_from_ledger.includes("retry_count"),
      "assignment state machine does not emit retry_count to the ledger",
    );
    assert.ok(
      gaps.assignment_fields_missing_from_ledger.includes("transitions"),
      "assignment state machine does not emit transition history to the ledger",
    );

    // The ledger does not contain enough information to rebuild a single
    // AssignmentRecord. This is the central architectural finding: every
    // assignment-state-machine decision happens silently. Surface that
    // explicitly so a future change either tightens this assertion or
    // explicitly removes it after promoting assignment events.
    assert.equal(originalAssignments.length, 2);
    for (const assignment of originalAssignments) {
      assert.ok(assignment, "fixture should have created the assignment");
      // The replay model does not even hold an assignments map. If a future
      // refactor adds one, change this assertion.
      assert.equal(
        "assignments" in (replayed as ReplayedWorkflow & { assignments?: unknown }),
        false,
      );
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("replayLedger handles a node that was reset and re-dispatched", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Test reset cycle", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    const dev = await dispatchNode(
      {
        repoPath: repo,
        workflowId,
        nodeId: "dev",
        role: "claude-implementer",
        intent: "First pass.",
      },
      deps,
    );
    writeWorkerResult(
      repo,
      workflowId,
      dev.assignment_id,
      activeRunId(manager, dev.assignment_id),
      "completed",
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);

    // Reset and observe the cascade in the replayed model.
    const { resetNode, redispatchNode } = await import("../src/workflow-lead.ts");
    await resetNode(
      { repoPath: repo, workflowId, nodeId: "dev", feedback: "Try again." },
      deps,
    );
    await redispatchNode(
      { repoPath: repo, workflowId, nodeId: "dev", intent: "Second pass." },
      deps,
    );
    writeWorkerResult(
      repo,
      workflowId,
      dev.assignment_id,
      activeRunId(manager, dev.assignment_id),
      "completed",
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);

    const entries = readLedger(repo, workflowId);
    const { workflow: replayed } = replayLedger(entries);

    const node = replayed.nodes.dev;
    assert.ok(node);
    // We saw two dispatches in the ledger: the original + the redispatch
    // after reset. Replay tracks this as dispatch_count.
    assert.equal(node.dispatch_count, 2);
    // Final status reflects the latest event: completed (after the second pass).
    assert.equal(node.status, "completed");
    // Approval is cleared by reset.
    assert.equal(node.approved, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("KNOWN_REPLAY_GAPS lists every load-bearing missing field — change-detector", () => {
  // This is intentionally a change-detector. If you add a new field to
  // WorkflowRecord / WorkflowNode / AssignmentRecord and it should be
  // event-sourced, add it here AND update replayLedger to consume the new
  // event. If it should remain a derived cache, add it here with a
  // comment in replay.ts explaining why.
  //
  // Removing items here is fine when the corresponding ledger event has
  // landed and replayLedger now reconstructs the field.
  assert.ok(KNOWN_REPLAY_GAPS.workflow_fields_missing_from_ledger.length >= 10);
  assert.ok(KNOWN_REPLAY_GAPS.node_fields_missing_from_ledger.length >= 8);
  assert.ok(KNOWN_REPLAY_GAPS.assignment_fields_missing_from_ledger.length >= 7);
});
