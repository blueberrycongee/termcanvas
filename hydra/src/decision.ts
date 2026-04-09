import type { SubAgentResult } from "./protocol.ts";

export type NodeStatus =
  | "blocked"
  | "eligible"
  | "dispatched"
  | "completed"
  | "failed"
  | "reset";

export type DecisionPointType =
  | "node_completed"
  | "node_failed"
  | "node_failed_final"
  | "batch_completed"
  | "watch_timeout";

export interface CompletedNodeInfo {
  node_id: string;
  role: string;
  result: SubAgentResult;
  brief_file?: string;
  result_file: string;
  artifact_dir: string;
  duration_ms: number;
  retries_used: number;
}

export interface FailedNodeInfo {
  node_id: string;
  role: string;
  code: string;
  message: string;
  retries_used: number;
  max_retries: number;
}

export interface NodeSummary {
  node_id: string;
  role: string;
  status: NodeStatus;
  depends_on: string[];
  assignment_id?: string;
}

export interface DecisionPoint {
  type: DecisionPointType;
  workflow_id: string;
  timestamp: string;
  completed?: CompletedNodeInfo;
  failed?: FailedNodeInfo;
  nodes: NodeSummary[];
  newly_eligible?: string[];
}
