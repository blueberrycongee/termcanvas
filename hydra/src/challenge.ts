import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./handoff/types.ts";
import {
  dispatchCreateOnly as defaultDispatchCreateOnly,
  type DispatchCreateOnlyRequest,
  type DispatchCreateOnlyResult,
} from "./dispatcher.ts";

export interface ChallengeWorker {
  id: string;
  methodology: string;
  terminal_id: string;
  dir: string;
  task_file: string;
  result_file: string;
  done_file: string;
}

export interface ChallengeState {
  workers: ChallengeWorker[];
  started_at: string;
  evaluator_handoff_id: string;
}

export interface ChallengeFinding {
  point: string;
  severity: "critical" | "significant" | "minor";
  reasoning: string;
}

export interface ChallengeDecision {
  override: boolean;
  findings: ChallengeFinding[];
  summary: string;
}

const METHODOLOGIES = [
  {
    id: "missed-failures",
    name: "Missed Failures",
    prompt: [
      "You are an adversarial code reviewer. Your sole task: find specific, concrete scenarios where the implementation FAILS that the evaluator did not catch.",
      "",
      "Do not review abstractly. For each finding:",
      "1. Describe the exact scenario (input, state, sequence of actions)",
      "2. Explain what goes wrong (crash, wrong output, data corruption, UI break)",
      "3. Verify by reading the code path or testing in the browser with `browse`",
      "",
      "Focus on: error paths, concurrent operations, empty/null/boundary inputs, permission edge cases, and interactions between changed and unchanged code.",
      "",
      "If you cannot find real failures, say so honestly. Do not invent problems.",
    ].join("\n"),
  },
  {
    id: "assumption-audit",
    name: "Assumption Audit",
    prompt: [
      "You are an adversarial code reviewer. Your sole task: identify every assumption the evaluator made when declaring success, then assess which are UNJUSTIFIED.",
      "",
      "Read the evaluator's verification results carefully. For each check they claim passed, ask:",
      "1. Did they actually test this, or did they assume it from reading code?",
      "2. Did they test the right thing, or a superficial proxy?",
      "3. Did they test with realistic data, or trivial/empty inputs?",
      "4. Did they verify the negative case (what happens when it should fail)?",
      "",
      "An assumption is unjustified if the evaluator's evidence does not support it. Rank from most dangerous to least dangerous.",
    ].join("\n"),
  },
  {
    id: "edge-cases",
    name: "Edge Cases",
    prompt: [
      "You are an adversarial code reviewer. Your sole task: push every changed code path to its boundary conditions and see what breaks.",
      "",
      "For each significant change in the implementation:",
      "1. What happens with zero items? One item? Thousands of items?",
      "2. What happens with the longest possible string? Empty string? Unicode/emoji?",
      "3. What happens when the network is slow, the disk is full, or a dependency throws?",
      "4. What happens when two users do the same thing simultaneously?",
      "5. What happens at the exact boundary of any conditional (off-by-one, fence-post)?",
      "",
      "Use `browse` to test UI edge cases in a real browser. Use the test suite to verify backend edge cases. Do not speculate — verify.",
    ].join("\n"),
  },
  {
    id: "regression-hunter",
    name: "Regression Hunter",
    prompt: [
      "You are an adversarial code reviewer. Your sole task: find regressions — things that USED TO WORK but are now broken because of the implementation changes.",
      "",
      "Strategy:",
      "1. Run `git diff` to see every file that changed",
      "2. For each changed file, identify the EXISTING functionality (not the new feature)",
      "3. Verify that existing functionality still works by testing it",
      "4. Pay special attention to: shared utilities that got modified, CSS changes that affect other components, API changes that have other callers, state management changes that affect other flows",
      "",
      "Use `browse` to test any UI regression visually. Check the test suite for existing tests that might now be subtly wrong.",
      "",
      "Regressions in unchanged behavior are the most critical findings.",
    ].join("\n"),
  },
] as const;

function generateWorkerId(): string {
  return `challenge-${crypto.randomBytes(4).toString("hex")}`;
}

function renderChallengeTask(
  methodology: typeof METHODOLOGIES[number],
  workflowId: string,
  workerId: string,
  evaluatorResultFile: string,
  plannerResultFile: string,
  resultFile: string,
  doneFile: string,
): string {
  return [
    "# Challenge Review Task",
    "",
    `Workflow: ${workflowId}`,
    `Worker: ${workerId} (${methodology.name})`,
    "",
    "## Your Role",
    "",
    methodology.prompt,
    "",
    "## Context Files",
    "",
    `- Evaluator's verification results: ${evaluatorResultFile}`,
    `- Planner's requirements: ${plannerResultFile}`,
    "- Run `git diff` to see implementation changes",
    "",
    "## Rules",
    "",
    "- You are READ-ONLY. Do NOT modify any source code.",
    "- You MAY run tests, use `browse`, and read any file.",
    "- Focus on REAL problems, not style or hypotheticals.",
    "- Each finding must include concrete evidence (file:line, test output, screenshot).",
    "",
    "## Output Contract",
    "",
    `Write your result to: ${resultFile}`,
    "",
    "```json",
    "{",
    '  "success": true,',
    '  "summary": "One-paragraph synthesis of findings",',
    '  "findings": [',
    "    {",
    '      "point": "Specific problem description",',
    '      "severity": "critical | significant | minor",',
    '      "reasoning": "Why this matters, with evidence"',
    "    }",
    "  ],",
    '  "outputs": [],',
    '  "evidence": ["list of verification methods used"],',
    '  "next_action": { "type": "complete", "reason": "Challenge review complete" }',
    "}",
    "```",
    "",
    "Set success=false ONLY if you found critical or significant issues.",
    "Minor-only findings = success=true.",
    "",
    `Then write the done marker to: ${doneFile}`,
    "```json",
    "{",
    `  "workflow_id": "${workflowId}",`,
    `  "worker_id": "${workerId}",`,
    `  "result_file": "${resultFile}"`,
    "}",
    "```",
  ].join("\n");
}

export async function spawnChallengeWorkers(
  config: {
    workflowId: string;
    repoPath: string;
    worktreePath: string;
    evaluatorResultFile: string;
    plannerResultFile: string;
    evaluatorHandoffId: string;
    autoApprove: boolean;
    agentType: AgentType;
    parentTerminalId?: string;
  },
  dispatchCreateOnly: (req: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult> = defaultDispatchCreateOnly,
): Promise<ChallengeState> {
  const challengeDir = path.join(
    path.resolve(config.repoPath),
    ".hydra", "workflows", config.workflowId, "challenge",
  );
  const workers: ChallengeWorker[] = [];

  for (const methodology of METHODOLOGIES) {
    const workerId = generateWorkerId();
    const workerDir = path.join(challengeDir, workerId);
    fs.mkdirSync(workerDir, { recursive: true });

    const taskFile = path.join(workerDir, "task.md");
    const resultFile = path.join(workerDir, "result.json");
    const doneFile = path.join(workerDir, "done");

    fs.writeFileSync(taskFile, renderChallengeTask(
      methodology,
      config.workflowId,
      workerId,
      config.evaluatorResultFile,
      config.plannerResultFile,
      resultFile,
      doneFile,
    ), "utf-8");

    const dispatch = await dispatchCreateOnly({
      workflowId: config.workflowId,
      handoffId: workerId,
      repoPath: config.repoPath,
      worktreePath: config.worktreePath,
      agentType: config.agentType,
      taskFile,
      doneFile,
      resultFile,
      autoApprove: config.autoApprove,
      parentTerminalId: config.parentTerminalId,
    });

    workers.push({
      id: workerId,
      methodology: methodology.id,
      terminal_id: dispatch.terminalId,
      dir: workerDir,
      task_file: taskFile,
      result_file: resultFile,
      done_file: doneFile,
    });
  }

  return {
    workers,
    started_at: new Date().toISOString(),
    evaluator_handoff_id: config.evaluatorHandoffId,
  };
}

function parseFindings(raw: unknown): ChallengeFinding[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).findings)) {
    return [];
  }
  return (raw as any).findings.filter(
    (f: any) =>
      typeof f?.point === "string" &&
      typeof f?.severity === "string" &&
      typeof f?.reasoning === "string" &&
      ["critical", "significant", "minor"].includes(f.severity),
  );
}

export function collectChallengeResults(state: ChallengeState): ChallengeDecision | null {
  for (const worker of state.workers) {
    if (!fs.existsSync(worker.done_file)) {
      return null;
    }
  }

  const allFindings: ChallengeFinding[] = [];
  for (const worker of state.workers) {
    try {
      const raw = JSON.parse(fs.readFileSync(worker.result_file, "utf-8"));
      allFindings.push(...parseFindings(raw));
    } catch {
      // Worker wrote invalid result — skip silently
    }
  }

  const critical = allFindings.filter((f) => f.severity === "critical");
  const significant = allFindings.filter((f) => f.severity === "significant");
  const minor = allFindings.filter((f) => f.severity === "minor");
  const override = critical.length > 0 || significant.length >= 2;

  const counts: string[] = [];
  if (critical.length > 0) counts.push(`${critical.length} critical`);
  if (significant.length > 0) counts.push(`${significant.length} significant`);
  if (minor.length > 0) counts.push(`${minor.length} minor`);
  const countsStr = counts.length > 0 ? counts.join(", ") : "no issues found";

  return {
    override,
    findings: [...critical, ...significant],
    summary: override
      ? `Challenge gate OVERRIDE (${countsStr}). Issues the evaluator missed:\n\n${[...critical, ...significant].map((f) => `- [${f.severity}] ${f.point}: ${f.reasoning}`).join("\n")}`
      : `Challenge gate CONFIRMED (${countsStr}).`,
  };
}

export function destroyChallengeTerminals(
  state: ChallengeState,
  destroyTerminal: (id: string) => void,
): void {
  for (const worker of state.workers) {
    try {
      destroyTerminal(worker.terminal_id);
    } catch {
    }
  }
}
