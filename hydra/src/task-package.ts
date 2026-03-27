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

function renderEvaluatorVerificationStrategy(role: string): string[] {
  if (role !== "evaluator") {
    return [];
  }
  return [
    "## Verification Strategy",
    "",
    "You are a QA engineer. Use the most rigorous verification available in this environment, in priority order:",
    "",
    "1. **Runtime verification** — run the test suite (`npm test`, `pytest`, `cargo test`, etc.). If a dev server can be started, start it and probe key endpoints or interactions. If Playwright, Puppeteer, or Cypress are available, use them.",
    "2. **Build verification** — confirm the project builds and type-checks cleanly (`tsc --noEmit`, `npm run build`, etc.).",
    "3. **Targeted probing** — write temporary scripts or assertions to exercise critical paths. Inspect actual output, not just code structure.",
    "4. **Static analysis** — only fall back to reading code when the above methods are genuinely unavailable.",
    "",
    "Report evidence from the highest tier you can reach. \"The code looks correct\" is not acceptable when tests exist and can be run.",
    "",
  ];
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
    "- Result JSON must be valid hydra/v2 JSON:",
    "```json",
    "{",
    `  "version": "${contract.version}",`,
    `  "handoff_id": "${contract.handoff_id}",`,
    `  "workflow_id": "${contract.workflow_id}",`,
    '  "success": true,',
    '  "summary": "Explain what changed and whether the handoff passed.",',
    '  "outputs": [{ "path": "path/to/file", "description": "Describe the output." }],',
    '  "evidence": ["npm test", "manual review"],',
    '  "next_action": {',
    '    "type": "complete",',
    '    "reason": "Why Hydra should complete, retry, or hand off next."',
    "  }",
    "}",
    "```",
    "- `next_action.type` must be one of: complete | retry | handoff",
    "- `next_action.reason` must be a non-empty string",
    "- `next_action.handoff_id` is required when next_action.type=handoff",
    "- Done marker must be valid JSON:",
    "```json",
    "{",
    `  "version": "${contract.version}",`,
    `  "handoff_id": "${contract.handoff_id}",`,
    `  "workflow_id": "${contract.workflow_id}",`,
    `  "result_file": "${contract.artifacts.result_file}"`,
    "}",
    "```",
    "",
    "## Telemetry Checks",
    "",
    "- For long-running waits, suspected stalls, or takeover/retry decisions, query telemetry instead of reading terminal prose.",
    `- Workflow snapshot: termcanvas telemetry get --workflow ${contract.workflow_id} --repo .`,
    "- Terminal snapshot when you know the active terminal ID: termcanvas telemetry get --terminal <terminalId>",
    "- Recent events when you need more detail: termcanvas telemetry events --terminal <terminalId> --limit 20",
    "- Keep waiting when telemetry shows recent meaningful progress, `thinking`, `tool_running`, `tool_pending`, or a foreground tool.",
    "- `awaiting_contract` means the model turn finished but `result.json` / `done` is still pending.",
    "- `stall_candidate` means investigate before retrying or taking over.",
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
    `- Write the done marker JSON to ${contract.artifacts.done_file}; do not write a plain-text path.`,
    "",
    ...renderEvaluatorVerificationStrategy(contract.to.role),
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
