import type { NodeStatus } from "./decision.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { WorkflowStatus } from "./workflow-store.ts";

/**
 * Event-sourcing replay over `ledger.jsonl`.
 *
 * The current ledger captures only the **high-level workflow narrative** —
 * what was dispatched, what completed, what failed, what was approved. It
 * was not designed to be a full event source: critical workflow setup
 * (repo_path, worktree_path, defaults), node configuration (depends_on,
 * retry_policy, model, context_refs), and assignment-level state (the full
 * AssignmentStateMachine transition log) live only in workflow.json /
 * assignment.json.
 *
 * `replayLedger` reconstructs the subset that *is* derivable from events:
 *   - workflow.status, intent_file, lead_terminal_id, completion outcome
 *   - the per-node trajectory: dispatched → completed/failed/reset/approved
 *   - the merge history (which nodes were merged together)
 *
 * Anything not in this list is reported via `gaps` so callers (and the
 * replay test) can see exactly which fields are *not yet* event-sourced.
 * The intent is architectural validation: each entry in `gaps` is either a
 * candidate for promotion into the ledger or a deliberate "derived cache"
 * decision that should be documented.
 */

export interface ReplayedNode {
  node_id: string;
  role: string;
  status: NodeStatus;
  /**
   * intent_file path captured from the dispatch event. Tracks the *latest*
   * intent file (re-dispatch / reset overwrites it).
   */
  intent_file: string;
  /** Path to the feedback file written by the most recent reset, if any. */
  feedback_file?: string;
  /** Whether this node has been approved by the Lead. */
  approved: boolean;
  /** Total dispatches observed for this node (initial + redispatches). */
  dispatch_count: number;
  /** Most recent completion outcome, if the node ever reported one. */
  last_outcome?: "completed" | "stuck" | "error";
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
  nodes: Record<string, ReplayedNode>;
  merges: ReplayedMerge[];
}

/**
 * Inventory of `WorkflowRecord` / `WorkflowNode` / `AssignmentRecord` fields
 * that the current ledger event vocabulary cannot reconstruct. Each entry is
 * an architectural debt item: it should either get its own ledger event or
 * be explicitly annotated as a derived/runtime cache.
 *
 * If the ledger schema changes to cover one of these fields, remove it from
 * this list — the replay test will then catch any regression.
 */
export interface ReplayGaps {
  /** Workflow-level setup state never logged by `workflow_created`. */
  workflow_fields_missing_from_ledger: string[];
  /** Node configuration fields never logged by `node_dispatched`. */
  node_fields_missing_from_ledger: string[];
  /** Assignment-level state machine details never logged. */
  assignment_fields_missing_from_ledger: string[];
}

export interface ReplayResult {
  workflow: ReplayedWorkflow;
  gaps: ReplayGaps;
}

export const KNOWN_REPLAY_GAPS: ReplayGaps = {
  workflow_fields_missing_from_ledger: [
    // workflow_created only carries intent_file + lead_terminal_id.
    "id",
    "repo_path",
    "worktree_path",
    "branch",
    "base_branch",
    "own_worktree",
    "default_timeout_minutes",
    "default_max_retries",
    "default_agent_type",
    "auto_approve",
    "approved_refs",
  ],
  node_fields_missing_from_ledger: [
    // node_dispatched only carries node_id + role + agent_type + intent_file.
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
  assignment_fields_missing_from_ledger: [
    // No assignment-level state-machine events are written to the ledger.
    // claim_pending, mark_in_progress, mark_timed_out, schedule_retry,
    // mark_failed, mark_completed all happen silently inside the state
    // machine. The result is that retry_count, transitions[], runs[],
    // last_error, claim, status_updated_at, etc. are all unrecoverable
    // from the ledger alone.
    "retry_count",
    "transitions",
    "runs",
    "last_error",
    "claim",
    "status_updated_at",
    "next_retry_at",
    "result",
  ],
};

export function replayLedger(entries: LedgerEntry[]): ReplayResult {
  const workflow: ReplayedWorkflow = {
    status: "active",
    nodes: {},
    merges: [],
  };

  for (const entry of entries) {
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
        }
        break;
      }

      case "node_failed": {
        const node = workflow.nodes[event.node_id];
        if (node) {
          node.status = "failed";
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
        break;
      }
    }
  }

  return { workflow, gaps: KNOWN_REPLAY_GAPS };
}
