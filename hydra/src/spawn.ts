import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { getRuntime } from "./runtime/index.ts";
import { AGENT_STORE_SCHEMA_VERSION, saveAgent } from "./store.ts";
import { writeRunTask } from "./run-task.ts";
import { dispatchCreateOnly } from "./dispatcher.ts";
import { getRunResultFile } from "./layout.ts";
import {
  AUTO_APPROVE_AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  SUPPORTED_AGENT_TYPES,
  parseAgentTypeFlag,
} from "./agent-selection.ts";
import { loadRole, type RoleTerminal } from "./roles/loader.ts";
import type { AgentType } from "./assignment/types.ts";

export interface SpawnArgs {
  task: string;
  role?: string;
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
  console.log("  --role <name>        Role from the registry (default: dev)");
  console.log("  --worker-type <type> Override the role's CLI agent type");
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
    } else if (arg === "--role" && i + 1 < args.length) {
      result.role = args[++i];
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

/**
 * Inject default flags for `hydra scan`. Scan is a convenience alias for
 * `hydra spawn --role janitor` with a default task.
 */
export function injectScanDefaults(args: string[]): string[] {
  const result = [...args];
  if (!result.includes("--role")) {
    result.push("--role", "janitor");
  }
  if (!result.includes("--task")) {
    result.push("--task", "Scan this repository for codebase entropy and produce a health report.");
  }
  return result;
}

export async function spawn(args: string[]): Promise<void> {
  const parsed = parseSpawnArgs(args);
  const repo = path.resolve(parsed.repo);

  // Resolve role from registry. Fail fast if the role doesn't exist.
  const roleName = parsed.role ?? "dev";
  const role = loadRole(roleName, repo);

  // Pick the first terminal whose CLI is a supported agent type.
  const supportedSet = new Set<string>(SUPPORTED_AGENT_TYPES);
  let chosenTerminal: RoleTerminal | undefined;
  for (const terminal of role.terminals) {
    if (supportedSet.has(terminal.cli)) {
      chosenTerminal = terminal;
      break;
    }
    console.error(`hydra: role "${roleName}" terminal cli="${terminal.cli}" is not a supported agent type, trying next`);
  }
  if (!chosenTerminal) {
    throw new Error(
      `Role "${roleName}" has no terminal with a supported CLI (tried: ${role.terminals.map(t => t.cli).join(", ")})`,
    );
  }

  // User --type overrides role terminal; otherwise role terminal wins.
  const workerType = parsed.workerType ?? (chosenTerminal.cli as AgentType);
  const model = chosenTerminal.model;
  const reasoningEffort = chosenTerminal.reasoning_effort;

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

  const runtime = getRuntime();
  runtime.ensureProjectTracked(repo);
  runtime.syncProject(repo);

  const taskRun = writeRunTask({
    repoPath: repo,
    workbenchId: workflowId,
    assignmentId,
    runId,
    role: roleName,
    agentType: workerType,
    model,
    reasoningEffort,
    roleBody: role.body,
    sourceRole: null,
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
      "Use outcome=completed when your work is done.",
      "Use outcome=stuck when you cannot proceed without external help.",
      "Use outcome=error only for technical failures.",
    ],
    acceptanceCriteria: [
      "Complete the requested task",
      "Write a valid result.json file",
    ],
    skills: [],
  });

  const parentTerminalId = runtime.getCurrentLeadId();
  const dispatch = await dispatchCreateOnly({
    workbenchId: workflowId,
    assignmentId,
    runId,
    repoPath: repo,
    worktreePath,
    agentType: workerType,
    model,
    reasoningEffort,
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
    role: roleName,
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
    role: roleName,
    terminalId: dispatch.terminalId,
    worktreePath,
    branch,
    taskFile: taskRun.task_file,
    resultFile: taskRun.result_file,
  }, null, 2));
}
