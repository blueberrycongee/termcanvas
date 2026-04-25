import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ProjectScanner } from "../electron/project-scanner.ts";
import { buildGitWorktreeRemoveArgs } from "../hydra/src/cleanup.ts";
import {
  buildGitWorktreeAddArgs,
  validateWorktreePath,
} from "../hydra/src/spawn.ts";
import type { ProjectStore } from "./project-store.ts";
import { ensureProjectTracked } from "./project-sync.ts";

export interface WorktreeInfo {
  path: string;
  branch: string;
  isPrimary: boolean;
}

export interface WorktreeControl {
  list(repoPath: string): WorktreeInfo[];
  create(input: {
    repoPath: string;
    branch: string;
    worktreePath?: string;
    baseBranch?: string;
  }): {
    path: string;
    branch: string;
    base_branch: string;
    worktrees: WorktreeInfo[];
  };
  remove(input: {
    repoPath: string;
    worktreePath: string;
    force?: boolean;
  }): {
    ok: true;
    path: string;
    worktrees: WorktreeInfo[];
  };
}

function getCurrentBranch(repoPath: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "main";
  }
}

function defaultWorktreePath(repoPath: string, branch: string): string {
  return path.join(
    repoPath,
    ".worktrees",
    branch.replace(/[\\/]/g, "-"),
  );
}

export function createWorktreeControl(input: {
  projectStore: ProjectStore;
  projectScanner: ProjectScanner;
  onMutation?: () => void;
}): WorktreeControl {
  return {
    list(repoPath) {
      const repo = path.resolve(repoPath);
      return input.projectScanner.listWorktrees(repo);
    },
    create({ repoPath, branch, worktreePath, baseBranch }) {
      const repo = path.resolve(repoPath);
      const resolvedWorktree = validateWorktreePath(
        repo,
        worktreePath ? path.resolve(worktreePath) : defaultWorktreePath(repo, branch),
      );
      const base = baseBranch?.trim() || getCurrentBranch(repo);
      execFileSync("git", buildGitWorktreeAddArgs(branch, resolvedWorktree, base), {
        cwd: repo,
        encoding: "utf-8",
      });

      const tracked = ensureProjectTracked({
        projectStore: input.projectStore,
        projectScanner: input.projectScanner,
        repoPath: repo,
        onMutation: input.onMutation,
      });

      return {
        path: resolvedWorktree,
        branch,
        base_branch: base,
        worktrees: tracked.project.worktrees.map((worktree) => ({
          path: worktree.path,
          branch: worktree.name,
          isPrimary: worktree.path === tracked.project.path,
        })),
      };
    },
    remove({ repoPath, worktreePath, force }) {
      const repo = path.resolve(repoPath);
      const resolvedWorktree = validateWorktreePath(repo, worktreePath);
      const args = force
        ? buildGitWorktreeRemoveArgs(resolvedWorktree)
        : ["worktree", "remove", resolvedWorktree];
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf-8",
      });

      const tracked = ensureProjectTracked({
        projectStore: input.projectStore,
        projectScanner: input.projectScanner,
        repoPath: repo,
        onMutation: input.onMutation,
      });

      return {
        ok: true,
        path: resolvedWorktree,
        worktrees: tracked.project.worktrees.map((worktree) => ({
          path: worktree.path,
          branch: worktree.name,
          isPrimary: worktree.path === tracked.project.path,
        })),
      };
    },
  };
}
