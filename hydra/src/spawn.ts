import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import {
  ensureProjectTracked,
  findProjectByPath,
  projectRescan,
} from "./termcanvas.ts";
import { saveAgent } from "./store.ts";
import { buildTaskPackageContext, writeTaskPackage } from "./task-package.ts";
import { dispatchCreateOnly } from "./dispatcher.ts";
import {
  AUTO_APPROVE_AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  parseAgentTypeFlag,
  resolveCurrentAgentType,
  resolveWorkerAgentType,
} from "./agent-selection.ts";
import type { AgentType } from "./handoff/types.ts";

export interface SpawnArgs {
  task: string;
  workerType?: AgentType;
  repo: string;
  worktree?: string;
  baseBranch?: string;
  autoApprove?: boolean;
}

function printSpawnUsage(): never {
  console.log("Usage: hydra spawn [options]");
  console.log("");
  console.log("Options:");
  console.log("  --task <desc>       Task description for the sub-agent (required)");
  console.log("  --worker-type <type> Worker agent type");
  console.log(`  --type <type>       Alias for --worker-type (fallback default: ${DEFAULT_AGENT_TYPE})`);
  console.log("  --repo <path>       Path to the git repository (required)");
  console.log("  --worktree <path>   Use an existing worktree (read-only mode)");
  console.log("  --base-branch <br>  Base branch for the new worktree (default: current)");
  console.log("  --no-auto-approve   Disable auto-approve (sub-agents auto-approve by default)");
  process.exit(0);
}

export function parseSpawnArgs(args: string[]): SpawnArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printSpawnUsage();
  }

  const result: Partial<SpawnArgs> = {
    autoApprove: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--task" && i + 1 < args.length) {
      result.task = args[++i];
    } else if ((arg === "--worker-type" || arg === "--type") && i + 1 < args.length) {
      result.workerType = parseAgentTypeFlag(arg, args[++i]);
    } else if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--worktree" && i + 1 < args.length) {
      result.worktree = args[++i];
    } else if (arg === "--base-branch" && i + 1 < args.length) {
      result.baseBranch = args[++i];
    } else if (arg === "--auto-approve") {
      result.autoApprove = true;
    } else if (arg === "--no-auto-approve") {
      result.autoApprove = false;
    }
  }

  if (!result.task) throw new Error("Missing required flag: --task");
  if (!result.repo) throw new Error("Missing required flag: --repo");

  return result as SpawnArgs;
}

export function generateAgentId(): string {
  const hex = crypto.randomBytes(8).toString("hex");
  return `hydra-${hex}`;
}

function getCurrentBranch(repoPath: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "main";
  }
}

export function buildGitWorktreeAddArgs(
  branch: string,
  worktreePath: string,
  baseBranch: string,
): string[] {
  return ["worktree", "add", "-b", branch, worktreePath, baseBranch];
}

export function validateWorktreePath(repoPath: string, worktreePath: string): string {
  const resolvedRepo = path.resolve(repoPath);
  const resolvedWorktree = path.resolve(worktreePath);
  const relative = path.relative(resolvedRepo, resolvedWorktree);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Worktree must be inside the repo: ${resolvedWorktree} is not under ${resolvedRepo}`,
    );
  }

  return resolvedWorktree;
}

export async function spawn(args: string[]): Promise<void> {
  const parsed = parseSpawnArgs(args);
  const repo = path.resolve(parsed.repo);
  const workerType = resolveWorkerAgentType(parsed, process.env);
  const parentAgentType = resolveCurrentAgentType(process.env) ?? workerType;

  if (parsed.autoApprove && !AUTO_APPROVE_AGENT_TYPES.has(workerType)) {
    throw new Error(
      `Agent type "${workerType}" does not support auto-approve. Only ${[...AUTO_APPROVE_AGENT_TYPES].join(", ")} support it. Use --no-auto-approve or switch to a supported agent type.`,
    );
  }

  const agentId = generateAgentId();
  const workflowId = `workflow-${agentId}`;
  const handoffId = `handoff-${agentId}`;
  const baseBranch = parsed.baseBranch ?? getCurrentBranch(repo);

  let worktreePath: string;
  let branch: string | null;
  let ownWorktree: boolean;

  if (parsed.worktree) {
    worktreePath = validateWorktreePath(repo, parsed.worktree);
    branch = null;
    ownWorktree = false;
  } else {
    branch = `hydra/${agentId}`;
    worktreePath = path.join(repo, ".worktrees", agentId);
    execFileSync("git", buildGitWorktreeAddArgs(branch, worktreePath, baseBranch), {
      cwd: repo,
      encoding: "utf-8",
    });
    ownWorktree = true;
  }

  const project = ensureProjectTracked(repo);
  projectRescan(project.id);

  const taskPackage = buildTaskPackageContext({
    workspaceRoot: worktreePath,
    workflowId,
    handoffId,
    from: {
      role: "planner",
      agent_type: parentAgentType,
      agent_id: process.env.TERMCANVAS_TERMINAL_ID ?? "hydra-spawn",
    },
    to: {
      role: "implementer",
      agent_type: workerType,
      agent_id: null,
    },
    task: {
      type: parsed.worktree ? "read-only-task" : "code-change-task",
      title: parsed.task.slice(0, 80),
      description: parsed.task,
      acceptance_criteria: [
        "Complete the requested task",
        "Write a valid result.json file",
        "Write the done marker after result.json is complete",
      ],
    },
    context: {
      files: [],
      previous_handoffs: [],
      shared_state: {
        worktree_path: worktreePath,
        branch,
        base_branch: baseBranch,
      },
    },
  });
  const artifacts = writeTaskPackage(taskPackage.contract);

  const parentTerminalId = process.env.TERMCANVAS_TERMINAL_ID;
  const dispatch = await dispatchCreateOnly({
    workflowId,
    handoffId,
    repoPath: repo,
    worktreePath,
    agentType: workerType,
    taskFile: artifacts.task_file,
    doneFile: artifacts.done_file,
    resultFile: artifacts.result_file,
    autoApprove: parsed.autoApprove,
    parentTerminalId,
  });

  // Cleanup is manual via `hydra cleanup <agentId>` or Cmd+D in the app.
  saveAgent({
    id: agentId,
    task: parsed.task,
    type: workerType,
    workflowId,
    handoffId,
    repo,
    terminalId: dispatch.terminalId,
    worktreePath,
    branch,
    baseBranch,
    ownWorktree,
    taskFile: artifacts.task_file,
    handoffFile: artifacts.handoff_file,
    resultFile: artifacts.result_file,
    doneFile: artifacts.done_file,
    createdAt: new Date().toISOString(),
  });

  const result = {
    agentId,
    workflowId,
    handoffId,
    terminalId: dispatch.terminalId,
    worktreePath,
    branch,
    handoffFile: artifacts.handoff_file,
    taskFile: artifacts.task_file,
    resultFile: artifacts.result_file,
    doneFile: artifacts.done_file,
  };
  console.log(JSON.stringify(result, null, 2));
}
