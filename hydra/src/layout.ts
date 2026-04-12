import path from "node:path";

export function getHydraRoot(repoPath: string): string {
  return path.join(path.resolve(repoPath), ".hydra");
}

export function getWorkflowsRoot(repoPath: string): string {
  return path.join(getHydraRoot(repoPath), "workflows");
}

export function getWorkflowDir(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowsRoot(repoPath), workflowId);
}

export function getWorkflowStatePath(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "workflow.json");
}

export function getWorkflowInputsDir(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "inputs");
}

export function getWorkflowIntentFile(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowInputsDir(repoPath, workflowId), "intent.md");
}

/** @deprecated use getWorkflowIntentFile */
export function getWorkflowUserRequestPath(repoPath: string, workflowId: string): string {
  return getWorkflowIntentFile(repoPath, workflowId);
}

export function getWorkflowOutputsDir(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "outputs");
}

export function getWorkflowSummaryFile(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowOutputsDir(repoPath, workflowId), "summary.md");
}

export function getWorkflowNodesDir(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "nodes");
}

export function getNodeDir(repoPath: string, workflowId: string, nodeId: string): string {
  return path.join(getWorkflowNodesDir(repoPath, workflowId), nodeId);
}

export function getNodeIntentFile(repoPath: string, workflowId: string, nodeId: string): string {
  return path.join(getNodeDir(repoPath, workflowId, nodeId), "intent.md");
}

export function getNodeFeedbackFile(repoPath: string, workflowId: string, nodeId: string): string {
  return path.join(getNodeDir(repoPath, workflowId, nodeId), "feedback.md");
}

export function getWorkflowAssignmentsDir(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "assignments");
}

export function getAssignmentDir(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
): string {
  return path.join(getWorkflowAssignmentsDir(repoPath, workflowId), assignmentId);
}

export function getAssignmentStatePath(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
): string {
  return path.join(getAssignmentDir(repoPath, workflowId, assignmentId), "assignment.json");
}

export function getAssignmentRunsDir(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
): string {
  return path.join(getAssignmentDir(repoPath, workflowId, assignmentId), "runs");
}

export function getRunDir(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getAssignmentRunsDir(repoPath, workflowId, assignmentId), runId);
}

export function getRunTaskFile(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workflowId, assignmentId, runId), "task.md");
}

export function getRunResultFile(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workflowId, assignmentId, runId), "result.json");
}

export function getRunArtifactsDir(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workflowId, assignmentId, runId), "artifacts");
}

export function getRunReportFile(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getRunDir(repoPath, workflowId, assignmentId, runId), "report.md");
}

/** @deprecated use getRunReportFile */
export function getRunBriefFile(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return getRunReportFile(repoPath, workflowId, assignmentId, runId);
}

export function getRunApprovalRequestFile(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getRunArtifactsDir(repoPath, workflowId, assignmentId, runId), "approval-request.md");
}
