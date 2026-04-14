import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadAgent, listAgents, deleteAgent } from "./store.ts";
import { isTermCanvasRunning, terminalDestroy, terminalStatus } from "./termcanvas.ts";
import { AssignmentManager } from "./assignment/manager.ts";
import { loadWorkbench } from "./workflow-store.ts";

export interface CleanupArgs {
  agentId?: string;
  workbenchId?: string;
  repo?: string;
  all: boolean;
  force: boolean;
}

function printCleanupUsage(): never {
  console.log("Usage: hydra cleanup <agentId> [options]");
  console.log("       hydra cleanup --all [options]");
  console.log("       hydra cleanup --workbench <workbenchId> --repo <path> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --all      Clean up all agents");
  console.log("  --workbench Clean up a workbench by ID");
  console.log("  --repo     Repository path for workbench cleanup");
  console.log("  --force    Force cleanup even if agent is still running");
  process.exit(0);
}

export function parseCleanupArgs(args: string[]): CleanupArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printCleanupUsage();
  }

  const consumed = new Set<number>();
  const all = args.includes("--all");
  const force = args.includes("--force");
  const workbenchIdx = args.indexOf("--workbench");
  const workbenchId = workbenchIdx >= 0 && workbenchIdx + 1 < args.length ? args[workbenchIdx + 1] : undefined;
  if (workbenchIdx >= 0) {
    consumed.add(workbenchIdx);
    if (workbenchIdx + 1 < args.length) consumed.add(workbenchIdx + 1);
  }
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 && repoIdx + 1 < args.length ? args[repoIdx + 1] : undefined;
  if (repoIdx >= 0) {
    consumed.add(repoIdx);
    if (repoIdx + 1 < args.length) consumed.add(repoIdx + 1);
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force" || args[i] === "--all") {
      consumed.add(i);
    }
  }
  const agentId = args.find((arg, index) => !arg.startsWith("--") && !consumed.has(index));

  if (workbenchId && !repo) {
    throw new Error("Provide --repo when cleaning up a workbench");
  }

  if (!all && !agentId && !workbenchId) {
    throw new Error("Provide an agent ID, --workbench, or --all");
  }

  return { agentId, workbenchId, repo, all, force };
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
    status === "waiting"
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

function cleanupWorkbench(workbenchId: string, repo: string, force: boolean): void {
  const workflow = loadWorkbench(repo, workbenchId);
  if (!workflow) {
    console.error(`Workbench ${workbenchId} not found.`);
    return;
  }

  const manager = new AssignmentManager(repo, workbenchId);

  if (isTermCanvasRunning()) {
    for (const dispatchId of Object.keys(workflow.dispatches)) {
      const assignment = manager.load(dispatchId);
      const activeRun = assignment?.active_run_id
        ? assignment.runs.find((run) => run.id === assignment.active_run_id)
        : assignment?.runs[assignment.runs.length - 1];
      const terminalId = activeRun?.terminal_id;
      if (!terminalId) continue;

      if (!force) {
        try {
          const { status } = terminalStatus(terminalId);
          if (isLiveTerminalStatus(status)) {
            console.error(
              `Workbench ${workbenchId} has a running terminal (${terminalId}, status: ${status}). Use --force to clean up anyway.`,
            );
            return;
          }
        } catch {
          // terminal already gone
        }
      }

      try {
        terminalDestroy(terminalId);
      } catch {
        // terminal already gone
      }
    }
  }

  if (workflow.own_worktree) {
    try {
      execFileSync("git", buildGitWorktreeRemoveArgs(workflow.worktree_path), {
        cwd: workflow.repo_path,
        stdio: "pipe",
      });
    } catch {
      // worktree already removed
    }

    if (workflow.branch) {
      try {
        execFileSync("git", buildGitBranchDeleteArgs(workflow.branch), {
          cwd: workflow.repo_path,
          stdio: "pipe",
        });
      } catch {
        // branch already removed
      }
    }
  }

  // Workbench state files (.hydra/workbenches/<wid>/) are preserved for
  // audit and historical reference. Only runtime resources (terminals,
  // worktrees, branches) are cleaned up.
  console.log(`Cleaned up resources for workbench ${workbenchId}. State files preserved.`);
}

export async function cleanup(args: string[]): Promise<void> {
  const opts = parseCleanupArgs(args);

  if (opts.workbenchId && opts.repo) {
    cleanupWorkbench(opts.workbenchId, opts.repo, opts.force);
  } else if (opts.all) {
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
