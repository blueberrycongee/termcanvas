import type { NodeStatus } from "./decision.ts";
import type { LedgerActor, LedgerEntry } from "./ledger.ts";
import type { StuckReason, SubAgentOutcome } from "./protocol.ts";
import type { WorkflowStatus } from "./workflow-store.ts";

/**
 * Ledger summary builder.
 *
 * **This is not an event-sourcing recovery layer.** Hydra's source of truth
 * is `workflow.json` + `assignment.json`; the ledger is a Lead-readable
 * audit log used to scan "what happened and was every decision correct".
 *
 * `summarizeLedger` reduces a stream of `LedgerEntry` events into a
 * structured summary that answers the five questions a Lead or a periodic
 * auditor wants to ask without opening any other file:
 *
 *   1. What is this workflow's lifecycle status, and how did it get there?
 *   2. What decisions did the Lead make, and on what?
 *   3. What decisions did the system make on its own (retries, promotions)?
 *   4. What did each worker conclude (outcome + stuck_reason)?
 *   5. Where do I drill down for the full story (report.md, feedback.md)?
 *
 * Fields that deliberately do **not** live in the ledger are listed under
 * `INTENTIONALLY_NOT_LEDGERED` with the design rationale. Adding them to
 * the ledger would either duplicate state already in `*.json` or expand
 * the ledger past the point a human can usefully scan it.
 */

export interface ReplayedNode {
  node_id: string;
  role: string;
  status: NodeStatus;
  intent_file: string;
  feedback_file?: string;
  approved: boolean;
  /** Total dispatches observed (initial + Lead redispatches + system retries). */
  dispatch_count: number;
  /** Most recent worker verdict, if the node ever reported one. */
  last_outcome?: SubAgentOutcome;
  /** Sub-state Lead can route on when last_outcome === "stuck". */
  last_stuck_reason?: StuckReason;
  /** Most recent failure code, if the node ever failed. */
  last_failure_code?: string;
  /** Most recent failure message (human-readable). */
  last_failure_message?: string;
  /** report.md path of the most recent failure run, if the worker wrote one. */
  last_failure_report_file?: string;
}

export interface SystemRetryEvent {
  node_id: string;
  cause: "timeout" | "agent_reported_error";
  attempt: number;
  max_attempts: number;
  next_retry_at?: string;
  failure_code: string;
  failure_message?: string;
}

export interface NodePromotionEvent {
  node_id: string;
  triggered_by: string[];
}

export interface ReplayedMerge {
  source_nodes: string[];
  outcome: "merged" | "conflict";
}

export interface ReplayedWorkflow {
  status: WorkflowStatus;
  intent_file?: string;
  lead_terminal_id?: string;
  result_file?: string;
  failure_reason?: string;
  failed_node_id?: string;
  nodes: Record<string, ReplayedNode>;
  merges: ReplayedMerge[];
  /** System decisions to retry an assignment after timeout / agent error. */
  system_retries: SystemRetryEvent[];
  /** System decisions to promote blocked nodes to eligible. */
  promotions: NodePromotionEvent[];
  /** Per-actor counts so callers can filter "what did Lead vs system do". */
  actor_counts: Record<LedgerActor, number>;
}

/**
 * Inventory of fields that deliberately do not appear in the ledger and
 * should be read from `*.json` files instead. This is **architectural
 * design**, not technical debt — every entry below has a documented reason.
 *
 * If a future change moves one of these fields into the ledger, remove its
 * row here and tighten the matching test in `ledger-replay.test.ts`. If a
 * future change adds a new load-bearing field somewhere, decide whether it
 * is a *decision* (→ promote into the ledger) or *configuration / state*
 * (→ add it here with a one-line rationale).
 */
export const INTENTIONALLY_NOT_LEDGERED = {
  workflow_setup: {
    fields: [
      "id",
      "repo_path",
      "worktree_path",
      "branch",
      "base_branch",
      "own_worktree",
      "default_timeout_minutes",
      "default_max_retries",
      "auto_approve",
      "approved_refs",
    ],
    rationale:
      "Workflow setup parameters are configuration, not decisions. They live in workflow.json and never change after init. Putting them in the ledger would bloat every audit scan with static config the reader does not need to judge.",
  },
  node_configuration: {
    fields: [
      "depends_on",
      "model",
      "retry_policy",
      "context_refs",
      "worktree_path",
      "worktree_branch",
      "timeout_minutes",
      "max_retries",
      "assignment_id",
    ],
    rationale:
      "Node-level configuration lives in workflow.json. The ledger records the dispatch *decision* (role, cause, intent_file). To answer 'is this dispatch correct', the reader judges the decision; to answer 'what config did it use', the reader drills into workflow.json.",
  },
  assignment_state_machine: {
    fields: [
      "retry_count",
      "transitions",
      "runs",
      "last_error",
      "claim",
      "status_updated_at",
      "next_retry_at",
      "result",
    ],
    rationale:
      "AssignmentStateMachine internal state lives in assignment.json. The ledger records *user-meaningful* state-machine outcomes (assignment_retried, node_completed, node_failed) but not every claim_pending → claimed → in_progress micro-transition. Recording every micro-transition is the wrong granularity for 'is this decision correct'.",
  },
} as const;

export interface ReplayResult {
  workflow: ReplayedWorkflow;
}

export function replayLedger(entries: LedgerEntry[]): ReplayResult {
  const workflow: ReplayedWorkflow = {
    status: "active",
    nodes: {},
    merges: [],
    system_retries: [],
    promotions: [],
    actor_counts: { lead: 0, worker: 0, system: 0 },
  };

  for (const entry of entries) {
    workflow.actor_counts[entry.actor] = (workflow.actor_counts[entry.actor] ?? 0) + 1;

    const { event } = entry;
    switch (event.type) {
      case "workflow_created": {
        workflow.intent_file = event.intent_file;
        workflow.lead_terminal_id = event.lead_terminal_id;
        workflow.status = "active";
        break;
      }

      case "node_dispatched": {
        const existing = workflow.nodes[event.node_id];
        if (existing) {
          existing.intent_file = event.intent_file;
          existing.dispatch_count += 1;
          existing.status = "dispatched";
        } else {
          workflow.nodes[event.node_id] = {
            node_id: event.node_id,
            role: event.role,
            status: "dispatched",
            intent_file: event.intent_file,
            approved: false,
            dispatch_count: 1,
          };
        }
        break;
      }

      case "node_completed": {
        const node = workflow.nodes[event.node_id];
        if (node) {
          node.status = "completed";
          node.last_outcome = event.outcome;
          node.last_stuck_reason = event.stuck_reason;
        }
        break;
      }

      case "node_failed": {
        const node = workflow.nodes[event.node_id];
        if (node) {
          node.status = "failed";
          node.last_failure_code = event.failure_code;
          node.last_failure_message = event.failure_message;
          node.last_failure_report_file = event.report_file;
        }
        break;
      }

      case "node_reset": {
        const node = workflow.nodes[event.node_id];
        if (node) {
          node.status = "reset";
          node.feedback_file = event.feedback_file;
          node.approved = false;
        }
        for (const cascadeId of event.cascade_targets) {
          const cascade = workflow.nodes[cascadeId];
          if (cascade) {
            cascade.status = "blocked";
            cascade.approved = false;
          }
        }
        break;
      }

      case "node_approved": {
        const node = workflow.nodes[event.node_id];
        if (node) {
          node.approved = true;
        }
        break;
      }

      case "assignment_retried": {
        workflow.system_retries.push({
          node_id: event.node_id,
          cause: event.cause,
          attempt: event.attempt,
          max_attempts: event.max_attempts,
          next_retry_at: event.next_retry_at,
          failure_code: event.failure_code,
          failure_message: event.failure_message,
        });
        break;
      }

      case "node_promoted_eligible": {
        workflow.promotions.push({
          node_id: event.node_id,
          triggered_by: event.triggered_by,
        });
        break;
      }

      case "merge_attempted": {
        workflow.merges.push({
          source_nodes: event.source_nodes,
          outcome: event.outcome,
        });
        break;
      }

      case "workflow_completed": {
        workflow.status = "completed";
        workflow.result_file = event.result_file;
        break;
      }

      case "workflow_failed": {
        workflow.status = "failed";
        workflow.failure_reason = event.reason;
        workflow.failed_node_id = event.failed_node_id;
        break;
      }
    }
  }

  return { workflow };
}
