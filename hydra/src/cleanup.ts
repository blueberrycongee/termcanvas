import { execFileSync } from "node:child_process";
import { loadAgent, listAgents, deleteAgent } from "./store.ts";
import { isTermCanvasRunning, terminalDestroy, terminalStatus } from "./termcanvas.ts";

export interface CleanupArgs {
  agentId?: string;
  all: boolean;
  force: boolean;
}

export function parseCleanupArgs(args: string[]): CleanupArgs {
  const all = args.includes("--all");
  const force = args.includes("--force");
  const agentId = args.find((a) => !a.startsWith("--"));

  if (!all && !agentId) {
    throw new Error("Provide an agent ID or --all");
  }

  return { agentId, all, force };
}

export function buildGitWorktreeRemoveArgs(worktreePath: string): string[] {
  return ["worktree", "remove", worktreePath, "--force"];
}

export function buildGitBranchDeleteArgs(branch: string): string[] {
  return ["branch", "-D", branch];
}

export function isLiveTerminalStatus(status: string): boolean {
  return (
    status === "running" ||
    status === "active" ||
    status === "waiting" ||
    status === "completed"
  );
}

function cleanupOne(agentId: string, force: boolean): void {
  const record = loadAgent(agentId);
  if (!record) {
    console.error(`Agent ${agentId} not found.`);
    return;
  }

  if (isTermCanvasRunning()) {
    try {
      const { status } = terminalStatus(record.terminalId);
      if (isLiveTerminalStatus(status) && !force) {
        console.error(
          `Agent ${agentId} is still running (status: ${status}). Use --force to clean up anyway.`,
        );
        return;
      }
    } catch {
      // Terminal may already be gone
    }

    try {
      terminalDestroy(record.terminalId);
    } catch {
      // Already destroyed
    }
  }

  if (record.ownWorktree) {
    try {
      execFileSync("git", buildGitWorktreeRemoveArgs(record.worktreePath), {
        cwd: record.repo,
        stdio: "pipe",
      });
    } catch {
      // Already removed
    }

    if (record.branch) {
      try {
        execFileSync("git", buildGitBranchDeleteArgs(record.branch), {
          cwd: record.repo,
          stdio: "pipe",
        });
      } catch {
        // Already deleted
      }
    }
  }

  deleteAgent(agentId);
  console.log(`Cleaned up ${agentId}.`);
}

export async function cleanup(args: string[]): Promise<void> {
  const opts = parseCleanupArgs(args);

  if (opts.all) {
    const agents = listAgents();
    if (agents.length === 0) {
      console.log("No agents to clean up.");
      return;
    }
    for (const a of agents) {
      cleanupOne(a.id, opts.force);
    }
  } else if (opts.agentId) {
    cleanupOne(opts.agentId, opts.force);
  }
}
