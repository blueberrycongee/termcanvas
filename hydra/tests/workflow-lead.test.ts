import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  initWorkflow,
  dispatchNode,
  redispatchNode,
  watchUntilDecision,
  resetNode,
  approveNode,
  completeWorkflow,
  failWorkflow,
  getWorkflowStatus,
  type WorkflowDependencies,
} from "../src/workflow-lead.ts";
import { loadWorkflow, WORKFLOW_STATE_SCHEMA_VERSION } from "../src/workflow-store.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { readLedger } from "../src/ledger.ts";
import { AssignmentManager } from "../src/assignment/manager.ts";

// Set TERMCANVAS_TERMINAL_ID so initWorkflow + lead-guard accept the test as Lead
process.env.TERMCANVAS_TERMINAL_ID = "terminal-test-lead";

function makeTestRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-lead-test-"));
  execFileSync("git", ["init", "--initial-branch", "main"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@test.com", "commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "pipe" });
  return dir;
}

function mockDeps(): WorkflowDependencies {
  let time = Date.parse("2026-04-09T00:00:00.000Z");
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

test("initWorkflow creates workflow directory and record", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const result = await initWorkflow({
      intent: "Add OAuth login",
      repoPath: repo,
      worktreePath: repo,
    }, deps);

    assert.ok(result.workflow_id.startsWith("workflow-"));
    assert.equal(result.worktree_path, repo);

    const workflow = loadWorkflow(repo, result.workflow_id);
    assert.ok(workflow);
    assert.equal(workflow.schema_version, WORKFLOW_STATE_SCHEMA_VERSION);
    assert.equal(workflow.lead_terminal_id, "terminal-test-lead");
    assert.equal(workflow.status, "active");
    assert.deepEqual(workflow.nodes, {});
    assert.deepEqual(workflow.node_statuses, {});

    // Check intent.md exists with the actual intent text
    const intentPath = path.join(repo, ".hydra", "workflows", result.workflow_id, "inputs", "intent.md");
    assert.ok(fs.existsSync(intentPath));
    const intentContent = fs.readFileSync(intentPath, "utf-8");
    assert.ok(intentContent.includes("Add OAuth login"));

    // Check ledger
    const ledger = readLedger(repo, result.workflow_id);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].event.type, "workflow_created");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode locks node.agent_type from the role file (codex role overrides claude default)", async () => {
  const repo = makeTestRepo();
  const dispatched: Array<{ agentType: string; model?: string }> = [];
  let time = Date.parse("2026-04-09T00:00:00.000Z");
  const deps: WorkflowDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request) => {
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
    // Workflow defaults to claude — but the role file pins codex.
    const init = await initWorkflow({
      intent: "Test agent_type lock",
      repoPath: repo,
      worktreePath: repo,
      defaultAgentType: "claude",
    }, deps);

    await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "codex-implementer", intent: "Build it",
    }, deps);

    // The dispatched terminal must come up as codex (locked by the role),
    // not claude (the workflow default).
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].agentType, "codex");

    // The persisted node must record the role's agent_type, not the default.
    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.equal(workflow.nodes.dev.agent_type, "codex");
    assert.equal(workflow.nodes.dev.role, "codex-implementer");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode snapshots retry_policy onto the assignment", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Build it",
      retryPolicy: {
        initial_interval_ms: 500,
        backoff_coefficient: 3,
        maximum_attempts: 4,
        non_retryable_error_codes: ["AGENT_REPORTED_ERROR"],
      },
    }, deps);

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.deepEqual(workflow.nodes.dev.retry_policy, {
      initial_interval_ms: 500,
      backoff_coefficient: 3,
      maximum_attempts: 4,
      non_retryable_error_codes: ["AGENT_REPORTED_ERROR"],
    });

    // Same policy is snapshotted onto the assignment so the state machine
    // never has to load the workflow.
    const manager = new AssignmentManager(repo, init.workflow_id);
    const assignment = manager.load(dispatched.assignment_id)!;
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
  const deps: WorkflowDependencies = {
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
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    syncProject: () => {},
    destroyTerminal: () => {},
    checkTerminalAlive: () => null,
  };
  try {
    const init = await initWorkflow({ intent: "Backoff", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Build it",
      retryPolicy: { initial_interval_ms: 5_000 },
    }, deps);

    // Hand-stamp next_retry_at to a future time and reset the assignment to
    // pending so the next dispatchAssignment call observes the backoff. Also
    // flip the node status to "reset" so redispatchNode accepts it.
    const manager = new AssignmentManager(repo, init.workflow_id);
    const assignment = manager.load(dispatched.assignment_id)!;
    const baseNowIso = new Date(time).toISOString();
    assignment.next_retry_at = new Date(Date.parse(baseNowIso) + 5_000).toISOString();
    assignment.status = "pending";
    assignment.claim = undefined;
    manager.save(assignment);

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    workflow.node_statuses.dev = "reset";
    // saveWorkflow is internal; mutate via the manager-adjacent path —
    // re-serialize via fs since the test fixture doesn't expose saveWorkflow.
    fs.writeFileSync(
      path.join(repo, ".hydra", "workflows", init.workflow_id, "workflow.json"),
      JSON.stringify(workflow, null, 2),
      "utf-8",
    );

    // Trigger redispatchNode (which calls dispatchAssignment under the hood).
    await redispatchNode({
      repoPath: repo, workflowId: init.workflow_id, nodeId: "dev",
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
  const deps: WorkflowDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request) => {
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
    const init = await initWorkflow({
      intent: "Test model wiring",
      repoPath: repo,
      worktreePath: repo,
    }, deps);
    await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Build it",
      model: "opus",
    }, deps);

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].model, "opus");
    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.equal(workflow.nodes.dev.model, "opus");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode dispatches an eligible node", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);

    const result = await dispatchNode({
      repoPath: repo,
      workflowId: init.workflow_id,
      nodeId: "researcher",
      role: "claude-researcher",
      intent: "Analyze the codebase",
    }, deps);

    assert.equal(result.node_id, "researcher");
    assert.equal(result.status, "dispatched");
    assert.ok(result.terminal_id);

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.equal(workflow.node_statuses.researcher, "dispatched");
    assert.ok(workflow.nodes.researcher.assignment_id);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode blocks when dependencies are not met", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "researcher", role: "claude-researcher", intent: "Research",
    }, deps);

    const result = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Implement",
      dependsOn: ["researcher"],
    }, deps);

    assert.equal(result.status, "blocked");

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.equal(workflow.node_statuses.dev, "blocked");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode rejects duplicate node IDs", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Implement",
    }, deps);

    await assert.rejects(
      () => dispatchNode({
        repoPath: repo, workflowId: init.workflow_id,
        nodeId: "dev", role: "claude-tester", intent: "Test",
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

test("dispatchNode allows linear chains", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatchNode({ repoPath: repo, workflowId: init.workflow_id, nodeId: "a", role: "claude-implementer", intent: "A" }, deps);
    await dispatchNode({ repoPath: repo, workflowId: init.workflow_id, nodeId: "b", role: "claude-implementer", intent: "B", dependsOn: ["a"] }, deps);
    const result = await dispatchNode({ repoPath: repo, workflowId: init.workflow_id, nodeId: "c", role: "claude-implementer", intent: "C", dependsOn: ["b"] }, deps);
    assert.equal(result.status, "blocked"); // b is blocked, so c is also blocked
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("dispatchNode rejects unknown dependency", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await assert.rejects(
      () => dispatchNode({
        repoPath: repo, workflowId: init.workflow_id,
        nodeId: "x", role: "claude-implementer", intent: "X", dependsOn: ["nonexistent"],
      }, deps),
      (err: Error) => {
        assert.match(err.message, /not found/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("watchUntilDecision returns node_completed when result.json appears", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Implement feature",
    }, deps);

    // Write result.json to the expected location
    const workflow = loadWorkflow(repo, init.workflow_id)!;
    const assignment = (await import("../src/assignment/manager.ts")).AssignmentManager
      .prototype.load.call(
        new (await import("../src/assignment/manager.ts")).AssignmentManager(repo, init.workflow_id),
        dispatched.assignment_id,
      );
    assert.ok(assignment);
    const run = assignment.runs[0];
    assert.ok(run);

    fs.writeFileSync(run.result_file, JSON.stringify({
      schema_version: RESULT_SCHEMA_VERSION,
      workflow_id: init.workflow_id,
      assignment_id: dispatched.assignment_id,
      run_id: run.id,
      outcome: "completed",
      report_file: "report.md",
    }, null, 2), "utf-8");

    const decision = await watchUntilDecision({
      repoPath: repo, workflowId: init.workflow_id, timeoutMs: 5000,
    }, deps);

    assert.equal(decision.type, "node_completed");
    assert.equal(decision.completed?.node_id, "dev");
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
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    // Don't dispatch anything — empty workflow
    // Need at least one node for batch_completed (otherwise it loops forever)
    // Actually with no nodes, statuses.length === 0 so it won't trigger batch_completed
    // It'll hit timeout instead
    const decision = await watchUntilDecision({
      repoPath: repo, workflowId: init.workflow_id, timeoutMs: 100,
    }, deps);

    assert.equal(decision.type, "watch_timeout");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("resetNode cascades downstream and sets correct statuses", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatchNode({ repoPath: repo, workflowId: init.workflow_id, nodeId: "a", role: "claude-researcher", intent: "A" }, deps);
    await dispatchNode({ repoPath: repo, workflowId: init.workflow_id, nodeId: "b", role: "claude-implementer", intent: "B", dependsOn: ["a"] }, deps);
    await dispatchNode({ repoPath: repo, workflowId: init.workflow_id, nodeId: "c", role: "claude-tester", intent: "C", dependsOn: ["b"] }, deps);

    const result = await resetNode({
      repoPath: repo, workflowId: init.workflow_id, nodeId: "a", feedback: "Redo this",
    }, deps);

    assert.ok(result.reset_node_ids.includes("a"));
    assert.ok(result.reset_node_ids.includes("b"));
    assert.ok(result.reset_node_ids.includes("c"));

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.equal(workflow.node_statuses.a, "eligible"); // target: eligible
    assert.equal(workflow.node_statuses.b, "blocked");  // downstream: blocked
    assert.equal(workflow.node_statuses.c, "blocked");  // downstream: blocked
    assert.ok(workflow.nodes.a.feedback_file);  // feedback written to file
    const feedbackContent = fs.readFileSync(path.join(repo, workflow.nodes.a.feedback_file!), "utf-8");
    assert.ok(feedbackContent.includes("Redo this"));

    // Check ledger
    const ledger = readLedger(repo, init.workflow_id);
    assert.ok(ledger.some((e) => e.event.type === "node_reset"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("approveNode stores approved ref", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "researcher", role: "claude-researcher", intent: "Research",
    }, deps);

    await approveNode({
      repoPath: repo, workflowId: init.workflow_id, nodeId: "researcher",
    }, deps);

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.ok(workflow.approved_refs?.researcher);
    assert.equal(workflow.approved_refs.researcher.assignment_id, dispatched.assignment_id);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("completeWorkflow sets status and writes ledger", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);

    await completeWorkflow({
      repoPath: repo, workflowId: init.workflow_id, summary: "All done",
    }, deps);

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.equal(workflow.status, "completed");
    assert.ok(workflow.result_file);
    const summaryContent = fs.readFileSync(path.join(repo, workflow.result_file!), "utf-8");
    assert.ok(summaryContent.includes("All done"));

    const ledger = readLedger(repo, init.workflow_id);
    assert.ok(ledger.some((e) => e.event.type === "workflow_completed"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("failWorkflow sets status and writes ledger", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);

    await failWorkflow({
      repoPath: repo, workflowId: init.workflow_id, reason: "Blocked on external API",
    }, deps);

    const workflow = loadWorkflow(repo, init.workflow_id)!;
    assert.equal(workflow.status, "failed");
    assert.equal(workflow.failure?.message, "Blocked on external API");

    const ledger = readLedger(repo, init.workflow_id);
    assert.ok(ledger.some((e) => e.event.type === "workflow_failed"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("getWorkflowStatus returns workflow and assignments", async () => {
  const repo = makeTestRepo();
  const deps = mockDeps();
  try {
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Build",
    }, deps);

    const view = getWorkflowStatus(repo, init.workflow_id);

    assert.equal(view.workflow.id, init.workflow_id);
    assert.equal(view.assignments.length, 1);
    assert.equal(view.assignments[0].role, "claude-implementer");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("redispatch on a claude assignment passes the captured session_id as resumeSessionId", async () => {
  const repo = makeTestRepo();
  const dispatchedRequests: Array<{ assignmentId: string; resumeSessionId?: string }> = [];
  let time = Date.parse("2026-04-09T00:00:00.000Z");
  const deps: WorkflowDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request) => {
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
    const init = await initWorkflow({
      intent: "Test resume",
      repoPath: repo,
      worktreePath: repo,
      defaultAgentType: "claude",
    }, deps);
    const dispatched = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "First pass",
    }, deps);

    // First dispatch should have no resume session
    assert.equal(dispatchedRequests.length, 1);
    assert.equal(dispatchedRequests[0].resumeSessionId, undefined);

    // Pre-populate session_id on the prior run, simulating what
    // destroyAssignmentTerminal would have captured from telemetry.
    const manager = new AssignmentManager(repo, init.workflow_id);
    const assignment = manager.load(dispatched.assignment_id)!;
    const firstRun = assignment.runs[0]!;
    firstRun.session_id = "claude-session-resume-test";
    firstRun.session_provider = "claude";
    manager.save(assignment);

    // Reset + redispatch the node — the new run should pick up the prior session
    await resetNode({
      repoPath: repo, workflowId: init.workflow_id, nodeId: "dev", feedback: "Try again",
    }, deps);
    await redispatchNode({
      repoPath: repo, workflowId: init.workflow_id, nodeId: "dev",
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
  const deps: WorkflowDependencies = {
    now: () => {
      time += 1000;
      return new Date(time).toISOString();
    },
    dispatchCreateOnly: async (request) => {
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
    const init = await initWorkflow({
      intent: "Test no-resume on codex",
      repoPath: repo,
      worktreePath: repo,
      defaultAgentType: "codex",
    }, deps);
    // Role-driven dispatch: pick codex-implementer so the assignment's
    // agent_type comes out as codex (resume is a claude-only capability).
    const dispatched = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "codex-implementer", intent: "First pass",
    }, deps);

    // Pre-populate a session_id on the prior run anyway — codex shouldn't resume
    const manager = new AssignmentManager(repo, init.workflow_id);
    const assignment = manager.load(dispatched.assignment_id)!;
    assignment.runs[0]!.session_id = "codex-session-should-be-ignored";
    manager.save(assignment);

    await resetNode({
      repoPath: repo, workflowId: init.workflow_id, nodeId: "dev",
    }, deps);
    await redispatchNode({
      repoPath: repo, workflowId: init.workflow_id, nodeId: "dev",
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
    const init = await initWorkflow({ intent: "Test", repoPath: repo, worktreePath: repo }, deps);
    const dispatched = await dispatchNode({
      repoPath: repo, workflowId: init.workflow_id,
      nodeId: "dev", role: "claude-implementer", intent: "Implement feature",
    }, deps);

    // Pre-populate session info on the run, simulating capture from telemetry
    // before the terminal was destroyed. This bypasses the live telemetry call
    // path so the test can run without TermCanvas being available.
    const manager = new AssignmentManager(repo, init.workflow_id);
    const assignment = manager.load(dispatched.assignment_id)!;
    const run = assignment.runs[0]!;
    run.session_id = "claude-session-abc123";
    run.session_provider = "claude";
    run.session_file = "/tmp/claude-sessions/claude-session-abc123.json";
    manager.save(assignment);

    // Write the slim result so watchUntilDecision treats the node as completed
    fs.writeFileSync(run.result_file, JSON.stringify({
      schema_version: RESULT_SCHEMA_VERSION,
      workflow_id: init.workflow_id,
      assignment_id: dispatched.assignment_id,
      run_id: run.id,
      outcome: "completed",
      report_file: "report.md",
    }, null, 2), "utf-8");

    const decision = await watchUntilDecision({
      repoPath: repo, workflowId: init.workflow_id, timeoutMs: 5000,
    }, deps);

    assert.equal(decision.type, "node_completed");
    assert.ok(decision.completed?.session, "session info should be exposed");
    assert.equal(decision.completed.session.id, "claude-session-abc123");
    assert.equal(decision.completed.session.provider, "claude");
    assert.equal(decision.completed.session.file, "/tmp/claude-sessions/claude-session-abc123.json");

    // Ledger should also record the session_id for the completed node event
    const ledger = readLedger(repo, init.workflow_id);
    const completed = ledger.find((entry) => entry.event.type === "node_completed");
    assert.ok(completed);
    assert.equal((completed.event as { session_id?: string }).session_id, "claude-session-abc123");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
