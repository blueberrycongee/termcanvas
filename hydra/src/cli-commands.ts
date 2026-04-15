import fs from "node:fs";
import path from "node:path";
import { readLedger, type LeadAssessment, type LedgerEntry, type LedgerEvent } from "./ledger.ts";
import { listRoles } from "./roles/loader.ts";
import {
  initWorkbench,
  dispatch,
  redispatch,
  watchUntilDecision,
  approveDispatch,
  resetDispatch,
  rollbackDispatch,
  mergeWorktrees,
  completeWorkbench,
  failWorkbench,
  getWorkbenchStatus,
  askDispatch,
} from "./workflow-lead.ts";

// --- Shared arg parser helpers ---

function requireFlag(args: string[], flag: string): string {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) throw new Error(`Missing required flag: ${flag}`);
  return args[idx + 1];
}

function optionalFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function optionalNumber(args: string[], flag: string): number | undefined {
  const raw = optionalFlag(args, flag);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Invalid number for ${flag}: ${raw}`);
  return n;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function listFlag(args: string[], flag: string): string[] {
  const raw = optionalFlag(args, flag);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Resolve intent from either --intent <text> or --intent-file <path>.
 * Errors if both or neither are provided.
 */
function resolveIntent(args: string[]): string {
  const inline = optionalFlag(args, "--intent");
  const file = optionalFlag(args, "--intent-file");
  if (inline && file) throw new Error("Provide either --intent or --intent-file, not both");
  if (file) return fs.readFileSync(file, "utf-8");
  if (inline) return inline;
  throw new Error("Missing required flag: --intent or --intent-file");
}

/** Collect every occurrence of a repeatable flag, in order. */
function repeatableFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
      i++;
    }
  }
  return values;
}

// --- init ---

export async function cliInit(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra init --intent <desc> --repo <path> [options]");
    console.log("  --intent <desc>              Workbench intent (required, or use --intent-file)");
    console.log("  --intent-file <path>         Read intent from file (mutually exclusive with --intent)");
    console.log("  --repo <path>                Repository path (required)");
    console.log("  --worktree <path>            Use existing worktree");
    console.log("  --timeout-minutes <n>        Default per-dispatch timeout");
    console.log("  --max-retries <n>            Default max retries");
    console.log("  --no-auto-approve            Disable auto-approve");
    console.log("  --human-request <text>       Original human request (broadcast to all dispatches)");
    console.log("  --overall-plan <text>        Lead's plan summary (broadcast to all dispatches)");
    console.log("  --shared-constraint <text>   Workbench-wide constraint (repeatable)");
    console.log("");
    console.log("Note: agent_type is no longer a workbench-level default; the role file's");
    console.log("terminals[] array selects the CLI per dispatch.");
    process.exit(0);
  }

  const sharedConstraints = repeatableFlag(args, "--shared-constraint");
  const result = await initWorkbench({
    intent: resolveIntent(args),
    repoPath: requireFlag(args, "--repo"),
    worktreePath: optionalFlag(args, "--worktree"),
    defaultTimeoutMinutes: optionalNumber(args, "--timeout-minutes"),
    defaultMaxRetries: optionalNumber(args, "--max-retries"),
    autoApprove: !hasFlag(args, "--no-auto-approve"),
    humanRequest: optionalFlag(args, "--human-request"),
    overallPlan: optionalFlag(args, "--overall-plan"),
    sharedConstraints: sharedConstraints.length > 0 ? sharedConstraints : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- dispatch ---

export async function cliDispatch(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra dispatch --workbench <id> --dispatch <id> --role <role> --intent <desc> --repo <path> [options]");
    console.log("  --workbench <id>       Workbench ID (required)");
    console.log("  --dispatch <id>        Dispatch ID (required)");
    console.log("  --role <role>          Registered role name (required, e.g. dev)");
    console.log("  --intent <desc>        Task intent (required, or use --intent-file)");
    console.log("  --intent-file <path>   Read intent from file (mutually exclusive with --intent)");
    console.log("  --repo <path>          Repository path (required)");
    console.log("  --model <name>         Override the role's default model (e.g. opus)");
    console.log("  --context-ref <l:p>    Context ref as label:path (repeatable)");
    console.log("  --feedback <text>      Feedback text (for reset re-dispatch)");
    console.log("  --worktree <path>      Isolated worktree path");
    console.log("  --worktree-branch <b>  Branch name for isolated worktree");
    console.log("  --timeout-minutes <n>  Per-dispatch timeout override");
    console.log("  --max-retries <n>      Max retries override");
    console.log("  --assessment <json>    Lead assessment JSON: {coupling,novelty,mode,rationale?}");
    process.exit(0);
  }

  // Parse context refs: --context-ref "label:path" (can appear multiple times)
  const contextRefs: Array<{ label: string; path: string }> = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--context-ref" && i + 1 < args.length) {
      const raw = args[++i];
      const colonIdx = raw.indexOf(":");
      if (colonIdx > 0) {
        contextRefs.push({ label: raw.slice(0, colonIdx), path: raw.slice(colonIdx + 1) });
      }
    }
  }

  // Parse optional assessment JSON
  const assessmentRaw = optionalFlag(args, "--assessment");
  let assessment: LeadAssessment | undefined;
  if (assessmentRaw) {
    try {
      assessment = JSON.parse(assessmentRaw) as LeadAssessment;
    } catch {
      throw new Error(`Invalid --assessment JSON: ${assessmentRaw}`);
    }
  }

  const result = await dispatch({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    dispatchId: requireFlag(args, "--dispatch"),
    role: requireFlag(args, "--role"),
    intent: resolveIntent(args),
    model: optionalFlag(args, "--model"),
    contextRefs: contextRefs.length > 0 ? contextRefs : undefined,
    feedback: optionalFlag(args, "--feedback"),
    worktreePath: optionalFlag(args, "--worktree"),
    worktreeBranch: optionalFlag(args, "--worktree-branch"),
    timeoutMinutes: optionalNumber(args, "--timeout-minutes"),
    maxRetries: optionalNumber(args, "--max-retries"),
    assessment,
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- ask ---

export async function cliAsk(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra ask --workbench <id> --dispatch <id> --message <text> --repo <path> [options]");
    console.log("  --workbench <id>       Workbench ID (required)");
    console.log("  --dispatch <id>        Dispatch ID to ask (required, dispatch must have completed at least one run)");
    console.log("  --message <text>       Question to send (required)");
    console.log("  --repo <path>          Repository path (required)");
    console.log("  --timeout-ms <n>       Subprocess timeout (default 300000 = 5 min)");
    console.log("");
    console.log("Spins up a one-shot subprocess that resumes the dispatch's session");
    console.log("and asks a follow-up question. Does not touch workbench state.");
    process.exit(0);
  }

  const result = await askDispatch({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    dispatchId: requireFlag(args, "--dispatch"),
    message: requireFlag(args, "--message"),
    timeoutMs: optionalNumber(args, "--timeout-ms"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- list-roles ---

export async function cliListRoles(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra list-roles [--repo <path>] [--cli <claude|codex>]");
    console.log("  --repo <path>          Repository path (defaults to cwd)");
    console.log("  --cli <type>           Filter to roles whose primary terminal targets this CLI");
    console.log("");
    console.log("Output: JSON array of {name, description, terminals[], source, file_path}.");
    process.exit(0);
  }
  const repoPath = optionalFlag(args, "--repo") ?? process.cwd();
  const cliFilter = optionalFlag(args, "--cli") ?? optionalFlag(args, "--agent-type");
  const roles = listRoles(repoPath);
  const filtered = cliFilter
    ? roles.filter((role) => role.terminals[0]?.cli === cliFilter)
    : roles;
  const summaries = filtered.map((role) => ({
    name: role.name,
    description: role.description,
    terminals: role.terminals,
    source: role.source,
    file_path: role.file_path,
  }));
  console.log(JSON.stringify(summaries, null, 2));
}

// --- redispatch ---

export async function cliRedispatch(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra redispatch --workbench <id> --dispatch <id> --repo <path> [--intent <desc>]");
    process.exit(0);
  }

  const result = await redispatch({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    dispatchId: requireFlag(args, "--dispatch"),
    intent: optionalFlag(args, "--intent"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- watch ---

export async function cliWatch(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra watch --workbench <id> --repo <path> [options]");
    console.log("  --workbench <id>       Workbench ID (required)");
    console.log("  --repo <path>          Repository path (required)");
    console.log("  --interval-ms <n>      Poll interval (default 5000)");
    console.log("  --timeout-ms <n>       Max watch duration");
    process.exit(0);
  }

  const result = await watchUntilDecision({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    intervalMs: optionalNumber(args, "--interval-ms"),
    timeoutMs: optionalNumber(args, "--timeout-ms"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- approve ---

export async function cliApprove(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra approve --workbench <id> --dispatch <id> --repo <path>");
    process.exit(0);
  }

  await approveDispatch({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    dispatchId: requireFlag(args, "--dispatch"),
  });
  console.log("Approved.");
}

// --- reset ---

export async function cliReset(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra reset --workbench <id> --dispatch <id> --repo <path> --feedback <text> [--no-rollback]");
    process.exit(0);
  }

  const result = await resetDispatch({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    dispatchId: requireFlag(args, "--dispatch"),
    feedback: requireFlag(args, "--feedback"),
    skipRollback: hasFlag(args, "--no-rollback"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- rollback ---

export async function cliRollback(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra rollback --workbench <id> --dispatch <id> --repo <path>");
    process.exit(0);
  }

  const result = await rollbackDispatch({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    dispatchId: requireFlag(args, "--dispatch"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- merge ---

export async function cliMerge(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra merge --workbench <id> --dispatches <a,b,c> --repo <path> [--target-branch <branch>]");
    process.exit(0);
  }

  const result = await mergeWorktrees({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    sourceDispatchIds: listFlag(args, "--dispatches"),
    targetBranch: optionalFlag(args, "--target-branch"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- complete ---

export async function cliComplete(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra complete --workbench <id> --repo <path> [--summary <text>]");
    process.exit(0);
  }

  await completeWorkbench({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    summary: optionalFlag(args, "--summary"),
  });
  console.log("Workbench completed.");
}

// --- fail ---

export async function cliFail(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra fail --workbench <id> --repo <path> --reason <text>");
    process.exit(0);
  }

  await failWorkbench({
    repoPath: requireFlag(args, "--repo"),
    workbenchId: requireFlag(args, "--workbench"),
    reason: requireFlag(args, "--reason"),
  });
  console.log("Workbench failed.");
}

// --- status ---

export async function cliStatus(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra status --workbench <id> --repo <path>");
    process.exit(0);
  }

  const result = getWorkbenchStatus(
    requireFlag(args, "--repo"),
    requireFlag(args, "--workbench"),
  );
  console.log(JSON.stringify(result, null, 2));
}

// --- ledger ---

export async function cliLedger(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra ledger --workbench <id> --repo <path> [--json]");
    console.log("  Default: one-line scannable view, prefixed with [L]/[W]/[S] actor.");
    console.log("  --json:  raw JSON-per-line for machine consumption.");
    process.exit(0);
  }

  const entries = readLedger(
    path.resolve(requireFlag(args, "--repo")),
    requireFlag(args, "--workbench"),
  );
  const json = hasFlag(args, "--json");
  for (const entry of entries) {
    console.log(json ? JSON.stringify(entry) : formatLedgerLine(entry));
  }
}

function formatLedgerLine(entry: LedgerEntry): string {
  const actorPrefix = entry.actor === "lead" ? "[L]"
    : entry.actor === "worker" ? "[W]"
    : "[S]";
  const time = entry.timestamp.slice(11, 19); // HH:MM:SS from ISO
  const summary = formatEventSummary(entry.event);
  return `${actorPrefix} ${time}  ${summary}`;
}

function formatEventSummary(event: LedgerEvent): string {
  switch (event.type) {
    case "workbench_created":
      return `workbench_created          intent=${event.intent_file}`;
    case "dispatch_started": {
      const assess = event.assessment?.rationale ? ` — ${truncate(event.assessment.rationale, 60)}` : "";
      return `dispatch_started           ${event.dispatch_id} role=${event.role} cause=${event.cause}${assess}`;
    }
    case "dispatch_completed": {
      const stuck = event.stuck_reason ? ` stuck_reason=${event.stuck_reason}` : "";
      return `dispatch_completed         ${event.dispatch_id} outcome=${event.outcome}${stuck} report=${event.report_file}`;
    }
    case "dispatch_failed": {
      const msg = event.failure_message ? ` "${truncate(event.failure_message, 60)}"` : "";
      const ref = event.report_file ? ` report=${event.report_file}` : "";
      return `dispatch_failed            ${event.dispatch_id} code=${event.failure_code}${msg}${ref}`;
    }
    case "dispatch_reset": {
      const fb = event.feedback_file ? ` feedback=${event.feedback_file}` : "";
      return `dispatch_reset             ${event.dispatch_id}${fb}`;
    }
    case "dispatch_approved":
      return `dispatch_approved          ${event.dispatch_id}`;
    case "dispatch_retried": {
      const next = event.next_retry_at ? ` next=${event.next_retry_at.slice(11, 19)}` : "";
      const msg = event.failure_message ? ` "${truncate(event.failure_message, 60)}"` : "";
      return `dispatch_retried           ${event.dispatch_id} cause=${event.cause} attempt=${event.attempt}/${event.max_attempts}${next} code=${event.failure_code}${msg}`;
    }
    case "lead_asked_followup": {
      const fork = event.new_session_id && event.new_session_id !== event.session_id
        ? ` forked=${event.new_session_id.slice(0, 8)}`
        : "";
      return `lead_asked_followup        ${event.dispatch_id} role=${event.role} session=${event.session_id.slice(0, 8)}${fork} "${truncate(event.message_excerpt, 50)}"`;
    }
    case "checkpoint_created": {
      const dirty = event.was_dirty ? " (dirty)" : " (clean)";
      return `checkpoint_created         ${event.dispatch_id} run=${event.run_id} sha=${event.sha.slice(0, 8)}${dirty}`;
    }
    case "checkpoint_rollback":
      return `checkpoint_rollback        ${event.dispatch_id} run=${event.run_id} target=${event.target_sha.slice(0, 8)} cause=${event.cause}`;
    case "merge_attempted":
      return `merge_attempted            sources=[${event.source_dispatches.join(",")}] outcome=${event.outcome}`;
    case "workbench_completed":
      return `workbench_completed        dispatches=${event.total_dispatches} retries=${event.total_retries} duration_ms=${event.total_duration_ms}`;
    case "workbench_failed": {
      const failedDispatch = event.failed_dispatch_id ? ` failed_dispatch=${event.failed_dispatch_id}` : "";
      return `workbench_failed           "${truncate(event.reason, 60)}"${failedDispatch}`;
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
