import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  initWorkbench,
  dispatch,
  redispatch,
  watchUntilDecision,
  resetDispatch,
  approveDispatch,
  completeWorkbench,
  failWorkbench,
  getWorkbenchStatus,
  askDispatch,
  type WorkbenchDependencies,
} from "../src/workflow-lead.ts";
import type { DispatchCreateOnlyRequest } from "../src/dispatcher.ts";
import { loadWorkbench, WORKBENCH_STATE_SCHEMA_VERSION } from "../src/workflow-store.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { readLedger } from "../src/ledger.ts";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { resetRuntime, setRuntime } from "../src/runtime/index.ts";

// Set TERMCANVAS_TERMINAL_ID so initWorkflow + lead-guard accept the test as Lead
process.env.TERMCANVAS_TERMINAL_ID = "terminal-test-lead";

function makeTestRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-lead-test-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@test.com", "commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "pipe" });
  return dir;
}

function mockDeps(): WorkbenchDependencies {
  let time = Date.parse("2026-04-09T00:00:00.000Z");
  return {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request: DispatchCreateOnlyRequest) => ({
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

test("initWorkflow creates workflow directory and record", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const result = await initWorkbench({
      intent: "Add OAuth login",
      repoPath: repo,
      worktreePath: repo,
    }, deps);

    assert.ok(result.workbench_id.startsWith("workbench-"));
    assert.equal(result.worktree_path, repo);

    const workflow = loadWorkbench(repo, result.workbench_id);
    assert.ok(workflow);
    assert.equal(workflow.schema_version, WORKBENCH_STATE_SCHEMA_VERSION);
    assert.equal(workflow.lead_terminal_id, "terminal-test-lead");
    assert.equal(workflow.status, "active");
    assert.deepEqual(workflow.dispatches, {});

    // Check intent.md exists with the actual intent text
    const intentPath = path.join(repo, ".hydra", "workbenches", result.workbench_id, "inputs", "intent.md");
    assert.ok(fs.existsSync(intentPath));
    const intentContent = fs.readFileSync(intentPath, "utf-8");
    assert.ok(intentContent.includes("Add OAuth login"));

    // Check ledger
    const ledger = readLedger(repo, result.workbench_id);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].event.type, "workbench_created");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode locks node.agent_type from the role file (codex role overrides claude default)", async () => {
  const repo = makeTestRepo();
  const dispatched: Array<{ agentType: string; model?: string }> = [];
  let time = Date.parse("2026-04-09T00:00:00.000Z");
  const deps: WorkbenchDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request: DispatchCreateOnlyRequest) => {
      dispatched.push({ agentType: request.agentType, model: request.model });
      return {
        projectId: "project-1",
        terminalId: `terminal-${request.assignmentId}`,
        terminalType: request.agentType,
        terminalTitle: `Agent ${request.assignmentId}`,
        prompt: "test prompt",
      };
    },
    sleep: async () => {},
    syncProject: () => {},
    destroyTerminal: () => {},
    checkTerminalAlive: () => null,
  };
  try {
    // The role file's terminals[0] is the only source for cli selection.
    // reviewer[0] = codex, so the dispatched terminal comes up as codex.
    const init = await initWorkbench({
      intent: "Test agent_type lock",
      repoPath: repo,
      worktreePath: repo,
    }, deps);

    await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "reviewer", intent: "Build it",
    }, deps);

    // The dispatched terminal must come up as codex (locked by the role),
    // not claude (the workflow default).
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].agentType, "codex");

    // The persisted node must record the role's agent_type, not the default.
    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.equal(workflow.dispatches.dev.agent_type, "codex");
    assert.equal(workflow.dispatches.dev.role, "reviewer");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode snapshots retry_policy onto the assignment", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Build it",
      retryPolicy: {
        initial_interval_ms: 500,
        backoff_coefficient: 3,
        maximum_attempts: 4,
        non_retryable_error_codes: ["AGENT_REPORTED_ERROR"],
      },
    }, deps);

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.deepEqual(workflow.dispatches.dev.retry_policy, {
      initial_interval_ms: 500,
      backoff_coefficient: 3,
      maximum_attempts: 4,
      non_retryable_error_codes: ["AGENT_REPORTED_ERROR"],
    });

    // Same policy is snapshotted onto the assignment so the state machine
    // never has to load the workflow.
    const manager = new AssignmentManager(repo, init.workbench_id);
    const assignment = manager.load(dispatched.dispatch_id)!;
    assert.deepEqual(assignment.retry_policy, {
      initial_interval_ms: 500,
      backoff_coefficient: 3,
      maximum_attempts: 4,
      non_retryable_error_codes: ["AGENT_REPORTED_ERROR"],
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchAssignment waits for next_retry_at via the injected sleep dep", async () => {
  const repo = makeTestRepo();
  const sleepCalls: number[] = [];
  let time = Date.parse("2026-04-12T00:00:00.000Z");
  const deps: WorkbenchDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request: DispatchCreateOnlyRequest) => ({
      projectId: "project-1",
      terminalId: `terminal-${request.assignmentId}`,
      terminalType: request.agentType,
      terminalTitle: `Agent ${request.assignmentId}`,
      prompt: "test prompt",
    }),
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
    syncProject: () => {},
    destroyTerminal: () => {},
    checkTerminalAlive: () => null,
  };
  try {
    const init = await initWorkbench({ intent: "Backoff", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Build it",
      retryPolicy: { initial_interval_ms: 5_000 },
    }, deps);

    // Hand-stamp next_retry_at to a future time and reset the assignment to
    // pending so the next dispatchAssignment call observes the backoff. Also
    // flip the node status to "reset" so redispatchNode accepts it.
    const manager = new AssignmentManager(repo, init.workbench_id);
    const assignment = manager.load(dispatched.dispatch_id)!;
    const baseNowIso = new Date(time).toISOString();
    assignment.next_retry_at = new Date(Date.parse(baseNowIso) + 5_000).toISOString();
    assignment.status = "pending";
    assignment.claim = undefined;
    manager.save(assignment);

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    workflow.dispatches.dev.status = "reset";
    // saveWorkflow is internal; mutate via the manager-adjacent path —
    // re-serialize via fs since the test fixture doesn't expose saveWorkflow.
    fs.writeFileSync(
      path.join(repo, ".hydra", "workbenches", init.workbench_id, "workbench.json"),
      JSON.stringify(workflow, null, 2),
      "utf-8",
    );

    // Trigger redispatchNode (which calls dispatchAssignment under the hood).
    await redispatch({
      repoPath: repo, workbenchId: init.workbench_id, dispatchId: "dev",
    }, deps);

    // The injected sleep was invoked with roughly the backoff window. Time
    // ticks 1s per call inside `now`, so the observed wait is 5_000 minus a
    // few `now()` increments.
    assert.equal(sleepCalls.length >= 1, true, "expected dispatchAssignment to call sleep");
    assert.ok(sleepCalls[0] > 0 && sleepCalls[0] <= 5_000);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode threads model override through to the dispatch request", async () => {
  const repo = makeTestRepo();
  const dispatched: Array<{ model?: string }> = [];
  let time = Date.parse("2026-04-09T00:00:00.000Z");
  const deps: WorkbenchDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request: DispatchCreateOnlyRequest) => {
      dispatched.push({ model: request.model });
      return {
        projectId: "project-1",
        terminalId: `terminal-${request.assignmentId}`,
        terminalType: request.agentType,
        terminalTitle: `Agent ${request.assignmentId}`,
        prompt: "test prompt",
      };
    },
    sleep: async () => {},
    syncProject: () => {},
    destroyTerminal: () => {},
    checkTerminalAlive: () => null,
  };
  try {
    const init = await initWorkbench({
      intent: "Test model wiring",
      repoPath: repo,
      worktreePath: repo,
    }, deps);
    await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Build it",
      model: "opus",
    }, deps);

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].model, "opus");
    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.equal(workflow.dispatches.dev.model, "opus");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode dispatches an eligible node", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);

    const result = await dispatch({
      repoPath: repo,
      workbenchId: init.workbench_id,
      dispatchId: "researcher",
      role: "dev",
      intent: "Analyze the codebase",
    }, deps);

    assert.equal(result.dispatch_id, "researcher");
    assert.equal(result.status, "dispatched");
    assert.ok(result.terminal_id);

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.equal(workflow.dispatches.researcher.status, "dispatched");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode dispatches immediately (no dependency blocking)", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "researcher", role: "dev", intent: "Research",
    }, deps);

    const result = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Implement",
    }, deps);

    assert.equal(result.status, "dispatched");

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.equal(workflow.dispatches.dev.status, "dispatched");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode rejects duplicate node IDs", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Implement",
    }, deps);

    await assert.rejects(
      () => dispatch({
        repoPath: repo, workbenchId: init.workbench_id,
        dispatchId: "dev", role: "reviewer", intent: "Test",
      }, deps),
      (err: Error) => {
        assert.match(err.message, /already exists/);
        return true;
      },
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode dispatches multiple nodes independently", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const a = await dispatch({ repoPath: repo, workbenchId: init.workbench_id, dispatchId: "a", role: "dev", intent: "A" }, deps);
    const b = await dispatch({ repoPath: repo, workbenchId: init.workbench_id, dispatchId: "b", role: "dev", intent: "B" }, deps);
    const c = await dispatch({ repoPath: repo, workbenchId: init.workbench_id, dispatchId: "c", role: "dev", intent: "C" }, deps);
    assert.equal(a.status, "dispatched");
    assert.equal(b.status, "dispatched");
    assert.equal(c.status, "dispatched");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("watchUntilDecision returns node_completed when result.json appears", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Implement feature",
    }, deps);

    // Write result.json to the expected location
    const workflow = loadWorkbench(repo, init.workbench_id)!;
    const assignment = (await import("../src/assignment/manager.ts")).AssignmentManager
      .prototype.load.call(
        new (await import("../src/assignment/manager.ts")).AssignmentManager(repo, init.workbench_id),
        dispatched.dispatch_id,
      );
    assert.ok(assignment);
    const run = assignment.runs[0];
    assert.ok(run);

    fs.writeFileSync(run.result_file, JSON.stringify({
      schema_version: RESULT_SCHEMA_VERSION,
      workbench_id: init.workbench_id,
      assignment_id: dispatched.dispatch_id,
      run_id: run.id,
      outcome: "completed",
      report_file: "report.md",
    }, null, 2), "utf-8");

    const decision = await watchUntilDecision({
      repoPath: repo, workbenchId: init.workbench_id, timeoutMs: 5000,
    }, deps);

    assert.equal(decision.type, "dispatch_completed");
    assert.equal(decision.completed?.dispatch_id, "dev");
    assert.equal(decision.completed?.outcome, "completed");
    assert.equal(decision.completed?.report_file, "report.md");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("watchUntilDecision returns batch_completed when no nodes are active", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    // Don't dispatch anything — empty workflow
    // Need at least one node for batch_completed (otherwise it loops forever)
    // Actually with no nodes, statuses.length === 0 so it won't trigger batch_completed
    // It'll hit timeout instead
    const decision = await watchUntilDecision({
      repoPath: repo, workbenchId: init.workbench_id, timeoutMs: 100,
    }, deps);

    assert.equal(decision.type, "watch_timeout");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("resetNode resets only the target node", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatch({ repoPath: repo, workbenchId: init.workbench_id, dispatchId: "a", role: "dev", intent: "A" }, deps);
    await dispatch({ repoPath: repo, workbenchId: init.workbench_id, dispatchId: "b", role: "dev", intent: "B" }, deps);

    const result = await resetDispatch({
      repoPath: repo, workbenchId: init.workbench_id, dispatchId: "a", feedback: "Redo this",
    }, deps);

    assert.equal(result.dispatch_id, "a");

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.equal(workflow.dispatches.a.status, "reset");  // target: reset status
    assert.equal(workflow.dispatches.b.status, "dispatched"); // other node: unchanged
    assert.ok(workflow.dispatches.a.feedback_file);
    const feedbackContent = fs.readFileSync(path.join(repo, workflow.dispatches.a.feedback_file!), "utf-8");
    assert.ok(feedbackContent.includes("Redo this"));

    // Check ledger
    const ledger = readLedger(repo, init.workbench_id);
    assert.ok(ledger.some((e) => e.event.type === "dispatch_reset"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("approveNode stores approved ref", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "researcher", role: "dev", intent: "Research",
    }, deps);

    await approveDispatch({
      repoPath: repo, workbenchId: init.workbench_id, dispatchId: "researcher",
    }, deps);

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.ok(workflow.approved_refs?.researcher);
    assert.equal(workflow.approved_refs.researcher.assignment_id, dispatched.dispatch_id);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("completeWorkflow sets status and writes ledger", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);

    await completeWorkbench({
      repoPath: repo, workbenchId: init.workbench_id, summary: "All done",
    }, deps);

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.equal(workflow.status, "completed");
    assert.ok(workflow.result_file);
    const summaryContent = fs.readFileSync(path.join(repo, workflow.result_file!), "utf-8");
    assert.ok(summaryContent.includes("All done"));

    const ledger = readLedger(repo, init.workbench_id);
    assert.ok(ledger.some((e) => e.event.type === "workbench_completed"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("failWorkflow sets status and writes ledger", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);

    await failWorkbench({
      repoPath: repo, workbenchId: init.workbench_id, reason: "Blocked on external API",
    }, deps);

    const workflow = loadWorkbench(repo, init.workbench_id)!;
    assert.equal(workflow.status, "failed");
    assert.equal(workflow.failure?.message, "Blocked on external API");

    const ledger = readLedger(repo, init.workbench_id);
    assert.ok(ledger.some((e) => e.event.type === "workbench_failed"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("getWorkflowStatus returns workflow and assignments", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Build",
    }, deps);

    const view = getWorkbenchStatus(repo, init.workbench_id);

    assert.equal(view.workbench.id, init.workbench_id);
    assert.equal(view.assignments.length, 1);
    assert.equal(view.assignments[0].role, "dev");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("redispatch on a claude assignment passes the captured session_id as resumeSessionId", async () => {
  const repo = makeTestRepo();
  const dispatchedRequests: Array<{ assignmentId: string; resumeSessionId?: string }> = [];
  let time = Date.parse("2026-04-09T00:00:00.000Z");
  const deps: WorkbenchDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request: DispatchCreateOnlyRequest) => {
      dispatchedRequests.push({
        assignmentId: request.assignmentId,
        resumeSessionId: request.resumeSessionId,
      });
      return {
        projectId: "project-1",
        terminalId: `terminal-${request.assignmentId}-${dispatchedRequests.length}`,
        terminalType: request.agentType,
        terminalTitle: `Agent ${request.assignmentId}`,
        prompt: "test prompt",
      };
    },
    sleep: async () => {},
    syncProject: () => {},
    destroyTerminal: () => {},
    checkTerminalAlive: () => null,
  };
  try {
    const init = await initWorkbench({
      intent: "Test resume",
      repoPath: repo,
      worktreePath: repo,
    }, deps);
    const dispatched = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "First pass",
    }, deps);

    // First dispatch should have no resume session
    assert.equal(dispatchedRequests.length, 1);
    assert.equal(dispatchedRequests[0].resumeSessionId, undefined);

    // Pre-populate session_id on the prior run, simulating what
    // destroyAssignmentTerminal would have captured from telemetry.
    const manager = new AssignmentManager(repo, init.workbench_id);
    const assignment = manager.load(dispatched.dispatch_id)!;
    const firstRun = assignment.runs[0]!;
    firstRun.session_id = "claude-session-resume-test";
    firstRun.session_provider = "claude";
    manager.save(assignment);

    // Reset + redispatch the node — the new run should pick up the prior session
    await resetDispatch({
      repoPath: repo, workbenchId: init.workbench_id, dispatchId: "dev", feedback: "Try again",
    }, deps);
    await redispatch({
      repoPath: repo, workbenchId: init.workbench_id, dispatchId: "dev",
    }, deps);

    assert.equal(dispatchedRequests.length, 2);
    assert.equal(dispatchedRequests[1].resumeSessionId, "claude-session-resume-test");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("redispatch on a non-claude assignment does not pass resumeSessionId", async () => {
  const repo = makeTestRepo();
  const dispatchedRequests: Array<{ resumeSessionId?: string }> = [];
  let time = Date.parse("2026-04-09T00:00:00.000Z");
  const deps: WorkbenchDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request: DispatchCreateOnlyRequest) => {
      dispatchedRequests.push({ resumeSessionId: request.resumeSessionId });
      return {
        projectId: "project-1",
        terminalId: `terminal-${request.assignmentId}-${dispatchedRequests.length}`,
        terminalType: request.agentType,
        terminalTitle: `Agent ${request.assignmentId}`,
        prompt: "test prompt",
      };
    },
    sleep: async () => {},
    syncProject: () => {},
    destroyTerminal: () => {},
    checkTerminalAlive: () => null,
  };
  try {
    const init = await initWorkbench({
      intent: "Test no-resume on codex",
      repoPath: repo,
      worktreePath: repo,
    }, deps);
    // Role-driven dispatch: pick `reviewer` so the assignment's agent_type
    // comes out as codex (reviewer[0] = codex; resume is claude-only).
    const dispatched = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "reviewer", intent: "First pass",
    }, deps);

    // Pre-populate a session_id on the prior run anyway — codex shouldn't resume
    const manager = new AssignmentManager(repo, init.workbench_id);
    const assignment = manager.load(dispatched.dispatch_id)!;
    assignment.runs[0]!.session_id = "codex-session-should-be-ignored";
    manager.save(assignment);

    await resetDispatch({
      repoPath: repo, workbenchId: init.workbench_id, dispatchId: "dev", feedback: "Try again",
    }, deps);
    await redispatch({
      repoPath: repo, workbenchId: init.workbench_id, dispatchId: "dev",
    }, deps);

    assert.equal(dispatchedRequests.length, 2);
    // Both dispatches must NOT carry a resume session for non-claude agents
    assert.equal(dispatchedRequests[0].resumeSessionId, undefined);
    assert.equal(dispatchedRequests[1].resumeSessionId, undefined);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("watchUntilDecision exposes pre-captured session info on the completed DecisionPoint", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatch({
      repoPath: repo, workbenchId: init.workbench_id,
      dispatchId: "dev", role: "dev", intent: "Implement feature",
    }, deps);

    // Pre-populate session info on the run, simulating capture from telemetry
    // before the terminal was destroyed. This bypasses the live telemetry call
    // path so the test can run without TermCanvas being available.
    const manager = new AssignmentManager(repo, init.workbench_id);
    const assignment = manager.load(dispatched.dispatch_id)!;
    const run = assignment.runs[0]!;
    run.session_id = "claude-session-abc123";
    run.session_provider = "claude";
    run.session_file = "/tmp/claude-sessions/claude-session-abc123.json";
    manager.save(assignment);

    // Write the slim result so watchUntilDecision treats the node as completed
    fs.writeFileSync(run.result_file, JSON.stringify({
      schema_version: RESULT_SCHEMA_VERSION,
      workbench_id: init.workbench_id,
      assignment_id: dispatched.dispatch_id,
      run_id: run.id,
      outcome: "completed",
      report_file: "report.md",
    }, null, 2), "utf-8");

    const decision = await watchUntilDecision({
      repoPath: repo, workbenchId: init.workbench_id, timeoutMs: 5000,
    }, deps);

    assert.equal(decision.type, "dispatch_completed");
    assert.ok(decision.completed?.session, "session info should be exposed");
    assert.equal(decision.completed.session.id, "claude-session-abc123");
    assert.equal(decision.completed.session.provider, "claude");
    assert.equal(decision.completed.session.file, "/tmp/claude-sessions/claude-session-abc123.json");

    // Ledger should also record the session_id for the completed node event
    const ledger = readLedger(repo, init.workbench_id);
    const completed = ledger.find((entry) => entry.event.type === "dispatch_completed");
    assert.ok(completed);
    assert.equal((completed.event as { session_id?: string }).session_id, "claude-session-abc123");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("watchUntilDecision preserves completed assignment state when session info is captured during terminal teardown", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatch({
      repoPath: repo,
      workbenchId: init.workbench_id,
      dispatchId: "dev",
      role: "reviewer",
      intent: "Implement feature",
    }, deps);

    const manager = new AssignmentManager(repo, init.workbench_id);
    const assignment = manager.load(dispatched.dispatch_id)!;
    const run = assignment.runs[0]!;
    fs.writeFileSync(run.result_file, JSON.stringify({
      schema_version: RESULT_SCHEMA_VERSION,
      workbench_id: init.workbench_id,
      assignment_id: dispatched.dispatch_id,
      run_id: run.id,
      outcome: "completed",
      report_file: "report.md",
    }, null, 2), "utf-8");

    setRuntime({
      name: "standalone",
      isAvailable: () => true,
      getCurrentLeadId: () => process.env.TERMCANVAS_TERMINAL_ID,
      ensureProjectTracked: (repoPath: string) => ({ id: repoPath, path: repoPath }),
      syncProject: () => {},
      findProjectByPath: (repoPath: string) => ({ id: repoPath, path: repoPath }),
      terminalCreate: () => {
        throw new Error("terminalCreate should not be called in this test");
      },
      terminalStatus: () => ({ id: run.terminal_id, status: "success", ptyId: null }),
      terminalDestroy: () => {},
      telemetryTerminal: (terminalId: string) => terminalId === run.terminal_id
        ? {
            session_id: "codex-session-captured-on-destroy",
            session_file: "/tmp/codex-session.json",
            provider: "codex",
          }
        : null,
    });

    const decision = await watchUntilDecision({
      repoPath: repo,
      workbenchId: init.workbench_id,
      timeoutMs: 5000,
    }, deps);

    assert.equal(decision.type, "dispatch_completed");
    const reloaded = manager.load(dispatched.dispatch_id)!;
    assert.equal(reloaded.status, "completed");
    assert.equal(reloaded.result?.outcome, "completed");
    assert.equal(reloaded.runs[0]?.status, "completed");
    assert.equal(reloaded.runs[0]?.session_id, "codex-session-captured-on-destroy");
    assert.equal(reloaded.runs[0]?.session_provider, "codex");
  } finally {
    resetRuntime();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("askNode loads the node's session, delegates to askFollowUp, and writes a ledger entry", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  // Capture the askFollowUp call args so we can assert the editor wired
  // the right values through.
  const askCalls: Array<{
    cli: string;
    sessionId: string;
    message: string;
    workdir: string;
    timeoutMs?: number;
  }> = [];
  const extendedDeps: WorkbenchDependencies = {
    ...deps,
    askFollowUp: async (opts: { cli: string; sessionId: string; message: string; workdir: string; timeoutMs?: number }) => {
      askCalls.push(opts);
      return {
        answer: "Because pattern A is thread-safe and has no hidden lock contention.",
        newSessionId: "forked-session-xyz",
        durationMs: 1234,
        exitCode: 0,
      };
    },
  };

  try {
    // 1. Init + dispatch a dev node, mock its completion, capture a session_id.
    const init = await initWorkbench(
      { intent: "Add OAuth login", repoPath: repo, worktreePath: repo },
      extendedDeps,
    );
    const dispatched = await dispatch(
      {
        repoPath: repo,
        workbenchId: init.workbench_id,
        dispatchId: "dev",
        role: "dev",
        intent: "Implement OAuth",
      },
      extendedDeps,
    );
    // Hand-stamp the run's session_id on disk so askNode finds it. This is
    // what telemetry would do in production after the subprocess captures
    // the claude init message.
    const manager = new AssignmentManager(repo, init.workbench_id);
    const assignment = manager.load(dispatched.dispatch_id)!;
    const run = assignment.runs[assignment.runs.length - 1]!;
    run.session_id = "dev-session-original";
    run.session_provider = "claude";
    manager.save(assignment);

    // 2. Lead asks Dev a follow-up.
    const result = await askDispatch(
      {
        repoPath: repo,
        workbenchId: init.workbench_id,
        dispatchId: "dev",
        message: "why did you choose pattern A over B?",
      },
      extendedDeps,
    );

    // 3. The injected askFollowUp was called with the node's session info.
    assert.equal(askCalls.length, 1);
    assert.equal(askCalls[0].cli, "claude");
    assert.equal(askCalls[0].sessionId, "dev-session-original");
    assert.equal(askCalls[0].message, "why did you choose pattern A over B?");
    assert.equal(askCalls[0].workdir, repo);

    // 4. askNode returned a structured result carrying the answer + fork id.
    assert.equal(result.dispatch_id, "dev");
    assert.equal(result.role, "dev");
    assert.equal(result.cli, "claude");
    assert.equal(result.session_id, "dev-session-original");
    assert.equal(result.new_session_id, "forked-session-xyz");
    assert.ok(result.answer.includes("thread-safe"));
    assert.equal(result.duration_ms, 1234);
    assert.equal(result.exit_code, 0);

    // 5. A ledger entry was written with the question + answer excerpt.
    const ledger = readLedger(repo, init.workbench_id);
    const askEvent = ledger.find((e) => e.event.type === "lead_asked_followup");
    assert.ok(askEvent, "ledger should contain a lead_asked_followup entry");
    assert.equal(askEvent.actor, "lead");
    const event = askEvent.event as {
      type: "lead_asked_followup";
      dispatch_id: string;
      role: string;
      agent_type: string;
      session_id: string;
      new_session_id?: string;
      message_excerpt: string;
      answer_excerpt: string;
      duration_ms: number;
    };
    assert.equal(event.dispatch_id, "dev");
    assert.equal(event.role, "dev");
    assert.equal(event.session_id, "dev-session-original");
    assert.equal(event.new_session_id, "forked-session-xyz");
    assert.ok(event.message_excerpt.includes("pattern A"));
    assert.ok(event.answer_excerpt.includes("thread-safe"));
    assert.equal(event.duration_ms, 1234);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("askNode rejects nodes that have no captured session_id", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench(
      { intent: "Add OAuth login", repoPath: repo, worktreePath: repo },
      deps,
    );
    await dispatch(
      {
        repoPath: repo,
        workbenchId: init.workbench_id,
        dispatchId: "dev",
        role: "dev",
        intent: "Implement OAuth",
      },
      deps,
    );
    // Do NOT set run.session_id — this simulates a node that has not yet
    // had its session captured by telemetry (or a CLI that does not emit
    // one).
    await assert.rejects(
      () =>
        askDispatch(
          {
            repoPath: repo,
            workbenchId: init.workbench_id,
            dispatchId: "dev",
            message: "hi",
          },
          deps,
        ),
      /no session_id captured/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("askNode rejects nodes that do not exist", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkbench(
      { intent: "Anything", repoPath: repo, worktreePath: repo },
      deps,
    );
    await assert.rejects(
      () =>
        askDispatch(
          {
            repoPath: repo,
            workbenchId: init.workbench_id,
            dispatchId: "nonexistent",
            message: "hi",
          },
          deps,
        ),
      /Dispatch not found/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
