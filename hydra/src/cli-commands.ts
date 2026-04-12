import path from "node:path";
import { readLedger, type LeadAssessment, type LedgerEntry, type LedgerEvent } from "./ledger.ts";
import { listRoles } from "./roles/loader.ts";
import {
  initWorkflow,
  dispatchNode,
  redispatchNode,
  watchUntilDecision,
  approveNode,
  resetNode,
  mergeWorktrees,
  completeWorkflow,
  failWorkflow,
  getWorkflowStatus,
  askNode,
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
    console.log("  --intent <desc>              Workflow intent (required)");
    console.log("  --repo <path>                Repository path (required)");
    console.log("  --worktree <path>            Use existing worktree");
    console.log("  --timeout-minutes <n>        Default per-node timeout");
    console.log("  --max-retries <n>            Default max retries");
    console.log("  --no-auto-approve            Disable auto-approve");
    console.log("  --human-request <text>       Original human request (broadcast to all nodes)");
    console.log("  --overall-plan <text>        Lead's plan summary (broadcast to all nodes)");
    console.log("  --shared-constraint <text>   Workflow-wide constraint (repeatable)");
    console.log("");
    console.log("Note: agent_type is no longer a workflow-level default; the role file's");
    console.log("terminals[] array selects the CLI per dispatch.");
    process.exit(0);
  }

  const sharedConstraints = repeatableFlag(args, "--shared-constraint");
  const result = await initWorkflow({
    intent: requireFlag(args, "--intent"),
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
    console.log("Usage: hydra dispatch --workflow <id> --node <id> --role <role> --intent <desc> --repo <path> [options]");
    console.log("  --workflow <id>         Workflow ID (required)");
    console.log("  --node <id>            Node ID (required)");
    console.log("  --role <role>          Registered role name (required, e.g. dev)");
    console.log("  --intent <desc>        Task intent (required)");
    console.log("  --repo <path>          Repository path (required)");
    console.log("  --depends-on <a,b>     Comma-separated dependency node IDs");
    console.log("  --model <name>         Override the role's default model (e.g. opus)");
    console.log("  --context-ref <l:p>    Context ref as label:path (repeatable)");
    console.log("  --feedback <text>      Feedback text (for reset re-dispatch)");
    console.log("  --worktree <path>      Isolated worktree path");
    console.log("  --worktree-branch <b>  Branch name for isolated worktree");
    console.log("  --timeout-minutes <n>  Per-node timeout override");
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

  const result = await dispatchNode({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    nodeId: requireFlag(args, "--node"),
    role: requireFlag(args, "--role"),
    intent: requireFlag(args, "--intent"),
    dependsOn: listFlag(args, "--depends-on"),
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
    console.log("Usage: hydra ask --workflow <id> --node <id> --message <text> --repo <path> [options]");
    console.log("  --workflow <id>        Workflow ID (required)");
    console.log("  --node <id>            Node ID to ask (required, node must have completed at least one run)");
    console.log("  --message <text>       Question to send (required)");
    console.log("  --repo <path>          Repository path (required)");
    console.log("  --timeout-ms <n>       Subprocess timeout (default 300000 = 5 min)");
    console.log("");
    console.log("Spins up a one-shot subprocess that resumes the node's session");
    console.log("and asks a follow-up question. Does not touch workflow state.");
    process.exit(0);
  }

  const result = await askNode({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    nodeId: requireFlag(args, "--node"),
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
    console.log("Output: JSON array of {name, description, terminals[], source}.");
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
  }));
  console.log(JSON.stringify(summaries, null, 2));
}

// --- redispatch ---

export async function cliRedispatch(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra redispatch --workflow <id> --node <id> --repo <path> [--intent <desc>]");
    process.exit(0);
  }

  const result = await redispatchNode({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    nodeId: requireFlag(args, "--node"),
    intent: optionalFlag(args, "--intent"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- watch ---

export async function cliWatch(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra watch --workflow <id> --repo <path> [options]");
    console.log("  --workflow <id>        Workflow ID (required)");
    console.log("  --repo <path>          Repository path (required)");
    console.log("  --interval-ms <n>      Poll interval (default 5000)");
    console.log("  --timeout-ms <n>       Max watch duration");
    process.exit(0);
  }

  const result = await watchUntilDecision({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    intervalMs: optionalNumber(args, "--interval-ms"),
    timeoutMs: optionalNumber(args, "--timeout-ms"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- approve ---

export async function cliApprove(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra approve --workflow <id> --node <id> --repo <path>");
    process.exit(0);
  }

  await approveNode({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    nodeId: requireFlag(args, "--node"),
  });
  console.log("Approved.");
}

// --- reset ---

export async function cliReset(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra reset --workflow <id> --node <id> --repo <path> [--feedback <text>] [--no-cascade]");
    process.exit(0);
  }

  const result = await resetNode({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    nodeId: requireFlag(args, "--node"),
    feedback: optionalFlag(args, "--feedback"),
    cascade: !hasFlag(args, "--no-cascade"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- merge ---

export async function cliMerge(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra merge --workflow <id> --nodes <a,b,c> --repo <path> [--target-branch <branch>]");
    process.exit(0);
  }

  const result = await mergeWorktrees({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    sourceNodeIds: listFlag(args, "--nodes"),
    targetBranch: optionalFlag(args, "--target-branch"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- complete ---

export async function cliComplete(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra complete --workflow <id> --repo <path> [--summary <text>]");
    process.exit(0);
  }

  await completeWorkflow({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    summary: optionalFlag(args, "--summary"),
  });
  console.log("Workflow completed.");
}

// --- fail ---

export async function cliFail(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra fail --workflow <id> --repo <path> --reason <text>");
    process.exit(0);
  }

  await failWorkflow({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    reason: requireFlag(args, "--reason"),
  });
  console.log("Workflow failed.");
}

// --- status ---

export async function cliStatus(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra status --workflow <id> --repo <path>");
    process.exit(0);
  }

  const result = getWorkflowStatus(
    requireFlag(args, "--repo"),
    requireFlag(args, "--workflow"),
  );
  console.log(JSON.stringify(result, null, 2));
}

// --- ledger ---

export async function cliLedger(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra ledger --workflow <id> --repo <path> [--json]");
    console.log("  Default: one-line scannable view, prefixed with [L]/[W]/[S] actor.");
    console.log("  --json:  raw JSON-per-line for machine consumption.");
    process.exit(0);
  }

  const entries = readLedger(
    path.resolve(requireFlag(args, "--repo")),
    requireFlag(args, "--workflow"),
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
    case "workflow_created":
      return `workflow_created           intent=${event.intent_file}`;
    case "node_dispatched": {
      const assess = event.assessment?.rationale ? ` — ${truncate(event.assessment.rationale, 60)}` : "";
      return `node_dispatched            ${event.node_id} role=${event.role} cause=${event.cause}${assess}`;
    }
    case "node_completed": {
      const stuck = event.stuck_reason ? ` stuck_reason=${event.stuck_reason}` : "";
      return `node_completed             ${event.node_id} outcome=${event.outcome}${stuck} report=${event.report_file}`;
    }
    case "node_failed": {
      const msg = event.failure_message ? ` "${truncate(event.failure_message, 60)}"` : "";
      const ref = event.report_file ? ` report=${event.report_file}` : "";
      return `node_failed                ${event.node_id} code=${event.failure_code}${msg}${ref}`;
    }
    case "node_reset": {
      const cascade = event.cascade_targets.length > 0 ? ` cascade=[${event.cascade_targets.join(",")}]` : "";
      const fb = event.feedback_file ? ` feedback=${event.feedback_file}` : "";
      return `node_reset                 ${event.node_id}${cascade}${fb}`;
    }
    case "node_approved":
      return `node_approved              ${event.node_id}`;
    case "assignment_retried": {
      const next = event.next_retry_at ? ` next=${event.next_retry_at.slice(11, 19)}` : "";
      const msg = event.failure_message ? ` "${truncate(event.failure_message, 60)}"` : "";
      return `assignment_retried         ${event.node_id} cause=${event.cause} attempt=${event.attempt}/${event.max_attempts}${next} code=${event.failure_code}${msg}`;
    }
    case "node_promoted_eligible":
      return `node_promoted_eligible     ${event.node_id} triggered_by=[${event.triggered_by.join(",")}]`;
    case "lead_asked_followup": {
      const fork = event.new_session_id && event.new_session_id !== event.session_id
        ? ` forked=${event.new_session_id.slice(0, 8)}`
        : "";
      return `lead_asked_followup        ${event.node_id} role=${event.role} session=${event.session_id.slice(0, 8)}${fork} "${truncate(event.message_excerpt, 50)}"`;
    }
    case "merge_attempted":
      return `merge_attempted            sources=[${event.source_nodes.join(",")}] outcome=${event.outcome}`;
    case "workflow_completed":
      return `workflow_completed         nodes=${event.total_nodes} retries=${event.total_retries} duration_ms=${event.total_duration_ms}`;
    case "workflow_failed": {
      const failedNode = event.failed_node_id ? ` failed_node=${event.failed_node_id}` : "";
      return `workflow_failed            "${truncate(event.reason, 60)}"${failedNode}`;
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
