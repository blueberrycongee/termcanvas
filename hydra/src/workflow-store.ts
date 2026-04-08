import fs from "node:fs";
import path from "node:path";
import type { ChallengeState } from "./challenge.ts";
import type { WorkflowResultContract } from "./protocol.ts";
import {
  getWorkflowDir,
  getWorkflowStatePath,
} from "./layout.ts";

export const WORKFLOW_STATE_SCHEMA_VERSION = "hydra/workflow-state/v2";

export type WorkflowStatus =
  | "pending"
  | "running"
  | "challenging"
  | "waiting_for_approval"
  | "waiting_for_challenge_decision"
  | "completed"
  | "failed";

export interface WorkflowFailure {
  code: string;
  message: string;
  stage: string;
}

export interface ApprovedArtifactRef {
  assignment_id: string;
  run_id: string;
  brief_file: string;
  result_file: string;
  approved_at: string;
}

export interface WorkflowRecord {
  schema_version: typeof WORKFLOW_STATE_SCHEMA_VERSION;
  id: string;
  template: string;
  task: string;
  repo_path: string;
  worktree_path: string;
  branch: string | null;
  base_branch: string;
  own_worktree: boolean;
  parent_terminal_id?: string;
  created_at: string;
  updated_at: string;
  status: WorkflowStatus;
  current_assignment_id: string;
  assignment_ids: string[];
  timeout_minutes: number;
  max_retries: number;
  confirmation_iteration?: number;
  max_confirmation_iterations?: number;
  auto_approve: boolean;
  approved_refs?: {
    research?: ApprovedArtifactRef;
  };
  challenge_request?: {
    source_assignment_id: string;
    requested_at: string;
  };
  challenge?: ChallengeState;
  result?: WorkflowResultContract;
  failure?: WorkflowFailure;
}

export { getWorkflowDir, getWorkflowStatePath };

export function saveWorkflow(workflow: WorkflowRecord): void {
  const filePath = getWorkflowStatePath(workflow.repo_path, workflow.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), "utf-8");
}

export function loadWorkflow(repoPath: string, workflowId: string): WorkflowRecord | null {
  const filePath = getWorkflowStatePath(repoPath, workflowId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const workflow = JSON.parse(
    fs.readFileSync(filePath, "utf-8"),
  ) as WorkflowRecord;
  if (workflow.schema_version !== WORKFLOW_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported workflow state schema in ${filePath}: expected ${WORKFLOW_STATE_SCHEMA_VERSION}, received ${String(workflow.schema_version ?? "<missing>")}`,
    );
  }
  return workflow;
}

export function listWorkflows(repoPath: string): WorkflowRecord[] {
  const workflowsRoot = path.join(path.resolve(repoPath), ".hydra", "workflows");
  let entries: string[];
  try {
    entries = fs.readdirSync(workflowsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  return entries
    .map((workflowId) => loadWorkflow(repoPath, workflowId))
    .filter((workflow): workflow is WorkflowRecord => workflow !== null);
}

export function deleteWorkflow(repoPath: string, workflowId: string): void {
  fs.rmSync(getWorkflowDir(repoPath, workflowId), { recursive: true, force: true });
}
