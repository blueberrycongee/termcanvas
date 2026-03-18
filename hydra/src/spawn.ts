import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  isTermCanvasRunning,
  findProjectByPath,
  projectRescan,
  terminalCreate,
} from "./termcanvas.ts";
import { saveAgent } from "./store.ts";
import { buildTaskFileContent, buildSpawnInput } from "./prompt.ts";

export interface SpawnArgs {
  task: string;
  type: string;
  repo: string;
  worktree?: string;
  baseBranch?: string;
  autoApprove?: boolean;
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
    } else if (arg === "--auto-approve") {
      result.autoApprove = true;
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

export function spawn(args: string[]): void {
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
    worktreePath = validateWorktreePath(repo, parsed.worktree);
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

  // Write task file to worktree (agent ID in filename avoids collisions when
  // multiple agents share the same worktree for read-only tasks)
  const taskFile = `.hydra-task-${agentId}.md`;
  const resultFile = `.hydra-result-${agentId}.md`;
  fs.writeFileSync(
    path.join(worktreePath, taskFile),
    buildTaskFileContent({ task: parsed.task, worktreePath, branch, baseBranch, resultFile }),
  );

  // Create terminal with initial prompt as CLI argument (no PTY injection needed)
  const prompt = buildSpawnInput(parsed.task, taskFile);
  const parentTerminalId = process.env.TERMCANVAS_TERMINAL_ID;
  const terminal = terminalCreate(worktreePath, parsed.type, prompt, parsed.autoApprove, parentTerminalId);

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

  // Output result (resultFile tells the parent where to read the outcome)
  const result = {
    agentId,
    terminalId: terminal.id,
    worktreePath,
    branch,
    resultFile: `${worktreePath}/${resultFile}`,
  };
  console.log(JSON.stringify(result, null, 2));
}
