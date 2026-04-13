import path from "node:path";

export function getHydraRoot(repoPath: string): string {
  return path.join(path.resolve(repoPath), ".hydra");
}

export function getWorkbenchesRoot(repoPath: string): string {
  return path.join(getHydraRoot(repoPath), "workbenches");
}

export function getWorkbenchDir(repoPath: string, workbenchId: string): string {
  return path.join(getWorkbenchesRoot(repoPath), workbenchId);
}

export function getWorkbenchStatePath(repoPath: string, workbenchId: string): string {
  return path.join(getWorkbenchDir(repoPath, workbenchId), "workbench.json");
}

export function getWorkbenchInputsDir(repoPath: string, workbenchId: string): string {
  return path.join(getWorkbenchDir(repoPath, workbenchId), "inputs");
}

export function getWorkbenchIntentFile(repoPath: string, workbenchId: string): string {
  return path.join(getWorkbenchInputsDir(repoPath, workbenchId), "intent.md");
}

export function getWorkbenchOutputsDir(repoPath: string, workbenchId: string): string {
  return path.join(getWorkbenchDir(repoPath, workbenchId), "outputs");
}

export function getWorkbenchSummaryFile(repoPath: string, workbenchId: string): string {
  return path.join(getWorkbenchOutputsDir(repoPath, workbenchId), "summary.md");
}

export function getWorkbenchDispatchesDir(repoPath: string, workbenchId: string): string {
  return path.join(getWorkbenchDir(repoPath, workbenchId), "dispatches");
}

export function getDispatchDir(repoPath: string, workbenchId: string, dispatchId: string): string {
  return path.join(getWorkbenchDispatchesDir(repoPath, workbenchId), dispatchId);
}

export function getDispatchIntentFile(repoPath: string, workbenchId: string, dispatchId: string): string {
  return path.join(getDispatchDir(repoPath, workbenchId, dispatchId), "intent.md");
}

export function getDispatchFeedbackFile(repoPath: string, workbenchId: string, dispatchId: string): string {
  return path.join(getDispatchDir(repoPath, workbenchId, dispatchId), "feedback.md");
}

export function getDispatchStateDir(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
): string {
  return getDispatchDir(repoPath, workbenchId, dispatchId);
}

export function getAssignmentStatePath(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
): string {
  return path.join(getDispatchDir(repoPath, workbenchId, dispatchId), "assignment.json");
}

export function getAssignmentRunsDir(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
): string {
  return path.join(getDispatchDir(repoPath, workbenchId, dispatchId), "runs");
}

export function getRunDir(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  runId: string,
): string {
  return path.join(getAssignmentRunsDir(repoPath, workbenchId, dispatchId), runId);
}

export function getRunTaskFile(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workbenchId, dispatchId, runId), "task.md");
}

export function getRunResultFile(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workbenchId, dispatchId, runId), "result.json");
}

export function getRunArtifactsDir(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workbenchId, dispatchId, runId), "artifacts");
}

export function getRunReportFile(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workbenchId, dispatchId, runId), "report.md");
}

export function getRunApprovalRequestFile(
  repoPath: string,
  workbenchId: string,
  dispatchId: string,
  runId: string,
): string {
  return path.join(getRunArtifactsDir(repoPath, workbenchId, dispatchId, runId), "approval-request.md");
}
