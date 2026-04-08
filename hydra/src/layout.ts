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

export function getWorkflowUserRequestPath(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowInputsDir(repoPath, workflowId), "user-request.md");
}

export function getWorkflowRevisionRequestPath(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowInputsDir(repoPath, workflowId), "revision-request.md");
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

export function getRunBriefFile(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getRunArtifactsDir(repoPath, workflowId, assignmentId, runId), "brief.md");
}

export function getRunApprovalRequestFile(
  repoPath: string,
  workflowId: string,
  assignmentId: string,
  runId: string,
): string {
  return path.join(getRunArtifactsDir(repoPath, workflowId, assignmentId, runId), "approval-request.md");
}
