import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./assignment/types.ts";
import {
  dispatchCreateOnly as defaultDispatchCreateOnly,
  type DispatchCreateOnlyRequest,
  type DispatchCreateOnlyResult,
} from "./dispatcher.ts";

// ── Types ──

export interface ChallengeWorker {
  id: string;
  methodology: string;
  terminal_id: string;
  dir: string;
  task_file: string;
  result_file: string;
}

export type ChallengeStage =
  | "researcher"
  | "implementer"
  | "tester"
  | "intent_confirmation";

export interface ChallengeContextFile {
  label: string;
  path: string;
}

export interface ChallengeContinueTarget {
  outcome: "await_approval" | "advance" | "loop" | "intent_confirmation" | "complete";
  next_assignment_id?: string;
  requeue_assignment_ids?: string[];
}

export interface ChallengeReturnTarget {
  role: "researcher" | "implementer" | "tester";
  assignment_id: string;
  requeue_assignment_ids: string[];
  mode: "reuse" | "replan";
  description: string;
}

export interface ChallengeState {
  workers: ChallengeWorker[];
  started_at: string;
  source_assignment_id: string;
  source_stage: ChallengeStage;
  continue_target: ChallengeContinueTarget;
  return_targets: ChallengeReturnTarget[];
  context_files: ChallengeContextFile[];
  decision?: ChallengeDecision;
  report_file?: string;
  completed_at?: string;
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

export type ChallengeCollectionResult =
  | { status: "pending" }
  | {
      status: "invalid";
      failure: {
        code: string;
        message: string;
        stage: string;
      };
    }
  | { status: "completed"; decision: ChallengeDecision };

// ── Methodologies ──

interface ChallengeMethodology {
  id: string;
  name: string;
  prompt: string;
}

function buildMethodologies(stage: ChallengeStage): ChallengeMethodology[] {
  if (stage === "researcher") {
    return [
      {
        id: "scope-blindspots",
        name: "Scope Blindspots",
        prompt: [
          "You are an adversarial reviewer of the current research conclusion.",
          "Find scope, requirement, or impact gaps that could make the proposed transition unsafe.",
          "",
          "For each finding:",
          "1. State the exact assumption or omission",
          "2. Explain what downstream work would break because of it",
          "3. Cite the relevant code, spec, or brief evidence",
        ].join("\n"),
      },
      {
        id: "assumption-audit",
        name: "Assumption Audit",
        prompt: [
          "Identify the assumptions behind the current research conclusion and rank the ones that are least supported.",
          "Focus on architecture support, technical-debt blockers, compatibility assumptions, and non-goals that may actually be required.",
        ].join("\n"),
      },
      {
        id: "architecture-stress",
        name: "Architecture Stress",
        prompt: [
          "Stress-test the claimed architecture/component impact.",
          "Find subsystems, ownership boundaries, migrations, or shared abstractions that the current research underestimates.",
        ].join("\n"),
      },
      {
        id: "downstream-risk",
        name: "Downstream Risk",
        prompt: [
          "Look one step ahead.",
          "Ask what is most likely to surprise the next role if the workflow continues on the proposed path.",
          "Surface hidden blockers, missing verification focus, and places where implementation would likely force a replan.",
        ].join("\n"),
      },
    ];
  }

  if (stage === "implementer") {
    return [
      {
        id: "implementation-failures",
        name: "Implementation Failures",
        prompt: [
          "Find concrete scenarios where the implementation path or changed code is likely to fail before verification should begin.",
          "Verify with code paths, tests, or runtime evidence whenever possible.",
        ].join("\n"),
      },
      {
        id: "assumption-audit",
        name: "Assumption Audit",
        prompt: [
          "Identify assumptions in the implementation approach that may not hold in the real codebase.",
          "Focus on coupling, ownership, data flow, and hidden prerequisites.",
        ].join("\n"),
      },
      {
        id: "edge-pressure",
        name: "Edge Pressure",
        prompt: [
          "Push the changed paths toward boundary conditions and find what the implementer may have missed.",
          "Check empty states, large inputs, concurrency, latency, and failure paths.",
        ].join("\n"),
      },
      {
        id: "regression-hunter",
        name: "Regression Hunter",
        prompt: [
          "Find unchanged behaviors most likely to regress because of the implementation changes.",
          "Prioritize shared code, reused abstractions, and side effects outside the feature path.",
        ].join("\n"),
      },
    ];
  }

  if (stage === "tester") {
    return [
      {
        id: "missed-failures",
        name: "Missed Failures",
        prompt: [
          "Find specific, concrete scenarios where the implementation fails that the current verification conclusion may have missed.",
          "Do not speculate without evidence.",
        ].join("\n"),
      },
      {
        id: "assumption-audit",
        name: "Assumption Audit",
        prompt: [
          "Identify assumptions behind the current verification conclusion and assess which are unjustified.",
          "Distinguish tested evidence from inferred confidence.",
        ].join("\n"),
      },
      {
        id: "edge-cases",
        name: "Edge Cases",
        prompt: [
          "Push the changed paths to their boundary conditions and look for failures or missing checks.",
          "Use browse or tests when they are available.",
        ].join("\n"),
      },
      {
        id: "regression-hunter",
        name: "Regression Hunter",
        prompt: [
          "Find regressions in existing behavior that the workflow should know about before moving on.",
          "Shared utilities, styling, APIs, and state changes are high-value targets.",
        ].join("\n"),
      },
    ];
  }

  return [
    {
      id: "intent-gaps",
      name: "Intent Gaps",
      prompt: [
        "Challenge whether the current final conclusion is truly ready to stand.",
        "Find places where the approved intent, implementation evidence, and verification evidence still do not line up.",
      ].join("\n"),
    },
    {
      id: "assumption-audit",
      name: "Assumption Audit",
      prompt: [
        "Identify assumptions in the current completion judgment and rank the least supported ones.",
        "Focus on sign-off confidence, not style.",
      ].join("\n"),
    },
    {
      id: "edge-pressure",
      name: "Edge Pressure",
      prompt: [
        "Look for high-risk boundary cases that could still invalidate the current completion judgment.",
      ].join("\n"),
    },
    {
      id: "regression-hunter",
      name: "Regression Hunter",
      prompt: [
        "Search for regressions or second-order effects that would make the current workflow conclusion premature.",
      ].join("\n"),
    },
  ];
}

// ── Helpers ──

function generateWorkerId(): string {
  return `challenge-${crypto.randomBytes(4).toString("hex")}`;
}

function renderChallengeTask(
  methodology: ChallengeMethodology,
  workflowId: string,
  workerId: string,
  stage: ChallengeStage,
  contextFiles: ChallengeContextFile[],
  resultFile: string,
): string {
  const stageLabel =
    stage === "intent_confirmation"
      ? "intent confirmation"
      : stage;

  return [
    "# Challenge Review Task",
    "",
    `Workflow: ${workflowId}`,
    `Worker: ${workerId} (${methodology.name})`,
    `Stage Boundary: ${stageLabel}`,
    "",
    "## Your Role",
    "",
    methodology.prompt,
    "",
    "## Context Files",
    "",
    ...contextFiles.map((file) => `- ${file.label}: ${file.path}`),
    "- Read the relevant briefs/results before making claims",
    "",
    "## Rules",
    "",
    "- You are READ-ONLY. Do NOT modify any source code.",
    "- You MAY run tests, use `browse`, and read any file.",
    "- Focus on REAL risks in the current proposed transition, not style or hypotheticals.",
    "- Each finding must include concrete evidence (file:line, test output, screenshot).",
    "",
    "## Output Contract",
    "",
    `Write your result to: ${resultFile}`,
    `Write to ${resultFile}.tmp first, then atomically rename it to ${resultFile} once the JSON is complete.`,
    "",
    "```json",
    "{",
    `  "schema_version": "hydra/result/v1",`,
    `  "workflow_id": "${workflowId}",`,
    `  "assignment_id": "${workerId}",`,
    `  "run_id": "${workerId}",`,
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
  ].join("\n");
}

// ── Spawn ──

export async function spawnChallengeWorkers(
  config: {
    workflowId: string;
    repoPath: string;
    worktreePath: string;
    stage: ChallengeStage;
    contextFiles: ChallengeContextFile[];
    autoApprove: boolean;
    agentType: AgentType;
    parentTerminalId?: string;
  },
  dispatchCreateOnly: (req: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult> = defaultDispatchCreateOnly,
): Promise<ChallengeWorker[]> {
  const challengeDir = path.join(
    path.resolve(config.repoPath),
    ".hydra", "workflows", config.workflowId, "challenge",
  );
  const workers: ChallengeWorker[] = [];
  const methodologies = buildMethodologies(config.stage);

  for (const methodology of methodologies) {
    const workerId = generateWorkerId();
    const workerDir = path.join(challengeDir, workerId);
    fs.mkdirSync(workerDir, { recursive: true });

    const taskFile = path.join(workerDir, "task.md");
    const resultFile = path.join(workerDir, "result.json");

    fs.writeFileSync(taskFile, renderChallengeTask(
      methodology,
      config.workflowId,
      workerId,
      config.stage,
      config.contextFiles,
      resultFile,
    ), "utf-8");

    const dispatch = await dispatchCreateOnly({
      workflowId: config.workflowId,
      assignmentId: workerId,
      runId: workerId,
      repoPath: config.repoPath,
      worktreePath: config.worktreePath,
      agentType: config.agentType,
      taskFile,
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
    });
  }

  return workers;
}

// ── Collect ──

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

export function collectChallengeResults(state: ChallengeState): ChallengeCollectionResult {
  for (const worker of state.workers) {
    if (!fs.existsSync(worker.result_file)) {
      return { status: "pending" };
    }
  }

  const allFindings: ChallengeFinding[] = [];
  const invalidWorkers: string[] = [];
  for (const worker of state.workers) {
    try {
      const raw = JSON.parse(fs.readFileSync(worker.result_file, "utf-8"));
      allFindings.push(...parseFindings(raw));
    } catch {
      invalidWorkers.push(worker.id);
    }
  }

  if (invalidWorkers.length > 0) {
    return {
      status: "invalid",
      failure: {
        code: "WORKFLOW_CHALLENGE_RESULT_INVALID",
        message: `Challenge worker results were invalid for ${invalidWorkers.join(", ")}`,
        stage: "challenge.collect",
      },
    };
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
    status: "completed",
    decision: {
      override,
      findings: [...critical, ...significant],
      summary: override
        ? `Challenge review recommends SEND BACK (${countsStr}). Independent findings:\n\n${[...critical, ...significant].map((f) => `- [${f.severity}] ${f.point}: ${f.reasoning}`).join("\n")}`
        : `Challenge review found no send-back reason (${countsStr}).`,
    },
  };
}

// ── Cleanup ──

export function destroyChallengeTerminals(
  state: ChallengeState,
  destroyTerminal: (id: string) => void,
): void {
  for (const worker of state.workers) {
    try {
      destroyTerminal(worker.terminal_id);
    } catch {
      // Terminal may already be dead
    }
  }
}
