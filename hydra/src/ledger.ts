import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./assignment/types.ts";
import type { StuckReason, SubAgentOutcome } from "./protocol.ts";

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
//   - cause / failure_message / stuck_reason / failed_node_id let the
//     reader scan a single line and judge correctness without drilling
//     down (drill-down still works via report_file / feedback_file).
//   - assignment_retried + node_promoted_eligible surface system
//     decisions that used to be silent inside the state machine.

export type DispatchCause = "initial" | "system_retry" | "lead_redispatch";

export type LedgerEvent =
  | { type: "workflow_created"; intent_file: string; lead_terminal_id: string }
  | {
      type: "node_dispatched";
      node_id: string;
      role: string;
      agent_type: AgentType;
      intent_file: string;
      cause: DispatchCause;
      resumed_from_session?: string;
    }
  | {
      type: "node_completed";
      node_id: string;
      role: string;
      agent_type: AgentType;
      duration_ms: number;
      retries_used: number;
      outcome: SubAgentOutcome;
      stuck_reason?: StuckReason;
      report_file: string;
      session_id?: string;
    }
  | {
      type: "node_failed";
      node_id: string;
      role: string;
      agent_type: AgentType;
      duration_ms: number;
      retries_used: number;
      failure_code: string;
      failure_message?: string;
      report_file?: string;
    }
  | {
      type: "node_reset";
      node_id: string;
      role: string;
      feedback_file?: string;
      cascade_targets: string[];
    }
  | { type: "node_approved"; node_id: string; role: string }
  /**
   * System-side retry of a single assignment after a timeout or an
   * agent-reported error. Emitted when scheduleRetry queues a fresh attempt
   * (so a corresponding node_dispatched with cause=system_retry follows).
   * Lets the reader audit "should we have retried this / how long until
   * the next attempt".
   */
  | {
      type: "assignment_retried";
      node_id: string;
      cause: "timeout" | "agent_reported_error";
      attempt: number;
      max_attempts: number;
      next_retry_at?: string;
      failure_code: string;
      failure_message?: string;
    }
  /**
   * System-side promotion of a previously blocked node to "eligible" once
   * its dependencies completed. Lets the reader audit "did Hydra promote
   * the right node, at the right time, after the right deps".
   */
  | {
      type: "node_promoted_eligible";
      node_id: string;
      triggered_by: string[];
    }
  /**
   * Lead asked a follow-up question to a completed node via `hydra ask`.
   * A one-shot subprocess resumed the node's session, answered the
   * question, and exited. The new_session_id is only populated when
   * the CLI supports fork (currently claude via --fork-session); for
   * codex the follow-up appends to the original session id so
   * new_session_id === session_id.
   */
  | {
      type: "lead_asked_followup";
      node_id: string;
      role: string;
      agent_type: AgentType;
      session_id: string;
      new_session_id?: string;
      message_excerpt: string;
      answer_excerpt: string;
      duration_ms: number;
    }
  | { type: "merge_attempted"; source_nodes: string[]; outcome: "merged" | "conflict" }
  | {
      type: "workflow_completed";
      result_file?: string;
      total_duration_ms: number;
      total_nodes: number;
      total_retries: number;
    }
  | {
      type: "workflow_failed";
      reason: string;
      total_duration_ms: number;
      failed_node_id?: string;
    };

export interface LedgerEntry {
  timestamp: string;
  actor: LedgerActor;
  event: LedgerEvent;
}

// --- Storage ---

function getLedgerPath(repoPath: string, workflowId: string): string {
  return path.join(path.resolve(repoPath), ".hydra", "workflows", workflowId, "ledger.jsonl");
}

export function appendLedger(
  repoPath: string,
  workflowId: string,
  actor: LedgerActor,
  event: LedgerEvent,
): void {
  const filePath = getLedgerPath(repoPath, workflowId);
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
  workflowId: string,
): LedgerEntry[] {
  const filePath = getLedgerPath(repoPath, workflowId);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (content === "") return [];
  return content.split("\n").map((line) => JSON.parse(line) as LedgerEntry);
}
