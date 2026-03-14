import { execSync } from "child_process";
import path from "path";

interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

interface ProjectInfo {
  name: string;
  path: string;
  worktrees: WorktreeInfo[];
}

export class ProjectScanner {
  scan(dirPath: string): ProjectInfo | null {
    try {
      // Verify it's a git repo
      execSync("git rev-parse --git-dir", { cwd: dirPath, stdio: "pipe" });
    } catch {
      return null;
    }

    const name = path.basename(dirPath);
    const worktrees = this.listWorktrees(dirPath);

    return { name, path: dirPath, worktrees };
  }

  private listWorktrees(dirPath: string): WorktreeInfo[] {
    try {
      const output = execSync("git worktree list --porcelain", {
        cwd: dirPath,
        encoding: "utf-8",
      });

      const worktrees: WorktreeInfo[] = [];
      let current: Partial<WorktreeInfo> = {};

      for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
          current.path = line.slice("worktree ".length);
        } else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length);
          current.branch = ref.replace("refs/heads/", "");
        } else if (line === "bare") {
          current.branch = "(bare)";
        } else if (line === "") {
          if (current.path) {
            worktrees.push({
              path: current.path,
              branch: current.branch ?? "(detached)",
              isMain: worktrees.length === 0,
            });
          }
          current = {};
        }
      }

      return worktrees;
    } catch {
      // If worktree list fails, return the directory itself
      return [
        {
          path: dirPath,
          branch: this.getCurrentBranch(dirPath),
          isMain: true,
        },
      ];
    }
  }

  private getCurrentBranch(dirPath: string): string {
    try {
      return execSync("git branch --show-current", {
        cwd: dirPath,
        encoding: "utf-8",
      }).trim();
    } catch {
      return "(unknown)";
    }
  }
}
