import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import {
  isTermCanvasRunning,
  findProjectByPath,
  projectRescan,
  terminalCreate,
  terminalStatus,
  terminalInput,
} from "./termcanvas.ts";
import { saveAgent } from "./store.ts";

export interface SpawnArgs {
  task: string;
  type: string;
  repo: string;
  worktree?: string;
  baseBranch?: string;
}

export function parseSpawnArgs(args: string[]): SpawnArgs {
  const result: Partial<SpawnArgs> = { type: "claude" };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--task" && i + 1 < args.length) {
      result.task = args[++i];
    } else if (arg === "--type" && i + 1 < args.length) {
      result.type = args[++i];
    } else if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--worktree" && i + 1 < args.length) {
      result.worktree = args[++i];
    } else if (arg === "--base-branch" && i + 1 < args.length) {
      result.baseBranch = args[++i];
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const READY_STATUSES = new Set(["waiting", "completed", "success", "error"]);

export function buildGitWorktreeAddArgs(
  branch: string,
  worktreePath: string,
  baseBranch: string,
): string[] {
  return ["worktree", "add", "-b", branch, worktreePath, baseBranch];
}

export async function spawn(args: string[]): Promise<void> {
  const parsed = parseSpawnArgs(args);
  const repo = path.resolve(parsed.repo);

  // Validate TermCanvas is running
  if (!isTermCanvasRunning()) {
    throw new Error("TermCanvas is not running");
  }

  // Validate repo is on canvas
  const project = findProjectByPath(repo);
  if (!project) {
    throw new Error(`Repo not found on TermCanvas canvas: ${repo}`);
  }

  const agentId = generateAgentId();
  const baseBranch = parsed.baseBranch ?? getCurrentBranch(repo);

  let worktreePath: string;
  let branch: string | null;
  let ownWorktree: boolean;

  if (parsed.worktree) {
    // Use existing worktree
    worktreePath = path.resolve(parsed.worktree);
    branch = null;
    ownWorktree = false;
  } else {
    // Create new worktree
    branch = `hydra/${agentId}`;
    worktreePath = path.join(repo, ".worktrees", agentId);
    execFileSync("git", buildGitWorktreeAddArgs(branch, worktreePath, baseBranch), {
      cwd: repo,
      encoding: "utf-8",
    });
    ownWorktree = true;

    // Trigger TermCanvas to detect new worktree
    projectRescan(project.id);
  }

  // Create terminal
  const terminal = terminalCreate(worktreePath, parsed.type);

  // Poll until PTY ready (max 30s)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = terminalStatus(terminal.id);
    if (READY_STATUSES.has(status.status)) break;
    await sleep(1_000);
  }

  // Send task
  terminalInput(terminal.id, parsed.task + "\n");

  // Save agent record
  saveAgent({
    id: agentId,
    task: parsed.task,
    type: parsed.type,
    repo,
    terminalId: terminal.id,
    worktreePath,
    branch,
    baseBranch,
    ownWorktree,
    createdAt: new Date().toISOString(),
  });

  // Output result
  const result = {
    agentId,
    terminalId: terminal.id,
    worktreePath,
    branch,
  };
  console.log(JSON.stringify(result, null, 2));
}
