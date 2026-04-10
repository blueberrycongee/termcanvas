import type { SubAgentOutcome } from "../protocol.ts";

export const ASSIGNMENT_STATE_SCHEMA_VERSION = "hydra/assignment-state/v0.1";

export type AgentType = "claude" | "codex" | "kimi" | "gemini";

export type AssignmentRole = string;

export type AssignmentStatus =
  | "pending"
  | "claimed"
  | "in_progress"
  | "completed"
  | "timed_out"
  | "failed";

export interface AssignmentClaim {
  tick_id: string;
  claimed_at: string;
}

export interface AssignmentTransition {
  event:
    | "claim_pending"
    | "mark_in_progress"
    | "mark_completed"
    | "mark_failed"
    | "mark_timed_out"
    | "schedule_retry"
    | "retry_exhausted"
    | "manual_retry"
    | "requeue_assignment";
  from: AssignmentStatus;
  to: AssignmentStatus;
  at: string;
  tick_id?: string;
  run_id?: string;
}

export interface AssignmentError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  at: string;
}

export interface AssignmentRun {
  id: string;
  terminal_id: string;
  agent_type: AgentType;
  prompt: string;
  task_file: string;
  result_file: string;
  artifact_dir: string;
  status: "running" | "completed" | "timed_out" | "failed";
  started_at: string;
  ended_at?: string;
  retry_of_run_id?: string;

  // Session fields — captured from telemetry before terminal destruction.
  // Used for resume: a future dispatch can `claude --resume <session_id>`
  // to reuse the same agent context.
  session_id?: string;
  session_file?: string;
  session_provider?: string;
}

export interface AssignmentResult {
  outcome: SubAgentOutcome;
  report_file: string;
  completed_at?: string;
}

export interface AssignmentRecord {
  schema_version: typeof ASSIGNMENT_STATE_SCHEMA_VERSION;
  id: string;
  workflow_id: string;
  created_at: string;
  updated_at: string;
  workspace_root?: string;
  worktree_path?: string;
  role: AssignmentRole;
  from_assignment_id: string | null;
  requested_agent_type: AgentType;
  status: AssignmentStatus;
  status_updated_at?: string;
  timeout_minutes?: number;
  retry_count: number;
  max_retries: number;
  active_run_id: string | null;
  runs: AssignmentRun[];
  claim?: AssignmentClaim;
  transitions?: AssignmentTransition[];
  last_error?: AssignmentError;
  result?: AssignmentResult;
}
