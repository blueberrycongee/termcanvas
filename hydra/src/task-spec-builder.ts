import fs from "node:fs";
import path from "node:path";
import { AssignmentManager } from "./assignment/manager.ts";
import type { AssignmentRecord } from "./assignment/types.ts";
import {
  getRunReportFile,
  getRunResultFile,
  getWorkflowIntentFile,
} from "./layout.ts";
import { RESULT_SCHEMA_VERSION } from "./protocol.ts";
import { loadRole } from "./roles/loader.ts";
import type { RunTaskSpec, TaskFileRef, TaskWriteTarget } from "./run-task.ts";
import type { WorkflowRecord, WorkflowNode } from "./workflow-store.ts";

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
    "- workflow_id, assignment_id, run_id (from the Run Context section above)",
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
  workflow: WorkflowRecord;
  node: WorkflowNode;
  assignment: AssignmentRecord;
  runId: string;
}

export function buildTaskSpecFromIntent(input: BuildTaskSpecInput): RunTaskSpec {
  const { workflow, node, assignment, runId } = input;
  const repoPath = workflow.repo_path;

  // Resolve role from registry. agent_type is locked by the role file —
  // dispatchers must not override it. fail-fast on missing/malformed role.
  const role = loadRole(node.role, repoPath);

  // --- Objective: read intent file content ---
  const intentText = readFileOrEmpty(resolvePath(repoPath, node.intent_file));
  const objectiveLines: string[] = [
    intentText.trim() || `(intent_file is empty: ${node.intent_file})`,
  ];

  // --- Read files ---
  const readFiles: TaskFileRef[] = [
    { label: "Workflow intent", path: getWorkflowIntentFile(repoPath, workflow.id) },
  ];

  // Auto-inject outputs from depends_on nodes (their report.md + result.json).
  // We also collect a parallel list of "upstream summaries" — (role, nodeId,
  // report path, session_id) tuples — that get rendered as an Upstream Nodes
  // section below. Reviewer in particular needs a structured pointer to
  // "here is what dev produced and how to follow up with it", not just a
  // readFiles bag.
  const manager = new AssignmentManager(repoPath, workflow.id);
  interface UpstreamSummary {
    nodeId: string;
    role: string;
    reportPath: string | null;
    resultPath: string | null;
    sessionId: string | null;
    sessionProvider: string | null;
  }
  const upstreamSummaries: UpstreamSummary[] = [];
  for (const depId of node.depends_on) {
    const depNode = workflow.nodes[depId];
    if (!depNode?.assignment_id) continue;
    const depAssignment = manager.load(depNode.assignment_id);
    if (!depAssignment) continue;
    const depRun = depAssignment.active_run_id
      ? depAssignment.runs.find((r) => r.id === depAssignment.active_run_id)
      : depAssignment.runs[depAssignment.runs.length - 1];
    if (!depRun) continue;
    const reportPath = getRunReportFile(repoPath, workflow.id, depAssignment.id, depRun.id);
    const reportExists = fs.existsSync(reportPath);
    if (reportExists) {
      readFiles.push({ label: `${depNode.role} report (${depId})`, path: reportPath });
    }
    const resultExists = fs.existsSync(depRun.result_file);
    if (resultExists) {
      readFiles.push({ label: `${depNode.role} result (${depId})`, path: depRun.result_file });
    }
    upstreamSummaries.push({
      nodeId: depId,
      role: depNode.role,
      reportPath: reportExists ? reportPath : null,
      resultPath: resultExists ? depRun.result_file : null,
      sessionId: depRun.session_id ?? null,
      sessionProvider: depRun.session_provider ?? null,
    });
  }

  // Auto-inject approved refs
  if (workflow.approved_refs) {
    for (const [refNodeId, ref] of Object.entries(workflow.approved_refs)) {
      if (fs.existsSync(ref.brief_file)) {
        readFiles.push({ label: `Approved report (${refNodeId})`, path: ref.brief_file });
      }
      if (fs.existsSync(ref.result_file)) {
        readFiles.push({ label: `Approved result (${refNodeId})`, path: ref.result_file });
      }
    }
  }

  // Add extra context refs provided by Lead (supplements)
  if (node.context_refs) {
    for (const ref of node.context_refs) {
      if (fs.existsSync(ref.path)) {
        readFiles.push({ label: ref.label, path: ref.path });
      }
    }
  }

  // Add feedback file if present (from reset)
  if (node.feedback_file) {
    const feedbackAbs = resolvePath(repoPath, node.feedback_file);
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
  const reportFile = getRunReportFile(repoPath, workflow.id, assignment.id, runId);
  const resultFile = getRunResultFile(repoPath, workflow.id, assignment.id, runId);

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

  // --- Decision rules ---
  const decisionRules = [
    ...role.decision_rules,
    "Use outcome=completed when your work is done (regardless of findings).",
    "Use outcome=stuck when you cannot proceed without external help.",
    "Use outcome=error only for technical failures (Hydra may retry you).",
  ];

  // --- Acceptance criteria ---
  const commonCompletion = [
    `Write ${path.basename(reportFile)} before publishing the result.`,
    `Write ${path.basename(resultFile)} last, atomically, with schema_version=${RESULT_SCHEMA_VERSION}.`,
  ];
  const acceptanceCriteria = [
    ...role.acceptance_criteria,
    ...commonCompletion,
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
  if (workflow.human_request && workflow.human_request.trim()) {
    workflowContextLines.push("**Original human request:**");
    workflowContextLines.push(workflow.human_request.trim());
    workflowContextLines.push("");
  }
  if (workflow.overall_plan && workflow.overall_plan.trim()) {
    workflowContextLines.push("**Lead's overall plan:**");
    workflowContextLines.push(workflow.overall_plan.trim());
    workflowContextLines.push("");
  }
  if (workflow.shared_constraints && workflow.shared_constraints.length > 0) {
    workflowContextLines.push("**Workflow-wide constraints (apply to every node):**");
    for (const c of workflow.shared_constraints) {
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

  if (upstreamSummaries.length > 0) {
    const lines: string[] = [
      "These upstream nodes already ran and their outputs are in your Read First list.",
      "Read their report.md before forming conclusions — they contain self-assessment,",
      "risks, and guidance written by the upstream worker itself.",
      "",
    ];
    for (const s of upstreamSummaries) {
      lines.push(`### ${s.role} (node: ${s.nodeId})`);
      if (s.reportPath) lines.push(`- Report: ${s.reportPath}`);
      if (s.resultPath) lines.push(`- Result: ${s.resultPath}`);
      if (s.sessionId) {
        // The session id is what `hydra ask` uses to spin up a one-shot
        // follow-up subprocess via `claude --resume` / `codex exec resume`.
        lines.push(
          `- Session id: \`${s.sessionId}\` (${s.sessionProvider ?? "unknown"}) — Lead can ask follow-up questions via \`hydra ask --workflow <id> --node ${s.nodeId} --message "..."\``,
        );
      }
      lines.push("");
    }
    // Trim trailing blank line.
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    extraSections.push({
      title: "Upstream Nodes",
      lines,
    });
  }

  extraSections.push(RESULT_CONTRACT_SECTION);

  return {
    repoPath: workflow.repo_path,
    workflowId: workflow.id,
    assignmentId: assignment.id,
    runId,
    role: node.role,
    // Cached on the node at dispatch time from the chosen role terminal.
    // task-spec-builder reads from the node, not the role, because the
    // node carries the locked-in choice; the role file's terminals[]
    // could in principle change between dispatches.
    agentType: node.agent_type,
    model: node.model,
    reasoningEffort: node.reasoning_effort,
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
