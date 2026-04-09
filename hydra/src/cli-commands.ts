import path from "node:path";
import { parseAgentTypeFlag } from "./agent-selection.ts";
import { readLedger } from "./ledger.ts";
import {
  initWorkflow,
  dispatchNode,
  watchUntilDecision,
  approveNode,
  resetNode,
  mergeWorktrees,
  completeWorkflow,
  failWorkflow,
  getWorkflowStatus,
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

// --- init ---

export async function cliInit(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra init --intent <desc> --repo <path> [options]");
    console.log("  --intent <desc>         Workflow intent (required)");
    console.log("  --repo <path>           Repository path (required)");
    console.log("  --worktree <path>       Use existing worktree");
    console.log("  --agent-type <type>     Default agent type");
    console.log("  --timeout-minutes <n>   Default per-node timeout");
    console.log("  --max-retries <n>       Default max retries");
    console.log("  --no-auto-approve       Disable auto-approve");
    process.exit(0);
  }

  const result = await initWorkflow({
    intent: requireFlag(args, "--intent"),
    repoPath: requireFlag(args, "--repo"),
    worktreePath: optionalFlag(args, "--worktree"),
    defaultAgentType: optionalFlag(args, "--agent-type")
      ? parseAgentTypeFlag("--agent-type", optionalFlag(args, "--agent-type")) : undefined,
    defaultTimeoutMinutes: optionalNumber(args, "--timeout-minutes"),
    defaultMaxRetries: optionalNumber(args, "--max-retries"),
    autoApprove: !hasFlag(args, "--no-auto-approve"),
  });
  console.log(JSON.stringify(result, null, 2));
}

// --- dispatch ---

export async function cliDispatch(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log("Usage: hydra dispatch --workflow <id> --node <id> --role <role> --intent <desc> --repo <path> [options]");
    console.log("  --workflow <id>         Workflow ID (required)");
    console.log("  --node <id>            Node ID (required)");
    console.log("  --role <role>          Agent role (required)");
    console.log("  --intent <desc>        Task intent (required)");
    console.log("  --repo <path>          Repository path (required)");
    console.log("  --depends-on <a,b>     Comma-separated dependency node IDs");
    console.log("  --agent-type <type>    Override agent type");
    console.log("  --context-ref <l:p>    Context ref as label:path (repeatable)");
    console.log("  --feedback <text>      Feedback text (for reset re-dispatch)");
    console.log("  --worktree <path>      Isolated worktree path");
    console.log("  --worktree-branch <b>  Branch name for isolated worktree");
    console.log("  --timeout-minutes <n>  Per-node timeout override");
    console.log("  --max-retries <n>      Max retries override");
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

  const result = await dispatchNode({
    repoPath: requireFlag(args, "--repo"),
    workflowId: requireFlag(args, "--workflow"),
    nodeId: requireFlag(args, "--node"),
    role: requireFlag(args, "--role"),
    intent: requireFlag(args, "--intent"),
    dependsOn: listFlag(args, "--depends-on"),
    agentType: optionalFlag(args, "--agent-type")
      ? parseAgentTypeFlag("--agent-type", optionalFlag(args, "--agent-type")) : undefined,
    contextRefs: contextRefs.length > 0 ? contextRefs : undefined,
    feedback: optionalFlag(args, "--feedback"),
    worktreePath: optionalFlag(args, "--worktree"),
    worktreeBranch: optionalFlag(args, "--worktree-branch"),
    timeoutMinutes: optionalNumber(args, "--timeout-minutes"),
    maxRetries: optionalNumber(args, "--max-retries"),
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
    console.log("Usage: hydra ledger --workflow <id> --repo <path>");
    process.exit(0);
  }

  const entries = readLedger(
    path.resolve(requireFlag(args, "--repo")),
    requireFlag(args, "--workflow"),
  );
  for (const entry of entries) {
    console.log(JSON.stringify(entry));
  }
}
