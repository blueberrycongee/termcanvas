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
  resetNode,
  redispatchNode,
  type WorkflowDependencies,
} from "../src/workflow-lead.ts";
import { readLedger } from "../src/ledger.ts";
import { INTENTIONALLY_NOT_LEDGERED, replayLedger } from "../src/replay.ts";
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
  options: { stuck_reason?: string; reportFile?: string } = {},
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
  const result: Record<string, unknown> = {
    schema_version: RESULT_SCHEMA_VERSION,
    workflow_id: workflowId,
    assignment_id: assignmentId,
    run_id: runId,
    outcome,
    report_file: options.reportFile ?? "report.md",
  };
  if (options.stuck_reason) result.stuck_reason = options.stuck_reason;
  fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf-8");
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

// ─── User-story-driven audit tests ───────────────────────────────────────
//
// Each test answers ONE of the five questions a Lead / human auditor wants
// to be able to ask after periodically reading the ledger:
//
//   1. What is the workflow's lifecycle status?
//   2. What did the Lead decide?
//   3. What did the system decide on its own?
//   4. What did each worker conclude?
//   5. Where do I drill down for details?
//
// Together these tests pin the **decision-coverage contract** of the
// ledger. Adding a new user story to this list (or removing one) is the
// way to evolve the ledger schema deliberately.

test("Q1 — workflow lifecycle: status, intent, completion are visible from the ledger alone", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Add OAuth", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    const dev = await dispatchNode(
      {
        repoPath: repo, workflowId,
        nodeId: "dev", role: "claude-implementer", intent: "Build OAuth.",
      },
      deps,
    );
    writeWorkerResult(repo, workflowId, dev.assignment_id, activeRunId(manager, dev.assignment_id), "completed");
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);
    await completeWorkflow({ repoPath: repo, workflowId, summary: "Done." }, deps);

    const { workflow } = replayLedger(readLedger(repo, workflowId));
    assert.equal(workflow.status, "completed");
    assert.match(workflow.intent_file ?? "", /intent\.md$/);
    assert.equal(workflow.lead_terminal_id, "terminal-test-lead");
    assert.match(workflow.result_file ?? "", /summary\.md$/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Q2 — Lead decisions are visible: dispatch, approve, reset, redispatch, complete", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Trace Lead decisions", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    // Lead makes 5 decisions: dispatch → approve → reset → redispatch → complete
    const dev = await dispatchNode(
      {
        repoPath: repo, workflowId,
        nodeId: "dev", role: "claude-implementer", intent: "First pass.",
      },
      deps,
    );
    writeWorkerResult(repo, workflowId, dev.assignment_id, activeRunId(manager, dev.assignment_id), "completed");
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);
    await approveNode({ repoPath: repo, workflowId, nodeId: "dev" }, deps);
    await resetNode(
      { repoPath: repo, workflowId, nodeId: "dev", feedback: "Try again." },
      deps,
    );
    await redispatchNode(
      { repoPath: repo, workflowId, nodeId: "dev", intent: "Second pass." },
      deps,
    );
    writeWorkerResult(repo, workflowId, dev.assignment_id, activeRunId(manager, dev.assignment_id), "completed");
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);
    await completeWorkflow({ repoPath: repo, workflowId }, deps);

    const entries = readLedger(repo, workflowId);
    const leadEntries = entries.filter((e) => e.actor === "lead");
    const leadEventTypes = leadEntries.map((e) => e.event.type);

    // The 5 distinct Lead decisions all show up, attributed to actor=lead.
    assert.ok(leadEventTypes.includes("workflow_created"));
    assert.ok(leadEventTypes.includes("node_dispatched"));
    assert.ok(leadEventTypes.includes("node_approved"));
    assert.ok(leadEventTypes.includes("node_reset"));
    assert.ok(leadEventTypes.includes("workflow_completed"));

    // node_dispatched events carry a cause so the reader can distinguish
    // initial dispatches from redispatches.
    const dispatchEntries = leadEntries.filter((e) => e.event.type === "node_dispatched");
    const causes = dispatchEntries.map(
      (e) => (e.event as { type: "node_dispatched"; cause: string }).cause,
    );
    assert.ok(causes.includes("initial"), "first dispatch should have cause=initial");
    assert.ok(causes.includes("lead_redispatch"), "second dispatch should have cause=lead_redispatch");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Q3 — system decisions are visible: promotions emit node_promoted_eligible with the triggering deps", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Trace promotions", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    // researcher → dev (dev is blocked initially, gets promoted when researcher completes)
    const researcher = await dispatchNode(
      {
        repoPath: repo, workflowId,
        nodeId: "researcher", role: "claude-researcher", intent: "Investigate.",
      },
      deps,
    );
    await dispatchNode(
      {
        repoPath: repo, workflowId,
        nodeId: "dev", role: "claude-implementer", intent: "Build.",
        dependsOn: ["researcher"],
      },
      deps,
    );

    writeWorkerResult(
      repo, workflowId, researcher.assignment_id,
      activeRunId(manager, researcher.assignment_id), "completed",
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);

    const { workflow } = replayLedger(readLedger(repo, workflowId));
    // The promotion of dev (after researcher completed) is visible to the auditor.
    const devPromotion = workflow.promotions.find((p) => p.node_id === "dev");
    assert.ok(devPromotion, "dev should have a promotion event after researcher completed");
    assert.deepEqual(devPromotion!.triggered_by, ["researcher"]);
    // actor_counts confirms the system actor is exercising decisions.
    assert.ok(workflow.actor_counts.system >= 1);
    assert.ok(workflow.actor_counts.lead >= 2); // workflow_created + 2 dispatches
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Q3 — system decisions are visible: assignment_retried records cause + attempt + next dispatch", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Trace retries", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    const dev = await dispatchNode(
      {
        repoPath: repo, workflowId,
        nodeId: "dev", role: "claude-implementer", intent: "Try.",
        maxRetries: 2,
      },
      deps,
    );

    // First run: worker reports outcome=error → system retries.
    writeWorkerResult(
      repo, workflowId, dev.assignment_id,
      activeRunId(manager, dev.assignment_id), "error",
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);

    const entries = readLedger(repo, workflowId);
    const systemEntries = entries.filter((e) => e.actor === "system");
    const systemTypes = systemEntries.map((e) => e.event.type);

    // Both the retry decision AND the system-driven re-dispatch land in the ledger.
    assert.ok(systemTypes.includes("assignment_retried"));
    assert.ok(systemTypes.includes("node_dispatched"));

    const retryEntry = systemEntries.find((e) => e.event.type === "assignment_retried");
    const retryEvent = retryEntry!.event as {
      type: "assignment_retried";
      cause: "timeout" | "agent_reported_error";
      attempt: number;
      failure_code: string;
    };
    assert.equal(retryEvent.cause, "agent_reported_error");
    assert.equal(retryEvent.failure_code, "AGENT_REPORTED_ERROR");
    assert.ok(retryEvent.attempt >= 1);

    const systemDispatch = systemEntries.find((e) => e.event.type === "node_dispatched");
    assert.equal(
      (systemDispatch!.event as { type: "node_dispatched"; cause: string }).cause,
      "system_retry",
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Q4 — worker verdicts are visible: outcome + stuck_reason flow into the ledger", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Trace worker verdicts", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    const dev = await dispatchNode(
      {
        repoPath: repo, workflowId,
        nodeId: "dev", role: "claude-implementer", intent: "Try.",
      },
      deps,
    );
    writeWorkerResult(
      repo, workflowId, dev.assignment_id,
      activeRunId(manager, dev.assignment_id),
      "stuck",
      { stuck_reason: "needs_credentials" },
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);

    const { workflow } = replayLedger(readLedger(repo, workflowId));
    const node = workflow.nodes.dev;
    assert.ok(node);
    assert.equal(node.last_outcome, "stuck");
    assert.equal(node.last_stuck_reason, "needs_credentials");

    // The actor on the verdict event is "worker", not "system" or "lead".
    const completedEntries = readLedger(repo, workflowId)
      .filter((e) => e.event.type === "node_completed");
    assert.equal(completedEntries.length, 1);
    assert.equal(completedEntries[0].actor, "worker");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Q5 — drill-down refs: failure events carry failure_message and report_file when available", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow(
      { intent: "Trace failure drilldown", repoPath: repo, worktreePath: repo },
      deps,
    );
    const workflowId = init.workflow_id;
    const manager = new AssignmentManager(repo, workflowId);

    const dev = await dispatchNode(
      {
        repoPath: repo, workflowId,
        nodeId: "dev", role: "claude-implementer", intent: "Will fail.",
        maxRetries: 0, // exhaust on first error
      },
      deps,
    );
    writeWorkerResult(
      repo, workflowId, dev.assignment_id,
      activeRunId(manager, dev.assignment_id), "error",
    );
    await watchUntilDecision({ repoPath: repo, workflowId, timeoutMs: 5_000 }, deps);

    const { workflow } = replayLedger(readLedger(repo, workflowId));
    const node = workflow.nodes.dev;
    assert.ok(node);
    assert.equal(node.status, "failed");
    assert.equal(node.last_failure_code, "AGENT_REPORTED_ERROR");
    // failure_message gives the human-readable line; report_file is the
    // drill-down path so the reader can `cat` straight to the worker's report.
    assert.match(node.last_failure_message ?? "", /Agent reported error/);
    assert.equal(node.last_failure_report_file, "report.md");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("INTENTIONALLY_NOT_LEDGERED documents the design rationale for fields that live in *.json", () => {
  // This is a change-detector. If you reorganize the inventory, update this
  // test. If you move a field FROM json INTO the ledger, remove its row
  // from INTENTIONALLY_NOT_LEDGERED and prove the new ledger event covers
  // it via a new Q1–Q5 case above.
  for (const category of Object.values(INTENTIONALLY_NOT_LEDGERED)) {
    assert.ok(category.fields.length > 0);
    assert.ok(category.rationale.length > 50, "rationale should be substantive, not a one-liner");
  }
  assert.ok(INTENTIONALLY_NOT_LEDGERED.workflow_setup.fields.includes("repo_path"));
  assert.ok(INTENTIONALLY_NOT_LEDGERED.node_configuration.fields.includes("retry_policy"));
  assert.ok(INTENTIONALLY_NOT_LEDGERED.assignment_state_machine.fields.includes("transitions"));
});
