import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./assignment/types.ts";
import type { SubAgentOutcome } from "./protocol.ts";

// --- Ledger event types ---

export type LedgerEvent =
  | { type: "workflow_created"; intent_file: string; lead_terminal_id: string }
  | {
      type: "node_dispatched";
      node_id: string;
      role: string;
      agent_type: AgentType;
      intent_file: string;
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
    }
  | {
      type: "node_reset";
      node_id: string;
      role: string;
      feedback_file?: string;
      cascade_targets: string[];
    }
  | { type: "node_approved"; node_id: string; role: string }
  | { type: "merge_attempted"; source_nodes: string[]; outcome: "merged" | "conflict" }
  | {
      type: "workflow_completed";
      result_file?: string;
      total_duration_ms: number;
      total_nodes: number;
      total_retries: number;
    }
  | { type: "workflow_failed"; reason: string; total_duration_ms: number };

export interface LedgerEntry {
  timestamp: string;
  event: LedgerEvent;
}

// --- Storage ---

function getLedgerPath(repoPath: string, workflowId: string): string {
  return path.join(path.resolve(repoPath), ".hydra", "workflows", workflowId, "ledger.jsonl");
}

export function appendLedger(
  repoPath: string,
  workflowId: string,
  event: LedgerEvent,
): void {
  const filePath = getLedgerPath(repoPath, workflowId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const entry: LedgerEntry = {
    timestamp: new Date().toISOString(),
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
