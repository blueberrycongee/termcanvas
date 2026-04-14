import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./assignment/types.ts";
import type { StuckReason, RunOutcome } from "./protocol.ts";

// --- Actor: who made the decision recorded in this entry ---
//
// The ledger is read periodically by humans / agents to judge whether
// decisions were correct. The first thing the reader needs to know is
// "who decided this" — Lead, the spawned worker, or Hydra orchestration.
// Mixing the three together makes the audit useless.
export type LedgerActor = "lead" | "worker" | "system";

// --- Ledger event types ---
//
// Why each event records what it does:
//   - cause / failure_message / stuck_reason / failed_dispatch_id let the
//     reader scan a single line and judge correctness without drilling
//     down (drill-down still works via report_file / feedback_file).
//   - dispatch_retried surface system
//     decisions that used to be silent inside the state machine.

export type DispatchCause = "initial" | "system_retry" | "lead_redispatch";

/**
 * Lead's pre-dispatch context note. Free-form annotation recorded in the
 * ledger for audit — lets readers understand what system-level context
 * Lead had when it made the dispatch decision.
 *
 * Not enforced by Hydra. The Lead writes whatever is useful for the
 * audit trail.
 */
export interface LeadAssessment {
  /** How the dispatched work connects to the broader system. */
  architectural_context?: string;
  /** One-line rationale for the dispatch decision. */
  rationale?: string;
}

export type LedgerEvent =
  | { type: "workbench_created"; intent_file: string; lead_terminal_id: string }
  | {
      type: "dispatch_started";
      dispatch_id: string;
      role: string;
      agent_type: AgentType;
      intent_file: string;
      cause: DispatchCause;
      resumed_from_session?: string;
      /** Lead's coupling x novelty assessment at dispatch time. */
      assessment?: LeadAssessment;
    }
  | {
      type: "dispatch_completed";
      dispatch_id: string;
      role: string;
      agent_type: AgentType;
      duration_ms: number;
      retries_used: number;
      outcome: RunOutcome;
      stuck_reason?: StuckReason;
      report_file: string;
      session_id?: string;
    }
  | {
      type: "dispatch_failed";
      dispatch_id: string;
      role: string;
      agent_type: AgentType;
      duration_ms: number;
      retries_used: number;
      failure_code: string;
      failure_message?: string;
      report_file?: string;
    }
  | {
      type: "dispatch_reset";
      dispatch_id: string;
      role: string;
      feedback_file?: string;
    }
  | { type: "dispatch_approved"; dispatch_id: string; role: string }
  /**
   * System-side retry of a single assignment after a timeout or an
   * agent-reported error. Emitted when scheduleRetry queues a fresh attempt
   * (so a corresponding dispatch_started with cause=system_retry follows).
   * Lets the reader audit "should we have retried this / how long until
   * the next attempt".
   */
  | {
      type: "dispatch_retried";
      dispatch_id: string;
      cause: "timeout" | "agent_reported_error";
      attempt: number;
      max_attempts: number;
      next_retry_at?: string;
      failure_code: string;
      failure_message?: string;
    }
  /**
   * Lead asked a follow-up question to a completed dispatch via `hydra ask`.
   * A one-shot subprocess resumed the dispatch's session, answered the
   * question, and exited. The new_session_id is only populated when
   * the CLI supports fork (currently claude via --fork-session); for
   * codex the follow-up appends to the original session id so
   * new_session_id === session_id.
   */
  | {
      type: "lead_asked_followup";
      dispatch_id: string;
      role: string;
      agent_type: AgentType;
      session_id: string;
      new_session_id?: string;
      message_excerpt: string;
      answer_excerpt: string;
      duration_ms: number;
    }
  | { type: "merge_attempted"; source_dispatches: string[]; outcome: "merged" | "conflict" }
  | {
      type: "workbench_completed";
      result_file?: string;
      total_duration_ms: number;
      total_dispatches: number;
      total_retries: number;
    }
  | {
      type: "workbench_failed";
      reason: string;
      total_duration_ms: number;
      failed_dispatch_id?: string;
    };

export interface LedgerEntry {
  timestamp: string;
  actor: LedgerActor;
  event: LedgerEvent;
}

// --- Storage ---

function getLedgerPath(repoPath: string, workbenchId: string): string {
  return path.join(path.resolve(repoPath), ".hydra", "workbenches", workbenchId, "ledger.jsonl");
}

export function appendLedger(
  repoPath: string,
  workbenchId: string,
  actor: LedgerActor,
  event: LedgerEvent,
): void {
  const filePath = getLedgerPath(repoPath, workbenchId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const entry: LedgerEntry = {
    timestamp: new Date().toISOString(),
    actor,
    event,
  };
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

export function readLedger(
  repoPath: string,
  workbenchId: string,
): LedgerEntry[] {
  const filePath = getLedgerPath(repoPath, workbenchId);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (content === "") return [];
  return content.split("\n").map((line) => JSON.parse(line) as LedgerEntry);
}
