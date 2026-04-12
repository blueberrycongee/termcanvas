export type TelemetryProvider = "claude" | "codex" | "wuu" | "unknown";

export type TelemetrySource =
  | "session"
  | "pty"
  | "process"
  | "worktree"
  | "contract"
  | "system";

export type TelemetryTurnState =
  | "unknown"
  | "thinking"
  | "in_turn"
  | "tool_running"
  | "tool_pending"
  | "turn_complete"
  | "turn_aborted"
  | "awaiting_input";

export type SessionAttachConfidence = "strong" | "medium" | "weak" | "none";

export type TelemetryDerivedStatus =
  | "idle"
  | "starting"
  | "progressing"
  | "awaiting_contract"
  | "stall_candidate"
  | "error"
  | "exited";

export type TelemetryTaskStatus = "running" | "idle" | "unknown";
export type TelemetryTaskStatusSource =
  | "active_tool_calls"
  | "turn_state"
  | "session_heartbeat"
  | "none";

export interface TelemetryProcessInfo {
  pid: number;
  command: string;
  cli_type?: string | null;
}

export interface TelemetryEvent {
  id: string;
  at: string;
  terminal_id: string;
  workflow_id?: string;
  assignment_id?: string;
  source: TelemetrySource;
  kind: string;
  data: Record<string, unknown>;
}

export interface NormalizedSessionTelemetryEvent {
  at?: string;
  event_type: string;
  event_subtype?: string;
  role?: string;
  tool_name?: string;
  call_id?: string;
  lifecycle?: "start" | "end";
  token_total?: number;
  turn_state?: TelemetryTurnState;
  meaningful_progress?: boolean;
  raw_ref?: string;
}

export interface TerminalTelemetrySnapshot {
  terminal_id: string;
  worktree_path: string;
  provider: TelemetryProvider;
  workflow_id?: string;
  assignment_id?: string;
  repo_path?: string;
  session_attached: boolean;
  session_attach_confidence: SessionAttachConfidence;
  session_id?: string;
  session_file?: string;
  last_session_event_at?: string;
  last_session_event_kind?: string;
  turn_state: TelemetryTurnState;
  turn_started_at?: string;
  pty_alive: boolean;
  exit_code?: number;
  last_output_at?: string;
  last_input_at?: string;
  process_snapshot_at?: string;
  descendant_processes: TelemetryProcessInfo[];
  foreground_tool?: string;
  active_tool_calls: number;
  pending_tool_use_at?: string;
  last_tool_event_at?: string;
  task_status?: TelemetryTaskStatus;
  task_status_source?: TelemetryTaskStatusSource;
  git_activity_at?: string;
  worktree_activity_at?: string;
  contract_activity_at?: string;
  result_exists: boolean;
  result_valid?: boolean;
  last_meaningful_progress_at?: string;
  last_hook_error?: string;
  last_hook_error_details?: string;
  first_user_prompt?: string;
  derived_status: TelemetryDerivedStatus;
}

export interface WorkflowTelemetrySnapshot {
  workflow_id: string;
  repo_path: string;
  workflow_status: string;
  current_assignment_id?: string;
  terminal_id?: string | null;
  terminal: TerminalTelemetrySnapshot | null;
  contract: {
    result_exists: boolean;
    result_valid?: boolean;
    contract_activity_at?: string;
  };
  last_meaningful_progress_at?: string;
  retry_budget: {
    used: number;
    max: number;
    remaining: number;
  };
  timeout_budget: {
    minutes: number;
    started_at?: string;
    deadline_at?: string;
    remaining_ms?: number;
  };
  advisory_status: TelemetryDerivedStatus | "unavailable";
}

export interface TelemetryEventPage {
  events: TelemetryEvent[];
  next_cursor?: string;
}
