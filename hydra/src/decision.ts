import type { StuckReason, SubAgentOutcome } from "./protocol.ts";

export type DispatchStatus =
  | "eligible"
  | "dispatched"
  | "completed"
  | "failed"
  | "reset";

export type DecisionPointType =
  | "dispatch_completed"
  | "dispatch_failed"
  | "dispatch_failed_final"
  | "batch_completed"
  | "watch_timeout";

export interface CompletedDispatchInfo {
  dispatch_id: string;
  role: string;
  outcome: SubAgentOutcome;
  /**
   * Set when outcome === "stuck". Lets Lead route the intervention without
   * having to read report.md first. See StuckReason in protocol.ts for the
   * meaning of each category.
   */
  stuck_reason?: StuckReason;
  report_file: string;          // path to report.md (Lead reads for details)
  duration_ms: number;
  retries_used: number;

  // Optional: session info captured before terminal destruction
  // Lead can use this for `--resume-from` on a future dispatch
  session?: {
    provider: string;
    id: string;
    file?: string;
  };
}

export interface FailedDispatchInfo {
  dispatch_id: string;
  role: string;
  code: string;
  message: string;
  retries_used: number;
  max_retries: number;
}

export interface DispatchSummary {
  dispatch_id: string;
  role: string;
  status: DispatchStatus;
  assignment_id?: string;
}

export interface DecisionPoint {
  type: DecisionPointType;
  workbench_id: string;
  timestamp: string;
  completed?: CompletedDispatchInfo;
  failed?: FailedDispatchInfo;
  dispatches: DispatchSummary[];
}
