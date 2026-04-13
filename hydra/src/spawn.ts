import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import {
  ensureProjectTracked,
  projectRescan,
} from "./termcanvas.ts";
import { AGENT_STORE_SCHEMA_VERSION, saveAgent } from "./store.ts";
import { writeRunTask } from "./run-task.ts";
import { dispatchCreateOnly } from "./dispatcher.ts";
import { getRunResultFile } from "./layout.ts";
import {
  AUTO_APPROVE_AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  parseAgentTypeFlag,
  resolveWorkerAgentType,
} from "./agent-selection.ts";
import type { AgentType } from "./assignment/types.ts";

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
  console.log("  --task <desc>        Task description for the sub-agent (required)");
  console.log("  --worker-type <type> Worker agent type");
  console.log(`  --type <type>        Alias for --worker-type (fallback default: ${DEFAULT_AGENT_TYPE})`);
  console.log("  --repo <path>        Path to the git repository (required)");
  console.log("  --worktree <path>    Use an existing worktree (read-only mode)");
  console.log("  --base-branch <br>   Base branch for the new worktree (default: current)");
  console.log("  --no-auto-approve    Disable auto-approve (sub-agents auto-approve by default)");
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

function generateAssignmentId(agentId: string): string {
  return `assignment-${agentId}`;
}

function generateRunId(agentId: string): string {
  return `run-${agentId}`;
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

  if (parsed.autoApprove && !AUTO_APPROVE_AGENT_TYPES.has(workerType)) {
    throw new Error(
      `Agent type "${workerType}" does not support auto-approve. Only ${[...AUTO_APPROVE_AGENT_TYPES].join(", ")} support it. Use --no-auto-approve or switch to a supported agent type.`,
    );
  }

  const agentId = generateAgentId();
  const workflowId = `workflow-${agentId}`;
  const assignmentId = generateAssignmentId(agentId);
  const runId = generateRunId(agentId);
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

  const taskRun = writeRunTask({
    repoPath: repo,
    workbenchId: workflowId,
    assignmentId,
    runId,
    role: "dev",
    agentType: workerType,
    sourceRole: "orchestrator",
    objective: [
      parsed.task,
    ],
    readFiles: [],
    writeTargets: [
      {
        label: "Result JSON",
        path: getRunResultFile(repo, workflowId, assignmentId, runId),
      },
    ],
    decisionRules: [
      "- Complete the requested task honestly.",
      "- Use intent.type=done when the worker is actually done.",
    ],
    acceptanceCriteria: [
      "Complete the requested task",
      "Write a valid result.json file",
    ],
    skills: [],
  });

  const parentTerminalId = process.env.TERMCANVAS_TERMINAL_ID;
  const dispatch = await dispatchCreateOnly({
    workbenchId: workflowId,
    assignmentId,
    runId,
    repoPath: repo,
    worktreePath,
    agentType: workerType,
    taskFile: taskRun.task_file,
    resultFile: taskRun.result_file,
    autoApprove: parsed.autoApprove,
    parentTerminalId,
  });

  saveAgent({
    schema_version: AGENT_STORE_SCHEMA_VERSION,
    id: agentId,
    task: parsed.task,
    type: workerType,
    workflowId,
    assignmentId,
    runId,
    repo,
    terminalId: dispatch.terminalId,
    worktreePath,
    branch,
    baseBranch,
    ownWorktree,
    taskFile: taskRun.task_file,
    resultFile: taskRun.result_file,
    createdAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    agentId,
    workflowId,
    assignmentId,
    runId,
    terminalId: dispatch.terminalId,
    worktreePath,
    branch,
    taskFile: taskRun.task_file,
    resultFile: taskRun.result_file,
  }, null, 2));
}
