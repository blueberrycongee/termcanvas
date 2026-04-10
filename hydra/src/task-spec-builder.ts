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
import type { RunTaskSpec, TaskFileRef, TaskWriteTarget } from "./run-task.ts";
import type { WorkflowRecord, WorkflowNode } from "./workflow-store.ts";

function readFileOrEmpty(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf-8"); } catch { return ""; }
}

function resolvePath(repoPath: string, relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(repoPath, relativeOrAbsolute);
}

// --- Role defaults ---

const BRIEF_ROLES = new Set(["researcher", "implementer", "tester", "reviewer"]);

interface RoleDefaults {
  objectivePrefix: string;
  decisionRules: string[];
  acceptanceCriteria: string[];
  skills: string[];
  extraSections: Array<{ title: string; lines: string[] }>;
}

function getRoleDefaults(role: string): RoleDefaults {
  switch (role) {
    case "researcher":
      return {
        objectivePrefix: "Turn the following intent into an actionable research brief.",
        decisionRules: [
          "- Read the user request before forming any architecture conclusion.",
          "- Investigate the current codebase instead of restating the task.",
          "- If the strategy changes user-approved scope or prerequisites, also write approval-request.md.",
        ],
        acceptanceCriteria: [
          "Produce a research brief grounded in the current codebase",
          "Call out structural blockers, unknowns, and verification focus",
        ],
        skills: [],
        extraSections: [
          {
            title: "Research Strategy",
            lines: [
              "- Start from user-request.md, then confirm how the codebase changes the real problem.",
              "- Produce a brief that downstream agents can execute without re-reading the whole repo history.",
              "- Make constraints, risks, and validation focus explicit.",
            ],
          },
        ],
      };

    case "implementer":
      return {
        objectivePrefix: "Implement the following change in the current worktree.",
        decisionRules: [
          "- Solve the real implementation problem before changing tests or fixtures.",
          "- Do not fake success with silent fallbacks or placeholder outputs.",
          "- If the approved assumptions fail in the real codebase, report via intent.type=replan instead of forcing a brittle implementation.",
        ],
        acceptanceCriteria: [
          "Implement the requested change without test hacking",
          "Keep the brief focused on what changed, what remains risky, and what a tester should inspect next",
        ],
        skills: [],
        extraSections: [
          {
            title: "Implementation Strategy",
            lines: [
              "- Use upstream briefs and approved research as the contract for what to build.",
              "- Update code and tests honestly; do not fake success by weakening checks.",
              "- Use the brief to explain concrete code changes and open risks.",
            ],
          },
        ],
      };

    case "tester":
      return {
        objectivePrefix: "Independently validate the implementation against code reality and runtime evidence.",
        decisionRules: [
          "- Form an independent judgment from code and runtime behavior before trusting the implementer's summary.",
          "- Report issues via intent.type=needs_rework with a clear reason.",
        ],
        acceptanceCriteria: [
          "Run baseline verification before declaring success",
          "Compare implementer claims with code/runtime reality",
          "Include a verification object in result.json",
        ],
        skills: ["qa", "code-review"],
        extraSections: [
          {
            title: "Verification Strategy",
            lines: [
              "- Start with baseline checks first and stop early if they fail.",
              "- Verify the approved constraints, regression risks, and implementer claims with concrete evidence.",
              "- Treat discrepancies between code reality and the implementation brief as high-priority findings.",
            ],
          },
        ],
      };

    case "reviewer":
      return {
        objectivePrefix: "Review the work produced by other agents and provide an independent assessment.",
        decisionRules: [
          "- Form an independent judgment; do not parrot other agents' conclusions.",
          "- Focus on correctness, completeness, and adherence to the original intent.",
        ],
        acceptanceCriteria: [
          "Provide an evidence-based assessment",
          "Identify concrete issues or confirm correctness with reasoning",
        ],
        skills: ["code-review"],
        extraSections: [],
      };

    default:
      return {
        objectivePrefix: "",
        decisionRules: [],
        acceptanceCriteria: [],
        skills: [],
        extraSections: [],
      };
  }
}

// --- Result contract section ---

const RESULT_CONTRACT_SECTION = {
  title: "Result Contract",
  lines: [
    `result.json must contain ONLY these fields:`,
    `- schema_version: "${RESULT_SCHEMA_VERSION}"`,
    "- workflow_id, assignment_id, run_id (from the Role section above)",
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
  const roleDefaults = getRoleDefaults(node.role);
  const repoPath = workflow.repo_path;

  // --- Objective: read intent file content ---
  const intentText = readFileOrEmpty(resolvePath(repoPath, node.intent_file));
  const objectiveLines: string[] = [];
  if (roleDefaults.objectivePrefix) {
    objectiveLines.push(roleDefaults.objectivePrefix);
    objectiveLines.push("");
  }
  objectiveLines.push(intentText.trim() || `(intent_file is empty: ${node.intent_file})`);

  // --- Read files ---
  const readFiles: TaskFileRef[] = [
    { label: "Workflow intent", path: getWorkflowIntentFile(repoPath, workflow.id) },
  ];

  // Auto-inject outputs from depends_on nodes (their report.md + result.json)
  const manager = new AssignmentManager(repoPath, workflow.id);
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
    if (fs.existsSync(reportPath)) {
      readFiles.push({ label: `${depNode.role} report (${depId})`, path: reportPath });
    }
    if (fs.existsSync(depRun.result_file)) {
      readFiles.push({ label: `${depNode.role} result (${depId})`, path: depRun.result_file });
    }
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
    ...roleDefaults.decisionRules,
    "- Use outcome=completed when your work is done (regardless of findings).",
    "- Use outcome=stuck when you cannot proceed without external help.",
    "- Use outcome=error only for technical failures (Hydra may retry you).",
  ];

  // --- Acceptance criteria ---
  const commonCompletion = [
    `Write ${path.basename(reportFile)} before publishing the result.`,
    `Write ${path.basename(resultFile)} last, atomically, with schema_version=${RESULT_SCHEMA_VERSION}.`,
  ];
  const acceptanceCriteria = [
    ...roleDefaults.acceptanceCriteria,
    ...commonCompletion,
  ];

  // --- Extra sections ---
  const extraSections = [
    ...roleDefaults.extraSections,
    RESULT_CONTRACT_SECTION,
  ];

  return {
    repoPath: workflow.repo_path,
    workflowId: workflow.id,
    assignmentId: assignment.id,
    runId,
    role: node.role,
    agentType: assignment.requested_agent_type,
    sourceRole: null,
    objective: objectiveLines,
    readFiles,
    writeTargets,
    decisionRules,
    acceptanceCriteria,
    skills: roleDefaults.skills,
    extraSections,
  };
}
