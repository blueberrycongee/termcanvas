import fs from "node:fs";
import path from "node:path";
import {
  PROTOCOL_VERSION,
  buildTaskPackagePaths,
  type HandoffContract,
  type ProtocolAgent,
  type ProtocolContext,
  type ProtocolTask,
  type TaskPackagePaths,
} from "./protocol.ts";

export interface BuildTaskPackageContextInput {
  workspaceRoot: string;
  workflowId: string;
  handoffId: string;
  createdAt?: string;
  from: ProtocolAgent;
  to: ProtocolAgent;
  task: ProtocolTask;
  context: ProtocolContext;
}

export interface TaskPackageContext {
  contract: HandoffContract;
}

export function buildTaskPackageDir(
  workspaceRoot: string,
  workflowId: string,
  handoffId: string,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    ".hydra",
    "workflows",
    workflowId,
    handoffId,
  );
}

export function buildTaskPackageContext(
  input: BuildTaskPackageContextInput,
): TaskPackageContext {
  const packageDir = buildTaskPackageDir(input.workspaceRoot, input.workflowId, input.handoffId);

  return {
    contract: {
      version: PROTOCOL_VERSION,
      handoff_id: input.handoffId,
      workflow_id: input.workflowId,
      created_at: input.createdAt ?? new Date().toISOString(),
      from: input.from,
      to: input.to,
      task: input.task,
      context: input.context,
      artifacts: buildTaskPackagePaths(packageDir),
    },
  };
}

function renderList(items: string[], emptyMessage: string): string[] {
  if (items.length === 0) {
    return [`- ${emptyMessage}`];
  }
  return items.map((item) => `- ${item}`);
}

export function renderTaskPackageTemplate(contract: HandoffContract): string {
  const lines = [
    "# Hydra Task Package",
    "",
    "This task is controlled by Hydra's file contract. Terminal conversation is not a source of truth.",
    "",
    "## Handoff",
    "",
    `- Version: ${contract.version}`,
    `- Workflow ID: ${contract.workflow_id}`,
    `- Handoff ID: ${contract.handoff_id}`,
    `- Created At: ${contract.created_at}`,
    `- From: ${contract.from.role} (${contract.from.agent_type})`,
    `- To: ${contract.to.role} (${contract.to.agent_type})`,
    "",
    "## Task",
    "",
    `- Type: ${contract.task.type}`,
    `- Title: ${contract.task.title}`,
    "",
    contract.task.description,
    "",
    "## Acceptance Criteria",
    "",
    ...renderList(contract.task.acceptance_criteria, "No acceptance criteria provided."),
    "",
    "## Skills",
    "",
    ...renderList(contract.task.skills ?? [], "No additional skills required."),
    "",
    "## Input Contract",
    "",
    `- Handoff file: ${contract.artifacts.handoff_file}`,
    ...renderList(contract.context.files, "No input files provided."),
    "",
    "## Output Contract",
    "",
    `- Result file: ${contract.artifacts.result_file}`,
    `- Done marker: ${contract.artifacts.done_file}`,
    "- Result schema requirements:",
    "  - success: boolean",
    "  - summary: string",
    "  - outputs[]: path + description",
    "  - evidence[]: commands, tests, or file checks",
    "  - next_action: complete | retry | handoff",
    "",
    "## Rules",
    "",
    "- Stay within this worktree/package scope.",
    "- Root cause first. Fix the real implementation problem before changing tests or fixtures.",
    "- Do not treat terminal natural language as completion evidence.",
    "- Do not hack tests, fixtures, snapshots, or mocks to satisfy the contract.",
    "- Do not fake outputs or overfit to the current data just to get a passing result.",
    "- Surface failures explicitly; do not add silent fallbacks or swallowed errors.",
    "- You must write both `result.json` and `done` before finishing.",
    `- The done marker must point to ${contract.artifacts.result_file}.`,
    "",
  ];

  return lines.join("\n");
}

export function writeTaskPackage(contract: HandoffContract): TaskPackagePaths {
  fs.mkdirSync(contract.artifacts.package_dir, { recursive: true });
  fs.writeFileSync(
    contract.artifacts.handoff_file,
    JSON.stringify(contract, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    contract.artifacts.task_file,
    renderTaskPackageTemplate(contract),
    "utf-8",
  );
  return contract.artifacts;
}
