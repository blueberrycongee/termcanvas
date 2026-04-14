import fs from "node:fs";
import path from "node:path";
import type { AgentType } from "./assignment/types.ts";
import type { DispatchStatus } from "./decision.ts";
import {
  getWorkbenchDir,
  getWorkbenchStatePath,
} from "./layout.ts";

export const WORKBENCH_STATE_SCHEMA_VERSION = "hydra/workbench-state/v0.1";

export type WorkbenchStatus =
  | "active"
  | "completed"
  | "failed";

export interface WorkbenchFailure {
  code: string;
  message: string;
  stage: string;
}

export interface ApprovedArtifactRef {
  assignment_id: string;
  run_id: string;
  brief_file: string;
  result_file: string;
  approved_at: string;
}

export interface ContextRef {
  label: string;
  path: string;
}

/**
 * Declarative retry policy attached to a dispatch. Modeled after Temporal /
 * Cadence retry policies — when set, takes precedence over the legacy
 * scalar `max_retries` field. The policy is snapshotted onto the
 * AssignmentRecord at dispatch time so retry decisions never have to
 * re-traverse the workbench store.
 */
export interface RetryPolicy {
  /** Wait this long before the first retry (after the first failure). */
  initial_interval_ms?: number;
  /** Each subsequent retry waits coefficient * previous wait. Defaults to 2.0. */
  backoff_coefficient?: number;
  /** Total attempts allowed, including the first try. Replaces max_retries. */
  maximum_attempts?: number;
  /** Error codes that immediately fail the assignment instead of retrying. */
  non_retryable_error_codes?: string[];
}

export interface Dispatch {
  id: string;
  role: string;
  /**
   * Cached agent_type derived from the role registry at dispatch time.
   * Sourced from the role file's frontmatter (claude or codex), NOT from
   * any caller-supplied override — dispatch locks this from the role.
   */
  agent_type: AgentType;
  /**
   * Optional model pin (e.g. "claude-opus-4-6" / "gpt-5.4"). Cached from
   * the chosen role terminal at dispatch time so other code paths don't
   * have to re-resolve the role file.
   */
  model?: string;
  /**
   * Optional reasoning effort level cached from the chosen role terminal
   * (per-CLI native vocabulary: claude max/high/medium/low; codex
   * xhigh/high/medium/low). Honored by the CLI adapter at launch.
   */
  reasoning_effort?: string;

  // Inline status on each dispatch
  status: DispatchStatus;

  // Content references — actual text lives in MD files under dispatches/{id}/
  intent_file: string;       // → dispatches/{id}/intent.md
  feedback_file?: string;    // → dispatches/{id}/feedback.md (set by reset)

  // Lead-provided extra context
  context_refs?: ContextRef[];

  // Parallel isolation
  worktree_path?: string;
  worktree_branch?: string;

  // Per-dispatch overrides
  timeout_minutes?: number;
  /** Legacy scalar retry budget. Superseded by retry_policy when set. */
  max_retries?: number;
  /**
   * Declarative retry policy. When set, takes precedence over max_retries
   * and enables backoff + non-retryable error code handling.
   */
  retry_policy?: RetryPolicy;
}

export interface WorkbenchRecord {
  schema_version: typeof WORKBENCH_STATE_SCHEMA_VERSION;
  id: string;

  // Lead identity — workbench has exactly one Lead terminal
  lead_terminal_id: string;

  // Content reference — workbench intent lives in inputs/intent.md
  intent_file: string;

  // Workspace
  repo_path: string;
  worktree_path: string;
  branch: string | null;
  base_branch: string;
  own_worktree: boolean;

  // Lifecycle
  created_at: string;
  updated_at: string;
  status: WorkbenchStatus;

  // Dispatches — Lead dispatches and sequences manually; no DAG dependencies
  dispatches: Record<string, Dispatch>;

  // Defaults — agent_type is no longer a workbench default; the role file's
  // terminals[] array is the authoritative source for cli/model/reasoning.
  default_timeout_minutes: number;
  default_max_retries: number;
  auto_approve: boolean;

  // Approval refs
  approved_refs?: Record<string, ApprovedArtifactRef>;

  // Workbench-level shared context — broadcast to every dispatched task's
  // task.md under a `## Workflow Context` section. These fields let Dev and
  // Reviewer see the wider picture instead of working from only their local
  // dispatch intent. All three are optional to preserve backward compatibility
  // with workbenches created before this schema extension.
  human_request?: string;          // original human-written request, untouched
  overall_plan?: string;           // Lead's plan/DAG summary (free-form markdown)
  shared_constraints?: string[];   // constraints that apply to every dispatch

  // Final outcome
  result_file?: string;      // → outputs/summary.md (set on completion)
  failure?: WorkbenchFailure;
}

export { getWorkbenchDir, getWorkbenchStatePath };

export function saveWorkbench(workbench: WorkbenchRecord): void {
  const filePath = getWorkbenchStatePath(workbench.repo_path, workbench.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(workbench, null, 2), "utf-8");
}

export function loadWorkbench(repoPath: string, workbenchId: string): WorkbenchRecord | null {
  const filePath = getWorkbenchStatePath(repoPath, workbenchId);
  if (!fs.existsSync(filePath)) return null;
  const workbench = JSON.parse(fs.readFileSync(filePath, "utf-8")) as WorkbenchRecord;
  if (workbench.schema_version !== WORKBENCH_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported workbench state schema in ${filePath}: expected ${WORKBENCH_STATE_SCHEMA_VERSION}, received ${String((workbench as unknown as Record<string, unknown>).schema_version ?? "<missing>")}`,
    );
  }
  return workbench;
}

export function listWorkbenches(repoPath: string): WorkbenchRecord[] {
  const workbenchesRoot = path.join(path.resolve(repoPath), ".hydra", "workbenches");
  let entries: string[];
  try {
    entries = fs.readdirSync(workbenchesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries
    .map((workbenchId) => loadWorkbench(repoPath, workbenchId))
    .filter((workbench): workbench is WorkbenchRecord => workbench !== null);
}

/**
 * Permanently removes all workbench state files (workbench.json, ledger,
 * dispatches, runs). Not called by `hydra cleanup` — cleanup only
 * releases runtime resources (terminals, worktrees, branches) and
 * preserves state for audit. This function exists for:
 *   - janitor-driven archival (move to cold storage, then delete)
 *   - manual emergency purge
 */
export function deleteWorkbench(repoPath: string, workbenchId: string): void {
  fs.rmSync(getWorkbenchDir(repoPath, workbenchId), { recursive: true, force: true });
}
