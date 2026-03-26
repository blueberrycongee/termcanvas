import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./handoff/types.ts";
import type { ResultContract } from "./protocol.ts";

export type WorkflowStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowFailure {
  code: string;
  message: string;
  stage: string;
}

export interface WorkflowRecord {
  id: string;
  template: string;
  task: string;
  repo_path: string;
  worktree_path: string;
  branch: string | null;
  base_branch: string;
  own_worktree: boolean;
  agent_type: AgentType;
  parent_terminal_id?: string;
  created_at: string;
  updated_at: string;
  status: WorkflowStatus;
  current_handoff_id: string;
  handoff_ids: string[];
  timeout_minutes: number;
  max_retries: number;
  auto_approve: boolean;
  result?: ResultContract;
  failure?: WorkflowFailure;
}

export function getWorkflowDir(repoPath: string, workflowId: string): string {
  return path.join(path.resolve(repoPath), ".hydra", "workflows", workflowId);
}

export function getWorkflowStatePath(repoPath: string, workflowId: string): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "workflow.json");
}

export function saveWorkflow(workflow: WorkflowRecord): void {
  const filePath = getWorkflowStatePath(workflow.repo_path, workflow.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), "utf-8");
}

export function loadWorkflow(repoPath: string, workflowId: string): WorkflowRecord | null {
  try {
    return JSON.parse(
      fs.readFileSync(getWorkflowStatePath(repoPath, workflowId), "utf-8"),
    ) as WorkflowRecord;
  } catch {
    return null;
  }
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
