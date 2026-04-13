import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { cleanup } from "../src/cleanup.ts";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { terminalDestroy, terminalStatus } from "../src/termcanvas.ts";
import {
  initWorkbench,
  dispatch,
  redispatch,
  watchUntilDecision,
  approveDispatch,
  resetDispatch,
  completeWorkbench,
  getWorkbenchStatus,
} from "../src/workflow-lead.ts";
import { loadWorkbench } from "../src/workflow-store.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { getReportFilePath } from "../src/artifacts.ts";
import type { AssignmentRecord } from "../src/assignment/types.ts";

interface Args {
  repo: string;
  report: string;
}

interface StageRecord {
  stage: string;
  dispatchId: string;
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
  workbenchId: string,
  assignmentId: string,
  run: AssignmentRecord["runs"][number],
  summary: string,
  outcome: "completed" | "stuck" | "error",
): void {
  const reportFile = getReportFilePath(repoPath, workbenchId, assignmentId, run.id);
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
      workbench_id: workbenchId,
      assignment_id: assignmentId,
      run_id: run.id,
      outcome,
      report_file: reportFile,
    }, null, 2),
    "utf-8",
  );
}

function captureStage(
  dispatchId: string,
  assignmentId: string,
  role: string,
  terminalId: string | null,
  summary: string,
): StageRecord {
  let status: string | null = null;
  if (terminalId) {
    try { status = terminalStatus(terminalId).status; } catch { status = "missing"; }
  }
  return { stage: role, dispatchId, assignmentId, role, terminalId, terminalStatus: status, summary };
}

function renderReport(args: Args, workbenchId: string, records: StageRecord[]): string {
  return [
    "# Hydra Acceptance Report",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Repo: ${args.repo}`,
    `- Workbench ID: ${workbenchId}`,
    `- Mode: Lead-driven dispatch + deterministic result injection`,
    "",
    "## Observed Stages",
    "",
    "| Stage | Dispatch ID | Assignment ID | Terminal ID | Summary |",
    "|-------|-------------|---------------|-------------|---------|",
    ...records.map((r) => `| ${r.stage} | ${r.dispatchId} | ${r.assignmentId} | ${r.terminalId ?? "-"} | ${r.summary} |`),
    "",
    "## Outcome",
    "",
    "- Verified: init, dispatch, watch, approve, reset (reviewer loopback), complete, cleanup.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records: StageRecord[] = [];
  let workbenchId: string | null = null;

  try {
    // 1. Init workbench
    const init = await initWorkbench({
      intent: "Hydra acceptance harness: exercise the Lead-driven control plane.",
      repoPath: args.repo,
      worktreePath: args.repo,
    });
    workbenchId = init.workbench_id;

    // 2. Dispatch the first dispatch (cli/model come from the role file's terminals[0])
    const researcher = await dispatch({
      repoPath: args.repo, workbenchId, dispatchId: "researcher",
      role: "dev", intent: "Produce acceptance research brief.",
    });
    assert.equal(researcher.status, "dispatched");

    // Write researcher result
    const manager = new AssignmentManager(args.repo, workbenchId);
    let assignment = manager.load(researcher.dispatch_id)!;
    let run = latestRun(assignment);
    writeResult(args.repo, workbenchId, assignment.id, run, "Research brief produced.", "completed");
    records.push(captureStage("researcher", assignment.id, "dev", researcher.terminal_id ?? null, "Research brief produced."));

    // 3. Watch → researcher completes
    let decision = await watchUntilDecision({ repoPath: args.repo, workbenchId, timeoutMs: 10_000 });
    assert.equal(decision.type, "dispatch_completed");

    // 4. Approve researcher
    await approveDispatch({ repoPath: args.repo, workbenchId, dispatchId: "researcher" });

    // 5. Dispatch dev
    const dev = await dispatch({
      repoPath: args.repo, workbenchId, dispatchId: "dev",
      role: "dev", intent: "Implement first pass.",
    });
    assert.equal(dev.status, "dispatched");

    assignment = manager.load(dev.dispatch_id)!;
    run = latestRun(assignment);
    writeResult(args.repo, workbenchId, assignment.id, run, "First implementation pass done.", "completed");
    records.push(captureStage("dev", assignment.id, "dev", dev.terminal_id ?? null, "First pass done."));

    decision = await watchUntilDecision({ repoPath: args.repo, workbenchId, timeoutMs: 10_000 });
    assert.equal(decision.type, "dispatch_completed");

    // 6. Dispatch reviewer (codex variant — exercises a cross-CLI workflow)
    const reviewer = await dispatch({
      repoPath: args.repo, workbenchId, dispatchId: "review",
      role: "reviewer", intent: "Review implementation.",
    });
    assert.equal(reviewer.status, "dispatched");

    assignment = manager.load(reviewer.dispatch_id)!;
    run = latestRun(assignment);
    writeResult(args.repo, workbenchId, assignment.id, run, "Found issues, needs rework.", "completed");
    records.push(captureStage("review", assignment.id, "reviewer", reviewer.terminal_id ?? null, "Found issues."));

    decision = await watchUntilDecision({ repoPath: args.repo, workbenchId, timeoutMs: 10_000 });
    assert.equal(decision.type, "dispatch_completed");
    assert.equal(decision.completed?.outcome, "completed");

    // 7. Reset dev based on reviewer feedback
    await resetDispatch({ repoPath: args.repo, workbenchId, dispatchId: "dev", feedback: "Fix the issues the reviewer found." });

    // 8. Re-dispatch the same dev node (reset made it eligible)
    const dev2 = await redispatch({
      repoPath: args.repo, workbenchId, dispatchId: "dev", intent: "Fix reviewer findings.",
    });
    assert.equal(dev2.status, "dispatched");

    assignment = manager.load(dev2.dispatch_id)!;
    run = latestRun(assignment);
    writeResult(args.repo, workbenchId, assignment.id, run, "Fixed all reviewer findings.", "completed");
    records.push(captureStage("dev", assignment.id, "dev", dev2.terminal_id ?? null, "Fixed findings."));

    decision = await watchUntilDecision({ repoPath: args.repo, workbenchId, timeoutMs: 10_000 });
    assert.equal(decision.type, "dispatch_completed");

    // 9. Complete
    await completeWorkbench({ repoPath: args.repo, workbenchId, summary: "Acceptance test passed." });
    const final = getWorkbenchStatus(args.repo, workbenchId);
    assert.equal(final.workbench.status, "completed");

    // Write report
    fs.mkdirSync(path.dirname(args.report), { recursive: true });
    fs.writeFileSync(args.report, renderReport(args, workbenchId, records), "utf-8");
    console.log(JSON.stringify({ workbenchId, report: args.report, stages: records, finalStatus: "completed" }, null, 2));
  } finally {
    if (workbenchId) {
      try { await cleanup(["--workbench", workbenchId, "--repo", args.repo, "--force"]); } catch {}
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
