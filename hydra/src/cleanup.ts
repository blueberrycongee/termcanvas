import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadAgent, listAgents, deleteAgent } from "./store.ts";
import { getRuntime } from "./runtime/index.ts";
import { AssignmentManager } from "./assignment/manager.ts";
import { loadWorkbench } from "./workflow-store.ts";
import { ensureLeadCaller } from "./lead-guard.ts";

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

function isHydraManagedDispatchWorkspace(
  repoPath: string,
  worktreePath: string | undefined,
  branch: string | undefined,
): boolean {
  if (!worktreePath || !branch) {
    return false;
  }

  const hydraWorktreesRoot = path.join(path.resolve(repoPath), ".worktrees");
  const resolvedWorktree = path.resolve(worktreePath);
  const relative = path.relative(hydraWorktreesRoot, resolvedWorktree);

  return (
    branch.startsWith("hydra/") &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function cleanupOne(agentId: string, force: boolean): void {
  const record = loadAgent(agentId);
  if (!record) {
    console.error(`Agent ${agentId} not found.`);
    return;
  }

  const runtime = getRuntime();
  if (runtime.isAvailable()) {
    try {
      const { status } = runtime.terminalStatus(record.terminalId);
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
      runtime.terminalDestroy(record.terminalId);
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

export function cleanupWorkbench(workbenchId: string, repo: string, force: boolean): void {
  const workflow = loadWorkbench(repo, workbenchId);
  if (!workflow) {
    console.error(`Workbench ${workbenchId} not found.`);
    return;
  }

  // Every destructive Lead-op must verify single-decider semantics before
  // touching the workbench's terminals, worktree, or branch — a non-Lead
  // caller running `hydra cleanup` could otherwise wipe out another Lead's
  // in-flight state. Tooling/scripts without TERMCANVAS_TERMINAL_ID remain
  // permitted by design (see lead-guard.ts).
  ensureLeadCaller(workflow);

  const manager = new AssignmentManager(repo, workbenchId);
  const dispatchWorktrees = new Set<string>();
  const dispatchBranches = new Set<string>();
  const workflowWorktree = path.resolve(workflow.worktree_path);

  const runtime = getRuntime();
  if (runtime.isAvailable()) {
    for (const dispatchId of Object.keys(workflow.dispatches)) {
      const dispatch = workflow.dispatches[dispatchId];
      if (
        isHydraManagedDispatchWorkspace(
          workflow.repo_path,
          dispatch?.worktree_path,
          dispatch?.worktree_branch,
        ) &&
        dispatch.worktree_path
      ) {
        const resolvedDispatchWorktree = path.resolve(dispatch.worktree_path);
        if (resolvedDispatchWorktree !== workflowWorktree) {
          dispatchWorktrees.add(resolvedDispatchWorktree);
        }
        if (dispatch.worktree_branch) {
          dispatchBranches.add(dispatch.worktree_branch);
        }
      }

      const assignment = manager.load(dispatchId);
      const activeRun = assignment?.active_run_id
        ? assignment.runs.find((run) => run.id === assignment.active_run_id)
        : assignment?.runs[assignment.runs.length - 1];
      const terminalId = activeRun?.terminal_id;
      if (!terminalId) continue;

      if (!force) {
        try {
          const { status } = runtime.terminalStatus(terminalId);
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
        runtime.terminalDestroy(terminalId);
      } catch {
        // terminal already gone
      }
    }
  }

  // Dispatch-scoped worktrees are only safe to remove when Hydra created
  // them under the repo's managed `.worktrees/` area on a `hydra/*` branch.
  // Arbitrary user-provided worktree paths are out of scope for cleanup.
  for (const worktreePath of dispatchWorktrees) {
    try {
      execFileSync("git", buildGitWorktreeRemoveArgs(worktreePath), {
        cwd: workflow.repo_path,
        stdio: "pipe",
      });
    } catch {
      // worktree already removed
    }
  }

  for (const branch of dispatchBranches) {
    try {
      execFileSync("git", buildGitBranchDeleteArgs(branch), {
        cwd: workflow.repo_path,
        stdio: "pipe",
      });
    } catch {
      // branch already removed
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
