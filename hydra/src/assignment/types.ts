import type { ResultVerification } from "../protocol.ts";

export const ASSIGNMENT_STATE_SCHEMA_VERSION = "hydra/assignment-state/v2";

export type AgentType = "claude" | "codex" | "kimi" | "gemini";

export type AssignmentRole = "researcher" | "implementer" | "tester";

export type AssignmentKind =
  | "single_step"
  | "research"
  | "research_replan"
  | "implementation"
  | "verification"
  | "intent_confirmation";

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
  kind: AssignmentKind;
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
  result?: {
    success: boolean;
    summary?: string;
    outputs?: Array<{
      kind?: string;
      path: string;
      description?: string;
    }>;
    evidence?: string[];
    verification?: ResultVerification;
    satisfaction?: boolean;
    replan?: boolean;
    next_action?: {
      type: "complete" | "retry" | "transition";
      reason: string;
      assignment_id?: string;
    };
    completed_at?: string;
  };
}
