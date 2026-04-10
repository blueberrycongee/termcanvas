import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./assignment/types.ts";
import type { NodeStatus } from "./decision.ts";
import {
  getWorkflowDir,
  getWorkflowStatePath,
} from "./layout.ts";

export const WORKFLOW_STATE_SCHEMA_VERSION = "hydra/workflow-state/v0.1";

export type WorkflowStatus =
  | "active"
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

export interface ContextRef {
  label: string;
  path: string;
}

export interface WorkflowNode {
  id: string;
  role: string;
  depends_on: string[];
  agent_type: AgentType;
  assignment_id?: string;

  // Content references — actual text lives in MD files under nodes/{id}/
  intent_file: string;       // → nodes/{id}/intent.md
  feedback_file?: string;    // → nodes/{id}/feedback.md (set by reset)

  // Lead-provided extra context (supplements depends_on auto-injection)
  context_refs?: ContextRef[];

  // Parallel isolation
  worktree_path?: string;
  worktree_branch?: string;

  // Per-node overrides
  timeout_minutes?: number;
  max_retries?: number;
}

export interface WorkflowRecord {
  schema_version: typeof WORKFLOW_STATE_SCHEMA_VERSION;
  id: string;

  // Lead identity — workflow has exactly one Lead terminal
  lead_terminal_id: string;

  // Content reference — workflow intent lives in inputs/intent.md
  intent_file: string;

  // Workspace
  repo_path: string;
  worktree_path: string;
  branch: string | null;
  base_branch: string;
  own_worktree: boolean;

  // Lifecycle
  created_at: string;
  updated_at: string;
  status: WorkflowStatus;

  // DAG
  nodes: Record<string, WorkflowNode>;
  node_statuses: Record<string, NodeStatus>;
  assignment_ids: string[];

  // Defaults
  default_timeout_minutes: number;
  default_max_retries: number;
  default_agent_type: AgentType;
  auto_approve: boolean;

  // Approval refs
  approved_refs?: Record<string, ApprovedArtifactRef>;

  // Final outcome
  result_file?: string;      // → outputs/summary.md (set on completion)
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
  if (!fs.existsSync(filePath)) return null;
  const workflow = JSON.parse(fs.readFileSync(filePath, "utf-8")) as WorkflowRecord;
  if (workflow.schema_version !== WORKFLOW_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported workflow state schema in ${filePath}: expected ${WORKFLOW_STATE_SCHEMA_VERSION}, received ${String((workflow as unknown as Record<string, unknown>).schema_version ?? "<missing>")}`,
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
