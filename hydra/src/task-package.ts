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
    "### Baseline (do this first, stop early if it fails)",
    "",
    "Run the test suite and build. If available, use Playwright, Puppeteer, or Cypress for UI verification. If either tests or build fail, report immediately — no further evaluation needed.",
    "",
    "### Deep evaluation (do this when the baseline passes)",
    "",
    "CI passing is table stakes. Focus on what automated checks cannot catch:",
    "",
    "- **Intent vs. implementation gap** — Read the planner spec, then read the code. Does the code actually deliver what was asked? A function that compiles but returns hardcoded data is a CI pass and a real failure.",
    "- **Stub and mock detection** — Search for empty function bodies, `// TODO` standing in for logic, placeholder return values, and test mocks that leaked into production code.",
    "- **Over/under-engineering** — Unnecessary abstractions, premature generalization, and god objects are defects. So is copy-paste duplication and magic numbers.",
    "- **Test honesty** — A test that asserts `expect(true).toBe(true)` or only validates a mock's return value is worse than no test — it creates false confidence. Flag dead tests, tautological assertions, and tests brittle to implementation details.",
    "- **User-facing quality** — For UI: try the interaction flow end to end. For APIs: check error responses, not just happy paths. For CLI: test discoverability and help text.",
    "- **Architectural coherence** — Does the new code follow existing patterns in the codebase, or does it introduce a conflicting style?",
    "",
    "### Reporting",
    "",
    "Include a `verification` object in your result JSON so the next agent knows exactly what was checked:",
    "```json",
    '"verification": {',
    '  "runtime":  { "ran": true,  "pass": true,  "detail": "42 tests passed" },',
    '  "build":    { "ran": true,  "pass": true,  "detail": "tsc clean" },',
    '  "probing":  { "ran": true,  "pass": false, "detail": "signup flow hangs after email input — no loading state" },',
    '  "static":   { "ran": true,  "pass": false, "detail": "handlePayment() is a stub returning hardcoded success" }',
    "}",
    "```",
    "If your highest completed tier is static analysis, explain why higher tiers were unavailable and apply stricter judgment before claiming success.",
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
