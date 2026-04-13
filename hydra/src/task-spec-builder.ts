import fs from "node:fs";
import path from "node:path";
import {
  getRunReportFile,
  getRunResultFile,
  getWorkbenchIntentFile,
} from "./layout.ts";
import { RESULT_SCHEMA_VERSION } from "./protocol.ts";
import { loadRole } from "./roles/loader.ts";
import type { RunTaskSpec, TaskFileRef, TaskWriteTarget } from "./run-task.ts";
import type { AssignmentRecord } from "./assignment/types.ts";
import type { WorkbenchRecord, Dispatch } from "./workflow-store.ts";

function readFileOrEmpty(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf-8"); } catch { return ""; }
}

function resolvePath(repoPath: string, relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(repoPath, relativeOrAbsolute);
}

// --- Result contract section ---

const RESULT_CONTRACT_SECTION = {
  title: "Result Contract",
  lines: [
    `result.json must contain ONLY these fields:`,
    `- schema_version: "${RESULT_SCHEMA_VERSION}"`,
    "- workbench_id, assignment_id, run_id (from the Run Context section above)",
    "- outcome: \"completed\" | \"stuck\" | \"error\"",
    "- report_file: relative path to your report.md (typically just \"report.md\")",
    "",
    "The `outcome` field tells the orchestrator what happened:",
    '- `"completed"` — you finished your work (regardless of what you found).',
    '- `"stuck"` — you cannot proceed and need external help.',
    '- `"error"` — you hit a technical error (the orchestrator may retry you).',
    "",
    "All human-readable content goes in report.md, NOT in result.json:",
    "- Summary of what you did and found",
    "- Output file references with descriptions",
    "- Evidence (test runs, file inspections, etc.)",
    "- Optional reflection on approach, blockers, confidence",
    "",
    "The Lead agent reads report.md to decide the next step.",
    "Be specific and actionable in the report.",
  ],
};

// --- Builder ---

export interface BuildTaskSpecInput {
  workbench: WorkbenchRecord;
  dispatch: Dispatch;
  assignment: AssignmentRecord;
  runId: string;
}

export function buildTaskSpecFromIntent(input: BuildTaskSpecInput): RunTaskSpec {
  const { workbench, dispatch: disp, assignment, runId } = input;
  const repoPath = workbench.repo_path;

  // Resolve role from registry. agent_type is locked by the role file —
  // dispatchers must not override it. fail-fast on missing/malformed role.
  const role = loadRole(disp.role, repoPath);

  // --- Objective: read intent file content ---
  const intentText = readFileOrEmpty(resolvePath(repoPath, disp.intent_file));
  const objectiveLines: string[] = [
    intentText.trim() || `(intent_file is empty: ${disp.intent_file})`,
  ];

  // --- Read files ---
  const readFiles: TaskFileRef[] = [
    { label: "Workflow intent", path: getWorkbenchIntentFile(repoPath, workbench.id) },
  ];

  // Auto-inject approved refs
  if (workbench.approved_refs) {
    for (const [refNodeId, ref] of Object.entries(workbench.approved_refs)) {
      if (fs.existsSync(ref.brief_file)) {
        readFiles.push({ label: `Approved report (${refNodeId})`, path: ref.brief_file });
      }
      if (fs.existsSync(ref.result_file)) {
        readFiles.push({ label: `Approved result (${refNodeId})`, path: ref.result_file });
      }
    }
  }

  // Add extra context refs provided by Lead (supplements)
  if (disp.context_refs) {
    for (const ref of disp.context_refs) {
      if (fs.existsSync(ref.path)) {
        readFiles.push({ label: ref.label, path: ref.path });
      }
    }
  }

  // Add feedback file if present (from reset)
  if (disp.feedback_file) {
    const feedbackAbs = resolvePath(repoPath, disp.feedback_file);
    if (fs.existsSync(feedbackAbs)) {
      readFiles.push({ label: "Feedback from Lead", path: feedbackAbs });
    }
  }

  // Deduplicate readFiles by path
  const seenPaths = new Set<string>();
  const dedupedReadFiles: TaskFileRef[] = [];
  for (const ref of readFiles) {
    if (!seenPaths.has(ref.path)) {
      seenPaths.add(ref.path);
      dedupedReadFiles.push(ref);
    }
  }
  readFiles.length = 0;
  readFiles.push(...dedupedReadFiles);

  // --- Write targets ---
  const reportFile = getRunReportFile(repoPath, workbench.id, assignment.id, runId);
  const resultFile = getRunResultFile(repoPath, workbench.id, assignment.id, runId);

  const writeTargets: TaskWriteTarget[] = [
    {
      label: "Report",
      path: reportFile,
      note: "Human-readable report. Include your summary, evidence, output descriptions, and reflection here.",
    },
    {
      label: "Result JSON",
      path: resultFile,
      note: "Slim machine record. Hydra advances only from this file. Reference the report file by path.",
    },
  ];

  // --- Decision rules (Hydra operational only; role-specific rules live in the role body) ---
  const decisionRules = [
    "Use outcome=completed when your work is done (regardless of findings).",
    "Use outcome=stuck when you cannot proceed without external help.",
    "Use outcome=error only for technical failures (Hydra may retry you).",
  ];

  // --- Acceptance criteria (Hydra operational only) ---
  const acceptanceCriteria = [
    `Write ${path.basename(reportFile)} before publishing the result.`,
    `Write ${path.basename(resultFile)} last, atomically, with schema_version=${RESULT_SCHEMA_VERSION}.`,
  ];

  // --- Extra sections ---
  // Role-specific strategy content lives in the role body (rendered as the
  // ## Role section by run-task.ts). Two static sections are appended here:
  //   1. Workflow Context — broadcast of human_request / overall_plan /
  //      shared_constraints from the workflow record. Every dispatched
  //      worker sees the wider picture instead of only its local intent.
  //   2. Result Contract — the slim result.json shape.
  const extraSections: { title: string; lines: string[] }[] = [];

  const workflowContextLines: string[] = [];
  if (workbench.human_request && workbench.human_request.trim()) {
    workflowContextLines.push("**Original human request:**");
    workflowContextLines.push(workbench.human_request.trim());
    workflowContextLines.push("");
  }
  if (workbench.overall_plan && workbench.overall_plan.trim()) {
    workflowContextLines.push("**Lead's overall plan:**");
    workflowContextLines.push(workbench.overall_plan.trim());
    workflowContextLines.push("");
  }
  if (workbench.shared_constraints && workbench.shared_constraints.length > 0) {
    workflowContextLines.push("**Workflow-wide constraints (apply to every node):**");
    for (const c of workbench.shared_constraints) {
      workflowContextLines.push(`- ${c}`);
    }
    workflowContextLines.push("");
  }
  if (workflowContextLines.length > 0) {
    // Trailing blank line is noise; trim it before emitting.
    while (workflowContextLines.length > 0 && workflowContextLines[workflowContextLines.length - 1] === "") {
      workflowContextLines.pop();
    }
    extraSections.push({
      title: "Workflow Context",
      lines: workflowContextLines,
    });
  }

  extraSections.push(RESULT_CONTRACT_SECTION);

  return {
    repoPath: workbench.repo_path,
    workbenchId: workbench.id,
    assignmentId: assignment.id,
    runId,
    role: disp.role,
    // Cached on the dispatch at dispatch time from the chosen role terminal.
    // task-spec-builder reads from the dispatch, not the role, because the
    // dispatch carries the locked-in choice; the role file's terminals[]
    // could in principle change between dispatches.
    agentType: disp.agent_type,
    model: disp.model,
    reasoningEffort: disp.reasoning_effort,
    sourceRole: null,
    roleBody: role.body,
    objective: objectiveLines,
    readFiles,
    writeTargets,
    decisionRules,
    acceptanceCriteria,
    skills: [],
    extraSections,
  };
}
