import fs from "node:fs";
import path from "node:path";
import type { AssignmentRecord } from "./assignment/types.ts";
import {
  getRunBriefFile,
  getRunResultFile,
  getWorkflowUserRequestPath,
} from "./layout.ts";
import { RESULT_SCHEMA_VERSION } from "./protocol.ts";
import type { RunTaskSpec, TaskFileRef, TaskWriteTarget } from "./run-task.ts";
import type { WorkflowRecord, WorkflowNode } from "./workflow-store.ts";

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
    `Write result.json with schema_version="${RESULT_SCHEMA_VERSION}".`,
    "",
    "Your result.json must include an `intent` field expressing your semantic outcome:",
    '- `{ "type": "done", "confidence": "high"|"medium"|"low" }` — work is complete.',
    '- `{ "type": "needs_rework", "reason": "...", "scope": "minor"|"major" }` — something upstream or in the current work needs fixing.',
    '- `{ "type": "blocked", "reason": "...", "needs": "..." }` — cannot proceed without something.',
    '- `{ "type": "replan", "reason": "..." }` — the approach itself is wrong and needs rethinking.',
    "",
    "Do NOT include assignment IDs or routing information. The orchestrator handles routing.",
    "",
    "Optionally include a `reflection` object with:",
    "- `approach`: what strategy you chose",
    "- `blockers_encountered`: what got in the way",
    "- `confidence_factors`: what gives you confidence (or not)",
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

  // --- Objective ---
  const objectiveLines: string[] = [];
  if (roleDefaults.objectivePrefix) {
    objectiveLines.push(roleDefaults.objectivePrefix);
    objectiveLines.push("");
  }
  objectiveLines.push(node.intent);

  // --- Read files ---
  const readFiles: TaskFileRef[] = [
    { label: "User request", path: getWorkflowUserRequestPath(workflow.repo_path, workflow.id) },
  ];

  // Add context refs provided by Lead
  if (node.context_refs) {
    for (const ref of node.context_refs) {
      if (fs.existsSync(ref.path)) {
        readFiles.push({ label: ref.label, path: ref.path });
      }
    }
  }

  // Add feedback file if present (from reset)
  if (node.feedback) {
    const feedbackPath = path.join(
      path.resolve(workflow.repo_path), ".hydra", "workflows", workflow.id,
      "feedback", `${node.id}.md`,
    );
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true });
    fs.writeFileSync(feedbackPath, [
      "# Feedback",
      "",
      "This task was sent back with the following feedback. Address it directly.",
      "",
      node.feedback,
      "",
    ].join("\n"), "utf-8");
    readFiles.push({ label: "Feedback from Lead", path: feedbackPath });
  }

  // --- Write targets ---
  const briefFile = getRunBriefFile(workflow.repo_path, workflow.id, assignment.id, runId);
  const resultFile = getRunResultFile(workflow.repo_path, workflow.id, assignment.id, runId);

  const writeTargets: TaskWriteTarget[] = [];
  if (BRIEF_ROLES.has(node.role)) {
    writeTargets.push({
      label: "Brief",
      path: briefFile,
      note: "Human-readable brief summarizing your work and findings.",
    });
  }
  writeTargets.push({
    label: "Result JSON",
    path: resultFile,
    note: "Write this atomically after every required artifact is complete. Hydra advances only from this file.",
  });

  // --- Decision rules ---
  const decisionRules = [
    ...roleDefaults.decisionRules,
    "- Use intent.type to express your semantic outcome. Do not include routing information.",
  ];

  // --- Acceptance criteria ---
  const commonCompletion = [
    BRIEF_ROLES.has(node.role)
      ? `Write ${path.basename(briefFile)} before publishing the result.`
      : "Publish the machine result only after you have finished the requested work.",
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
