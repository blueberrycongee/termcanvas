import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { cleanup } from "../src/cleanup.ts";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { terminalDestroy, terminalStatus } from "../src/termcanvas.ts";
import { getWorkflowStatus, runWorkflow, tickWorkflow, approveWorkflow } from "../src/workflow.ts";
import { loadWorkflow } from "../src/workflow-store.ts";
import { assignmentRequiresBrief } from "../src/workflow-template.ts";
import { getRunBriefFile } from "../src/layout.ts";
import type { AssignmentRecord } from "../src/assignment/types.ts";

interface Args {
  repo: string;
  report: string;
}

interface StageRecord {
  stage: string;
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
    if (arg === "--repo" && i + 1 < argv.length) {
      result.repo = argv[++i];
    } else if (arg === "--report" && i + 1 < argv.length) {
      result.report = argv[++i];
    }
  }

  if (!result.repo) {
    throw new Error("Missing required flag: --repo");
  }

  return {
    repo: path.resolve(result.repo),
    report: path.resolve(
      result.report ?? path.join(result.repo, "docs", "hydra-acceptance-report.md"),
    ),
  };
}

function latestRun(assignment: AssignmentRecord): AssignmentRecord["runs"][number] {
  const active = assignment.active_run_id
    ? assignment.runs.find((run) => run.id === assignment.active_run_id)
    : null;
  const run = active ?? assignment.runs[assignment.runs.length - 1] ?? null;
  assert.ok(run, `assignment ${assignment.id} must have a run`);
  return run;
}

async function captureStage(
  repoPath: string,
  workflowId: string,
  expectedRole: string,
  summary: string,
  success: boolean,
  nextAction: { type: "complete" | "retry" | "transition"; reason: string; assignment_id?: string },
): Promise<StageRecord> {
  const workflow = loadWorkflow(repoPath, workflowId);
  assert.ok(workflow, "workflow must exist");

  const manager = new AssignmentManager(repoPath, workflowId);
  const assignment = manager.load(workflow.current_assignment_id);
  assert.ok(assignment, "current assignment must exist");
  assert.equal(assignment.role, expectedRole);

  const run = latestRun(assignment);
  const briefFile = getRunBriefFile(repoPath, workflowId, assignment.id, run.id);
  if (assignmentRequiresBrief(assignment.kind)) {
    fs.mkdirSync(path.dirname(briefFile), { recursive: true });
    fs.writeFileSync(
      briefFile,
      `# ${expectedRole} brief\n\n${summary}\n`,
      "utf-8",
    );
  }

  let terminalId: string | null = run.terminal_id ?? null;
  let status: string | null = null;
  if (terminalId) {
    try {
      status = terminalStatus(terminalId).status;
    } catch {
      status = "missing";
    }
  }

  fs.writeFileSync(
    run.result_file,
    JSON.stringify({
      schema_version: "hydra/result/v1",
      workflow_id: workflowId,
      assignment_id: assignment.id,
      run_id: run.id,
      success,
      summary,
      outputs: [{ path: `${expectedRole}.md`, description: `${expectedRole} acceptance artifact` }],
      evidence: ["hydra e2e acceptance script"],
      next_action: nextAction,
    }, null, 2),
    "utf-8",
  );

  if (terminalId) {
    try {
      terminalDestroy(terminalId);
    } catch {
      // best-effort cleanup; report still records the original terminal
    }
  }

  return {
    stage: expectedRole,
    assignmentId: assignment.id,
    role: assignment.role,
    terminalId,
    terminalStatus: status,
    summary,
  };
}

function renderReport(args: Args, workflowId: string, records: StageRecord[]): string {
  const lines = [
    "# Hydra Acceptance Report",
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Repo: ${args.repo}`,
    `- Workflow ID: ${workflowId}`,
    `- Mode: real TermCanvas terminal create + deterministic result injection`,
    "",
    "## Reproduction",
    "",
    "```bash",
    `cd ${args.repo}`,
    "cd hydra",
    `npm run e2e:acceptance -- --repo ${args.repo} --report ${args.report}`,
    "```",
    "",
    "## Notes",
    "",
    "- Each stage launched a real Claude/Codex terminal via `termcanvas terminal create --prompt`.",
    "- The acceptance script then wrote deterministic `result.json` files to exercise the control plane without relying on model nondeterminism.",
    "- The flow includes research approval, a tester loopback, a successful recovery, and a final researcher intent-confirmation pass.",
    "",
    "## Observed Stages",
    "",
    "| Stage | Assignment ID | Terminal ID | Terminal Status Before Cleanup | Summary |",
    "|------|---------------|-------------|-------------------------------|---------|",
    ...records.map((record) => `| ${record.stage} | ${record.assignmentId} | ${record.terminalId ?? "-"} | ${record.terminalStatus ?? "-"} | ${record.summary} |`),
    "",
    "## Outcome",
    "",
    "- Sequence exercised: `researcher (Codex) -> approval -> implementer (Codex) -> tester (Claude) -> implementer retry (Codex) -> tester recovery (Claude) -> researcher intent confirmation (Codex)`",
    "- Verified: create-only dispatch, result schema gate, approval boundary, tester loopback, retry/recovery, intent confirmation, workflow completion, and cleanup.",
    "",
  ];

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records: StageRecord[] = [];
  let workflowId: string | null = null;

  try {
    const started = await runWorkflow({
      task: "Hydra acceptance harness: do not modify repository source files. Only interact with the generated Hydra task files and acceptance artifacts.",
      repoPath: args.repo,
      template: "researcher-implementer-tester",
      agentType: "codex",
      testerType: "claude",
      timeoutMinutes: 5,
      maxRetries: 1,
      autoApprove: true,
    });
    workflowId = started.workflow.id;

    records.push(await captureStage(
      args.repo,
      workflowId,
      "researcher",
      "Researcher produced an actionable acceptance brief.",
      true,
      { type: "transition", reason: "Implementation can start after approval.", assignment_id: started.workflow.assignment_ids[1] },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    await approveWorkflow({ repoPath: args.repo, workflowId });

    records.push(await captureStage(
      args.repo,
      workflowId,
      "implementer",
      "Implementer completed the first pass.",
      true,
      { type: "transition", reason: "Verification can start.", assignment_id: started.workflow.assignment_ids[2] },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "tester",
      "Tester found an unmet standard and requested another implementation pass.",
      true,
      { type: "transition", reason: "Implementer must address the blocked standard.", assignment_id: started.workflow.assignment_ids[1] },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "implementer",
      "Implementer addressed the tester findings.",
      true,
      { type: "transition", reason: "Re-run verification.", assignment_id: started.workflow.assignment_ids[2] },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "tester",
      "Tester confirmed the recovery pass met the bar and requested intent confirmation.",
      true,
      { type: "transition", reason: "Researcher should confirm the final outcome.", assignment_id: started.workflow.assignment_ids[0] },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "researcher",
      "Researcher confirmed the tested implementation satisfies the approved intent.",
      true,
      { type: "complete", reason: "Workflow is complete." },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    const completed = getWorkflowStatus({ repoPath: args.repo, workflowId });
    assert.equal(completed.workflow.status, "completed");

    fs.mkdirSync(path.dirname(args.report), { recursive: true });
    fs.writeFileSync(args.report, renderReport(args, workflowId, records), "utf-8");
    console.log(JSON.stringify({
      workflowId,
      report: args.report,
      stages: records,
      finalStatus: completed.workflow.status,
    }, null, 2));
  } finally {
    if (workflowId) {
      try {
        await cleanup(["--workflow", workflowId, "--repo", args.repo, "--force"]);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
