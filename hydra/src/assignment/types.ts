import type { RunOutcome } from "../protocol.ts";
import type { RetryPolicy } from "../workflow-store.ts";

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

export interface AssignmentProcessIdentity {
  /**
   * PID of the PTY's login shell at dispatch time. The agent CLI is a
   * descendant of this PID. Captured from telemetry on a best-effort basis;
   * absent when the telemetry service is unreachable or the PTY had not yet
   * spawned its shell at capture time.
   */
  shell_pid: number | null;
  /**
   * ISO timestamp at which shell_pid was observed. Together with shell_pid,
   * forms the fingerprint a reconcile pass uses to distinguish a still-alive
   * worker from a kernel-recycled PID: if /proc/<pid> exists but its start
   * time is far later than captured_at, the PID has been reused.
   */
  captured_at: string;
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

  /**
   * Durable process identity for this run. Optional for forward compatibility:
   * runs written before this field existed have no identity, and runs where
   * capture failed also lack it. Reconcile logic treats a missing identity as
   * "unknown liveness — ask the user instead of acting autonomously".
   */
  process_identity?: AssignmentProcessIdentity;
}

export interface AssignmentResult {
  outcome: RunOutcome;
  report_file: string;
  completed_at?: string;
}

export interface AssignmentRecord {
  schema_version: typeof ASSIGNMENT_STATE_SCHEMA_VERSION;
  id: string;
  workbench_id: string;
  created_at: string;
  updated_at: string;
  worktree_path?: string;
  role: AssignmentRole;
  requested_agent_type: AgentType;
  status: AssignmentStatus;
  status_updated_at?: string;
  timeout_minutes?: number;
  retry_count: number;
  max_retries: number;
  /**
   * Snapshot of the node's retry_policy at dispatch time. When set, takes
   * precedence over the scalar max_retries field. Snapshotted (not
   * dereferenced) so the state machine never has to load the workflow.
   */
  retry_policy?: RetryPolicy;
  /**
   * Earliest timestamp at which the next retry may dispatch. Set by
   * scheduleRetry when a backoff interval applies; consumed by the
   * redispatch path in the watch loop.
   */
  next_retry_at?: string;
  active_run_id: string | null;
  runs: AssignmentRun[];
  claim?: AssignmentClaim;
  transitions?: AssignmentTransition[];
  last_error?: AssignmentError;
  result?: AssignmentResult;
}
