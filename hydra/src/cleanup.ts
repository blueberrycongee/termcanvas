import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadAgent, listAgents, deleteAgent } from "./store.ts";
import { isTermCanvasRunning, terminalDestroy, terminalStatus } from "./termcanvas.ts";
import { AssignmentManager } from "./assignment/manager.ts";
import { deleteWorkflow, loadWorkflow } from "./workflow-store.ts";

export interface CleanupArgs {
  agentId?: string;
  workflowId?: string;
  repo?: string;
  all: boolean;
  force: boolean;
}

function printCleanupUsage(): never {
  console.log("Usage: hydra cleanup <agentId> [options]");
  console.log("       hydra cleanup --all [options]");
  console.log("       hydra cleanup --workflow <workflowId> --repo <path> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --all      Clean up all agents");
  console.log("  --workflow Clean up a workflow by ID");
  console.log("  --repo     Repository path for workflow cleanup");
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
  const workflowIdx = args.indexOf("--workflow");
  const workflowId = workflowIdx >= 0 && workflowIdx + 1 < args.length ? args[workflowIdx + 1] : undefined;
  if (workflowIdx >= 0) {
    consumed.add(workflowIdx);
    if (workflowIdx + 1 < args.length) consumed.add(workflowIdx + 1);
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

  if (workflowId && !repo) {
    throw new Error("Provide --repo when cleaning up a workflow");
  }

  if (!all && !agentId && !workflowId) {
    throw new Error("Provide an agent ID, --workflow, or --all");
  }

  return { agentId, workflowId, repo, all, force };
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

function cleanupWorkflow(workflowId: string, repo: string, force: boolean): void {
  const workflow = loadWorkflow(repo, workflowId);
  if (!workflow) {
    console.error(`Workflow ${workflowId} not found.`);
    return;
  }

  const manager = new AssignmentManager(repo, workflowId);

  if (isTermCanvasRunning()) {
    for (const assignmentId of workflow.assignment_ids) {
      const assignment = manager.load(assignmentId);
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
              `Workflow ${workflowId} has a running terminal (${terminalId}, status: ${status}). Use --force to clean up anyway.`,
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

  deleteWorkflow(repo, workflowId);
  console.log(`Cleaned up workflow ${workflowId}.`);
}

export async function cleanup(args: string[]): Promise<void> {
  const opts = parseCleanupArgs(args);

  if (opts.workflowId && opts.repo) {
    cleanupWorkflow(opts.workflowId, opts.repo, opts.force);
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
