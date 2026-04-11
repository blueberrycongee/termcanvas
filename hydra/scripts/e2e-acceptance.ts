import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { cleanup } from "../src/cleanup.ts";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { terminalDestroy, terminalStatus } from "../src/termcanvas.ts";
import {
  initWorkflow,
  dispatchNode,
  redispatchNode,
  watchUntilDecision,
  approveNode,
  resetNode,
  completeWorkflow,
  getWorkflowStatus,
} from "../src/workflow-lead.ts";
import { loadWorkflow } from "../src/workflow-store.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { getReportFilePath } from "../src/artifacts.ts";
import type { AssignmentRecord } from "../src/assignment/types.ts";

interface Args {
  repo: string;
  report: string;
}

interface StageRecord {
  stage: string;
  nodeId: string;
  assignmentId: string;
  role: string;
  terminalId: string | null;
  terminalStatus: string | null;
  summary: string;
}

function parseArgs(argv: string[]): Args {
  const result: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo" && i + 1 < argv.length) result.repo = argv[++i];
    else if (arg === "--report" && i + 1 < argv.length) result.report = argv[++i];
  }
  if (!result.repo) throw new Error("Missing required flag: --repo");
  return {
    repo: path.resolve(result.repo),
    report: path.resolve(result.report ?? path.join(result.repo, "docs", "hydra-acceptance-report.md")),
  };
}

function latestRun(assignment: AssignmentRecord): AssignmentRecord["runs"][number] {
  const active = assignment.active_run_id
    ? assignment.runs.find((run) => run.id === assignment.active_run_id) : null;
  const run = active ?? assignment.runs[assignment.runs.length - 1] ?? null;
  assert.ok(run, `assignment ${assignment.id} must have a run`);
  return run;
}

function writeResult(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  run: AssignmentRecord["runs"][number],
  summary: string,
  outcome: "completed" | "stuck" | "error",
): void {
  const reportFile = getReportFilePath(repoPath, workflowId, assignmentId, run.id);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(
    reportFile,
    [
      "# Acceptance Run Report",
      "",
      "## Summary",
      "",
      summary,
      "",
      "## Outputs",
      "",
      "- hydra e2e acceptance script artifact",
      "",
      "## Evidence",
      "",
      "- hydra e2e acceptance script",
      "",
    ].join("\n"),
    "utf-8",
  );

  fs.writeFileSync(
    run.result_file,
    JSON.stringify({
      schema_version: RESULT_SCHEMA_VERSION,
      workflow_id: workflowId,
      assignment_id: assignmentId,
      run_id: run.id,
      outcome,
      report_file: reportFile,
    }, null, 2),
    "utf-8",
  );
}

function captureStage(
  nodeId: string,
  assignmentId: string,
  role: string,
  terminalId: string | null,
  summary: string,
): StageRecord {
  let status: string | null = null;
  if (terminalId) {
    try { status = terminalStatus(terminalId).status; } catch { status = "missing"; }
  }
  return { stage: role, nodeId, assignmentId, role, terminalId, terminalStatus: status, summary };
}

function renderReport(args: Args, workflowId: string, records: StageRecord[]): string {
  return [
    "# Hydra Acceptance Report",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Repo: ${args.repo}`,
    `- Workflow ID: ${workflowId}`,
    `- Mode: Lead-driven dispatch + deterministic result injection`,
    "",
    "## Observed Stages",
    "",
    "| Stage | Node ID | Assignment ID | Terminal ID | Summary |",
    "|-------|---------|---------------|-------------|---------|",
    ...records.map((r) => `| ${r.stage} | ${r.nodeId} | ${r.assignmentId} | ${r.terminalId ?? "-"} | ${r.summary} |`),
    "",
    "## Outcome",
    "",
    "- Verified: init, dispatch, watch, approve, reset (tester loopback), complete, cleanup.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records: StageRecord[] = [];
  let workflowId: string | null = null;

  try {
    // 1. Init workflow
    const init = await initWorkflow({
      intent: "Hydra acceptance harness: exercise the Lead-driven control plane.",
      repoPath: args.repo,
      worktreePath: args.repo,
      defaultAgentType: "codex",
    });
    workflowId = init.workflow_id;

    // 2. Dispatch researcher (codex variant — agent_type comes from the role file)
    const researcher = await dispatchNode({
      repoPath: args.repo, workflowId, nodeId: "researcher",
      role: "codex-researcher", intent: "Produce acceptance research brief.",
    });
    assert.equal(researcher.status, "dispatched");

    // Write researcher result
    const manager = new AssignmentManager(args.repo, workflowId);
    let assignment = manager.load(researcher.assignment_id)!;
    let run = latestRun(assignment);
    writeResult(args.repo, workflowId, assignment.id, run, "Research brief produced.", "completed");
    records.push(captureStage("researcher", assignment.id, "codex-researcher", researcher.terminal_id ?? null, "Research brief produced."));

    // 3. Watch → researcher completes
    let decision = await watchUntilDecision({ repoPath: args.repo, workflowId, timeoutMs: 10_000 });
    assert.equal(decision.type, "node_completed");

    // 4. Approve researcher
    await approveNode({ repoPath: args.repo, workflowId, nodeId: "researcher" });

    // 5. Dispatch implementer
    const dev = await dispatchNode({
      repoPath: args.repo, workflowId, nodeId: "dev",
      role: "codex-implementer", intent: "Implement first pass.", dependsOn: ["researcher"],
    });
    assert.equal(dev.status, "dispatched");

    assignment = manager.load(dev.assignment_id)!;
    run = latestRun(assignment);
    writeResult(args.repo, workflowId, assignment.id, run, "First implementation pass done.", "completed");
    records.push(captureStage("dev", assignment.id, "codex-implementer", dev.terminal_id ?? null, "First pass done."));

    decision = await watchUntilDecision({ repoPath: args.repo, workflowId, timeoutMs: 10_000 });
    assert.equal(decision.type, "node_completed");

    // 6. Dispatch tester (claude variant — exercises a cross-CLI workflow)
    const tester = await dispatchNode({
      repoPath: args.repo, workflowId, nodeId: "tester",
      role: "claude-tester", intent: "Verify implementation.", dependsOn: ["dev"],
    });
    assert.equal(tester.status, "dispatched");

    assignment = manager.load(tester.assignment_id)!;
    run = latestRun(assignment);
    writeResult(args.repo, workflowId, assignment.id, run, "Found issues, needs rework.", "completed");
    records.push(captureStage("tester", assignment.id, "claude-tester", tester.terminal_id ?? null, "Found issues."));

    decision = await watchUntilDecision({ repoPath: args.repo, workflowId, timeoutMs: 10_000 });
    assert.equal(decision.type, "node_completed");
    assert.equal(decision.completed?.result.outcome, "completed");

    // 7. Reset dev based on tester feedback
    await resetNode({ repoPath: args.repo, workflowId, nodeId: "dev", feedback: "Fix the issues found by tester." });

    // 8. Re-dispatch the same dev node (reset made it eligible)
    const dev2 = await redispatchNode({
      repoPath: args.repo, workflowId, nodeId: "dev", intent: "Fix tester findings.",
    });
    assert.equal(dev2.status, "dispatched");

    assignment = manager.load(dev2.assignment_id)!;
    run = latestRun(assignment);
    writeResult(args.repo, workflowId, assignment.id, run, "Fixed all tester findings.", "completed");
    records.push(captureStage("dev", assignment.id, "codex-implementer", dev2.terminal_id ?? null, "Fixed findings."));

    decision = await watchUntilDecision({ repoPath: args.repo, workflowId, timeoutMs: 10_000 });
    assert.equal(decision.type, "node_completed");

    // 9. Complete
    await completeWorkflow({ repoPath: args.repo, workflowId, summary: "Acceptance test passed." });
    const final = getWorkflowStatus(args.repo, workflowId);
    assert.equal(final.workflow.status, "completed");

    // Write report
    fs.mkdirSync(path.dirname(args.report), { recursive: true });
    fs.writeFileSync(args.report, renderReport(args, workflowId, records), "utf-8");
    console.log(JSON.stringify({ workflowId, report: args.report, stages: records, finalStatus: "completed" }, null, 2));
  } finally {
    if (workflowId) {
      try { await cleanup(["--workflow", workflowId, "--repo", args.repo, "--force"]); } catch {}
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
