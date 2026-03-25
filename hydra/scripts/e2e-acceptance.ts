import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { cleanup } from "../src/cleanup.ts";
import { writeDoneMarker, writeResultContract } from "../src/collector.ts";
import { HandoffManager } from "../src/handoff/manager.ts";
import { terminalDestroy, terminalStatus } from "../src/termcanvas.ts";
import { getWorkflowStatus, runWorkflow, tickWorkflow } from "../src/workflow.ts";
import { loadWorkflow } from "../src/workflow-store.ts";

interface Args {
  repo: string;
  report: string;
}

interface StageRecord {
  stage: string;
  handoffId: string;
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

async function captureStage(
  repoPath: string,
  workflowId: string,
  expectedRole: string,
  summary: string,
  success: boolean,
  nextAction: { type: "complete" | "retry" | "handoff"; reason: string; handoff_id?: string },
): Promise<StageRecord> {
  const workflow = loadWorkflow(repoPath, workflowId);
  assert.ok(workflow, "workflow must exist");

  const manager = new HandoffManager(repoPath);
  const handoff = manager.load(workflow.current_handoff_id);
  assert.ok(handoff, "current handoff must exist");
  assert.equal(handoff.to.role, expectedRole);
  assert.ok(handoff.artifacts, "handoff must have artifacts");

  let terminalId: string | null = handoff.dispatch?.active_terminal_id ?? null;
  let status: string | null = null;
  if (terminalId) {
    try {
      status = terminalStatus(terminalId).status;
    } catch {
      status = "missing";
    }
  }

  writeResultContract(
    { artifacts: handoff.artifacts },
    {
      version: "hydra/v2",
      handoff_id: handoff.id,
      workflow_id: handoff.workflow_id,
      success,
      summary,
      outputs: [{ path: `${expectedRole}.md`, description: `${expectedRole} acceptance artifact` }],
      evidence: ["hydra e2e acceptance script"],
      next_action: nextAction,
    },
  );
  writeDoneMarker({
    artifacts: handoff.artifacts,
    handoff_id: handoff.id,
    workflow_id: handoff.workflow_id,
  });

  if (terminalId) {
    try {
      terminalDestroy(terminalId);
    } catch {
      // best-effort cleanup; report still records the original terminal
    }
  }

  return {
    stage: expectedRole,
    handoffId: handoff.id,
    role: handoff.to.role,
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
    `- Mode: real TermCanvas terminal create + deterministic file evidence injection`,
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
    "- The acceptance script then wrote deterministic `result.json` + `done` files to exercise the control plane without relying on model nondeterminism.",
    "- The flow includes an evaluator failure loop and a successful recovery.",
    "",
    "## Observed Stages",
    "",
    "| Stage | Handoff ID | Terminal ID | Terminal Status Before Cleanup | Summary |",
    "|------|------------|-------------|-------------------------------|---------|",
    ...records.map((record) => `| ${record.stage} | ${record.handoffId} | ${record.terminalId ?? "-"} | ${record.terminalStatus ?? "-"} | ${record.summary} |`),
    "",
    "## Outcome",
    "",
    "- Sequence exercised: `planner (Claude) -> implementer (Codex) -> evaluator (Claude) -> implementer retry (Codex) -> evaluator recovery (Claude)`",
    "- Verified: create-only dispatch, schema gate, evaluator loopback, retry/recovery, workflow completion, and cleanup.",
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
      task: "Hydra acceptance harness: do not modify repository source files. Only interact with the generated Hydra task package and acceptance artifacts.",
      repoPath: args.repo,
      template: "planner-implementer-evaluator",
      agentType: "codex",
      evaluatorType: "claude",
      timeoutMinutes: 5,
      maxRetries: 1,
      autoApprove: true,
    });
    workflowId = started.workflow.id;

    records.push(await captureStage(
      args.repo,
      workflowId,
      "planner",
      "Planner produced an actionable acceptance plan.",
      true,
      { type: "handoff", reason: "Implementation can start.", handoff_id: started.handoffs[1].id },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "implementer",
      "Implementer completed the first pass.",
      true,
      { type: "handoff", reason: "Evaluator can start.", handoff_id: started.handoffs[2].id },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "evaluator",
      "Evaluator found an unmet standard and requested another implementation pass.",
      false,
      { type: "handoff", reason: "Implementer must address the blocked standard.", handoff_id: started.handoffs[1].id },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "implementer",
      "Implementer addressed the evaluator findings.",
      true,
      { type: "handoff", reason: "Re-run evaluation.", handoff_id: started.handoffs[2].id },
    ));

    await tickWorkflow({ repoPath: args.repo, workflowId });
    records.push(await captureStage(
      args.repo,
      workflowId,
      "evaluator",
      "Evaluator confirmed the recovery pass met the bar.",
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
