import fs from "node:fs";
import path from "node:path";
import {
  getRunArtifactsDir,
  getRunResultFile,
  getRunTaskFile,
} from "./layout.ts";

export interface TaskFileRef {
  label: string;
  path: string;
}

export interface TaskWriteTarget {
  label: string;
  path: string;
  note?: string;
}

export interface TaskExtraSection {
  title: string;
  lines: string[];
}

export interface RunTaskSpec {
  repoPath: string;
  workflowId: string;
  assignmentId: string;
  runId: string;
  role: string;
  agentType: string;
  /** Model pin from the chosen role terminal, if set. */
  model?: string;
  /** Reasoning effort level from the chosen role terminal, if set. */
  reasoningEffort?: string;
  sourceRole?: string | null;
  /**
   * Markdown body from the role registry file. Rendered as the ## Role
   * section at the top of task.md. Should be additive briefing
   * ("For this task, you are additionally playing X"), not a replacement
   * persona — the underlying CLI already has its own system prompt.
   */
  roleBody?: string;
  objective: string[];
  readFiles: TaskFileRef[];
  writeTargets: TaskWriteTarget[];
  decisionRules: string[];
  acceptanceCriteria: string[];
  skills: string[];
  extraSections?: TaskExtraSection[];
}

export interface RunArtifacts {
  run_dir: string;
  artifact_dir: string;
  task_file: string;
  result_file: string;
}

function renderList(items: string[], emptyMessage: string): string[] {
  if (items.length === 0) {
    return [`- ${emptyMessage}`];
  }
  return items.map((item) => `- ${item}`);
}

function renderReadFiles(readFiles: TaskFileRef[]): string[] {
  if (readFiles.length === 0) {
    return ["- No additional read files provided."];
  }
  return readFiles.map((file) => `- ${file.label}: ${file.path}`);
}

function renderWriteTargets(writeTargets: TaskWriteTarget[]): string[] {
  if (writeTargets.length === 0) {
    return ["- No writable outputs declared."];
  }

  const lines: string[] = [];
  for (const target of writeTargets) {
    lines.push(`- ${target.label}: ${target.path}`);
    if (target.note) {
      lines.push(`  ${target.note}`);
    }
  }
  return lines;
}

export function renderRunTask(spec: RunTaskSpec): string {
  const lines: string[] = [
    "# Hydra Task",
    "",
    "Hydra runs the workflow, but files are the source of truth for this assignment run.",
    "",
  ];

  // ## Role — additive briefing from the role registry. Rendered first so the
  // worker reads its persona before anything else.
  if (spec.roleBody && spec.roleBody.trim()) {
    lines.push("## Role", "", spec.roleBody.trim(), "");
  }

  lines.push(
    "## Run Context",
    "",
    `- Role: ${spec.role}`,
    `- Workflow ID: ${spec.workflowId}`,
    `- Assignment ID: ${spec.assignmentId}`,
    `- Run ID: ${spec.runId}`,
    spec.sourceRole ? `- Source role: ${spec.sourceRole}` : "",
    `- Agent type: ${spec.agentType}`,
    spec.model ? `- Model: ${spec.model}` : "",
    spec.reasoningEffort ? `- Reasoning effort: ${spec.reasoningEffort}` : "",
    "",
    "## Objective",
    "",
    ...spec.objective,
    "",
    "## Read First",
    "",
    ...renderReadFiles(spec.readFiles),
    "",
    "## Write Targets",
    "",
    ...renderWriteTargets(spec.writeTargets),
    "",
    "## Decision Rules",
    "",
    ...renderList(spec.decisionRules, "No decision rules provided."),
    "",
    "## Acceptance Criteria",
    "",
    ...renderList(spec.acceptanceCriteria, "No acceptance criteria provided."),
    "",
  );

  // Skills section is only emitted when something declares them. The role
  // registry no longer populates this — kept for callers that build a
  // RunTaskSpec by hand (e.g. spawn / single-step run).
  if (spec.skills.length > 0) {
    lines.push("## Skills", "", ...renderList(spec.skills, ""), "");
  }

  for (const section of spec.extraSections ?? []) {
    lines.push(`## ${section.title}`, "");
    lines.push(...section.lines);
    lines.push("");
  }

  lines.push(
    "## Operational Notes",
    "",
    "- Hydra does not infer completion from terminal prose. Only files count.",
    "- Do not fake outputs or add silent fallbacks.",
    "- Root cause first. Fix the real implementation problem before changing tests or fixtures.",
    "- Publish result.json atomically after all required artifacts are complete.",
    "",
    "## Completion",
    "",
    `- Finish every required write target before publishing ${path.basename(getRunResultFile(spec.repoPath, spec.workflowId, spec.assignmentId, spec.runId))}.`,
    "- Make sure result.json reflects the real outcome, not a hopeful guess.",
    "",
  );

  return lines.filter((line) => line !== "").join("\n").replace(/\n##/g, "\n\n##");
}

export function writeRunTask(spec: RunTaskSpec): RunArtifacts {
  const taskFile = getRunTaskFile(spec.repoPath, spec.workflowId, spec.assignmentId, spec.runId);
  const resultFile = getRunResultFile(spec.repoPath, spec.workflowId, spec.assignmentId, spec.runId);
  const artifactDir = getRunArtifactsDir(spec.repoPath, spec.workflowId, spec.assignmentId, spec.runId);
  const runDir = path.dirname(taskFile);

  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(taskFile, renderRunTask(spec), "utf-8");

  return {
    run_dir: runDir,
    artifact_dir: artifactDir,
    task_file: taskFile,
    result_file: resultFile,
  };
}
