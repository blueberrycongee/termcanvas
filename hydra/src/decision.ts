import type { TelemetryDerivedStatus } from "../../shared/telemetry.ts";
import type { StuckReason, RunOutcome } from "./protocol.ts";

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
  | "watch_timeout"
  | "stall_advisory";

export interface CompletedDispatchInfo {
  dispatch_id: string;
  role: string;
  outcome: RunOutcome;
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

/**
 * stall_advisory payload. Surfaced only when every in-flight dispatch has
 * not made meaningful progress for longer than the advisory threshold.
 * The Lead decides what to do (reset-feedback, wait, kill) — Hydra never
 * auto-kills on this signal because legitimate long tool calls and
 * agent-reported errors share the same telemetry shape.
 */
export interface StallAdvisoryInfo {
  dispatches: Array<{
    dispatch_id: string;
    role: string;
    agent_type: string;
    derived_status: TelemetryDerivedStatus | "unknown";
    last_meaningful_progress_at?: string;
    /** Milliseconds since last_meaningful_progress_at at the time of advisory. */
    stalled_for_ms?: number;
    /** The advisory threshold the dispatch exceeded (agent-type specific). */
    advisory_threshold_ms: number;
  }>;
  /**
   * False when telemetry was unreachable for one or more of the in-flight
   * dispatches. A stall_advisory is only emitted when every dispatch
   * reports stalled, so this is mostly informational — Lead can see which
   * probes succeeded via the per-dispatch entries above.
   */
  telemetry_available: boolean;
}

export interface DecisionPoint {
  type: DecisionPointType;
  workbench_id: string;
  timestamp: string;
  completed?: CompletedDispatchInfo;
  failed?: FailedDispatchInfo;
  advisory?: StallAdvisoryInfo;
  dispatches: DispatchSummary[];
}
