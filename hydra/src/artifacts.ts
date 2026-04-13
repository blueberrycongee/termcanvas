import fs from "node:fs";
import path from "node:path";
import {
  getDispatchFeedbackFile,
  getDispatchIntentFile,
  getRunReportFile,
  getWorkbenchIntentFile,
  getWorkbenchSummaryFile,
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

// --- Workbench-level intent ---

export function writeWorkbenchIntent(
  repoPath: string,
  workbenchId: string,
  intent: string,
): string {
  const filePath = getWorkbenchIntentFile(repoPath, workbenchId);
  writeFileEnsuringDir(filePath, [
    "# Workbench Intent",
    "",
    "This file is the canonical statement of what the workbench is trying to achieve.",
    "Read it before making downstream decisions.",
    "",
    intent,
    "",
  ].join("\n"));
  return filePath;
}

export function readWorkbenchIntent(filePath: string): string | null {
  return readFileIfExists(filePath);
}

// --- Workbench-level summary (final) ---

export function writeWorkbenchSummary(
  repoPath: string,
  workbenchId: string,
  summary: string,
): string {
  const filePath = getWorkbenchSummaryFile(repoPath, workbenchId);
  writeFileEnsuringDir(filePath, [
    "# Workbench Summary",
    "",
    summary,
    "",
  ].join("\n"));
  return filePath;
}

// --- Dispatch intent ---

export function writeDispatchIntent(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  role: string,
  intent: string,
): string {
  const filePath = getDispatchIntentFile(repoPath, workbenchId, dispatchId);
  writeFileEnsuringDir(filePath, [
    `# ${role} — ${dispatchId}`,
    "",
    intent,
    "",
  ].join("\n"));
  return filePath;
}

export function readDispatchIntent(filePath: string): string | null {
  return readFileIfExists(filePath);
}

// --- Dispatch feedback (set by reset) ---

export function writeDispatchFeedback(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  feedback: string,
): string {
  const filePath = getDispatchFeedbackFile(repoPath, workbenchId, dispatchId);
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

export function clearDispatchFeedback(repoPath: string, workbenchId: string, dispatchId: string): void {
  const filePath = getDispatchFeedbackFile(repoPath, workbenchId, dispatchId);
  try { fs.unlinkSync(filePath); } catch {}
}

// --- Run report (sub-agent's human-readable output) ---

export function getReportFilePath(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  runId: string,
): string {
  return getRunReportFile(repoPath, workbenchId, dispatchId, runId);
}
