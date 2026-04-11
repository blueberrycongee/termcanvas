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

/**
 * Declarative retry policy attached to a node. Modeled after Temporal /
 * Cadence retry policies — when set, takes precedence over the legacy
 * scalar `max_retries` field. The policy is snapshotted onto the
 * AssignmentRecord at dispatch time so retry decisions never have to
 * re-traverse the workflow store.
 */
export interface RetryPolicy {
  /** Wait this long before the first retry (after the first failure). */
  initial_interval_ms?: number;
  /** Each subsequent retry waits coefficient × previous wait. Defaults to 2.0. */
  backoff_coefficient?: number;
  /** Total attempts allowed, including the first try. Replaces max_retries. */
  maximum_attempts?: number;
  /** Error codes that immediately fail the assignment instead of retrying. */
  non_retryable_error_codes?: string[];
}

export interface WorkflowNode {
  id: string;
  role: string;
  depends_on: string[];
  /**
   * Cached agent_type derived from the role registry at dispatch time.
   * Sourced from the role file's frontmatter (claude or codex), NOT from
   * any caller-supplied override — dispatchNode locks this from the role.
   */
  agent_type: AgentType;
  /**
   * Optional model pin (e.g. "opus" / "gpt-5"). When set, the underlying
   * CLI is invoked with its model flag. Sourced from the role file's
   * frontmatter or an explicit override at dispatch time.
   */
  model?: string;
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
  /** Legacy scalar retry budget. Superseded by retry_policy when set. */
  max_retries?: number;
  /**
   * Declarative retry policy. When set, takes precedence over max_retries
   * and enables backoff + non-retryable error code handling.
   */
  retry_policy?: RetryPolicy;
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
