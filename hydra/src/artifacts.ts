import fs from "node:fs";
import path from "node:path";
import {
  getNodeFeedbackFile,
  getNodeIntentFile,
  getRunReportFile,
  getWorkflowIntentFile,
  getWorkflowSummaryFile,
} from "./layout.ts";

// Helpers for content files (markdown).
//
// Hydra schemas store paths in JSON; the actual human-readable content
// lives in MD files written and read through this module. Keeping the IO
// in one place makes it easy to evolve the file naming or add new content
// types without grepping the codebase.

function writeFileEnsuringDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

// --- Workflow-level intent ---

export function writeWorkflowIntent(
  repoPath: string,
  workflowId: string,
  intent: string,
): string {
  const filePath = getWorkflowIntentFile(repoPath, workflowId);
  writeFileEnsuringDir(filePath, [
    "# Workflow Intent",
    "",
    "This file is the canonical statement of what the workflow is trying to achieve.",
    "Read it before making downstream decisions.",
    "",
    intent,
    "",
  ].join("\n"));
  return filePath;
}

export function readWorkflowIntent(filePath: string): string | null {
  return readFileIfExists(filePath);
}

// --- Workflow-level summary (final) ---

export function writeWorkflowSummary(
  repoPath: string,
  workflowId: string,
  summary: string,
): string {
  const filePath = getWorkflowSummaryFile(repoPath, workflowId);
  writeFileEnsuringDir(filePath, [
    "# Workflow Summary",
    "",
    summary,
    "",
  ].join("\n"));
  return filePath;
}

// --- Node intent ---

export function writeNodeIntent(
  repoPath: string,
  workflowId: string,
  nodeId: string,
  role: string,
  intent: string,
): string {
  const filePath = getNodeIntentFile(repoPath, workflowId, nodeId);
  writeFileEnsuringDir(filePath, [
    `# ${role} — Node ${nodeId}`,
    "",
    intent,
    "",
  ].join("\n"));
  return filePath;
}

export function readNodeIntent(filePath: string): string | null {
  return readFileIfExists(filePath);
}

// --- Node feedback (set by reset) ---

export function writeNodeFeedback(
  repoPath: string,
  workflowId: string,
  nodeId: string,
  feedback: string,
): string {
  const filePath = getNodeFeedbackFile(repoPath, workflowId, nodeId);
  writeFileEnsuringDir(filePath, [
    "# Feedback",
    "",
    "This task was sent back with the following feedback. Address it directly.",
    "",
    feedback,
    "",
  ].join("\n"));
  return filePath;
}

export function clearNodeFeedback(repoPath: string, workflowId: string, nodeId: string): void {
  const filePath = getNodeFeedbackFile(repoPath, workflowId, nodeId);
  try { fs.unlinkSync(filePath); } catch {}
}

// --- Run report (sub-agent's human-readable output) ---

export function getReportFilePath(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return getRunReportFile(repoPath, workflowId, assignmentId, runId);
}
