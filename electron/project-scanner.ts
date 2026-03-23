import { execFile, execFileSync, execSync } from "child_process";
import { existsSync } from "fs";
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

function parseWorktreesOutput(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> & { prunable?: boolean } = {};

  // Ensure the final record is flushed even if output doesn't end with '\n'
  for (const line of (output.endsWith("\n") ? output : `${output}\n`).split("\n")) {
    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.replace("refs/heads/", "");
    } else if (line === "bare") {
      current.branch = "(bare)";
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    } else if (line === "") {
      if (current.path && !current.prunable && existsSync(current.path)) {
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
}

function runGitAsync(dirPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: dirPath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export class ProjectScanner {
  scan(dirPath: string): ProjectInfo | null {
    try {
      execSync("git rev-parse --git-dir", { cwd: dirPath, stdio: "pipe" });
    } catch {
      return null;
    }

    const name = path.basename(dirPath);
    const worktrees = this.listWorktrees(dirPath);

    return { name, path: dirPath, worktrees };
  }

  async scanAsync(dirPath: string): Promise<ProjectInfo | null> {
    try {
      await runGitAsync(dirPath, ["rev-parse", "--git-dir"]);
    } catch {
      return null;
    }

    const name = path.basename(dirPath);
    const worktrees = await this.listWorktreesAsync(dirPath);

    return { name, path: dirPath, worktrees };
  }

  listWorktrees(dirPath: string): WorktreeInfo[] {
    try {
      const output = execFileSync(
        "git",
        ["worktree", "list", "--porcelain"],
        {
          cwd: dirPath,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      return parseWorktreesOutput(output);
    } catch {
      return [
        {
          path: dirPath,
          branch: this.getCurrentBranch(dirPath),
          isMain: true,
        },
      ];
    }
  }

  async listWorktreesAsync(dirPath: string): Promise<WorktreeInfo[]> {
    try {
      const output = await runGitAsync(dirPath, [
        "worktree",
        "list",
        "--porcelain",
      ]);
      return parseWorktreesOutput(output);
    } catch {
      return [
        {
          path: dirPath,
          branch: await this.getCurrentBranchAsync(dirPath),
          isMain: true,
        },
      ];
    }
  }

  private getCurrentBranch(dirPath: string): string {
    try {
      return execFileSync("git", ["branch", "--show-current"], {
        cwd: dirPath,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      }).trim();
    } catch {
      return "(unknown)";
    }
  }

  private async getCurrentBranchAsync(dirPath: string): Promise<string> {
    try {
      return (await runGitAsync(dirPath, ["branch", "--show-current"])).trim();
    } catch {
      return "(unknown)";
    }
  }
}
