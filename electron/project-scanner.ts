import { execSync } from "child_process";
import { watch, type FSWatcher } from "fs";
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
  private watchers = new Map<string, FSWatcher>();

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

  listWorktrees(dirPath: string): WorktreeInfo[] {
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
      return [
        {
          path: dirPath,
          branch: this.getCurrentBranch(dirPath),
          isMain: true,
        },
      ];
    }
  }

  /**
   * Watch a project's .git/worktrees directory for changes.
   * Calls onChange when worktrees are added or removed.
   */
  startWatching(
    dirPath: string,
    onChange: (worktrees: WorktreeInfo[]) => void,
  ) {
    this.stopWatching(dirPath);

    let gitDir: string;
    try {
      gitDir = execSync("git rev-parse --git-dir", {
        cwd: dirPath,
        encoding: "utf-8",
      }).trim();
    } catch {
      return;
    }

    // Resolve to absolute path
    const absGitDir = path.isAbsolute(gitDir)
      ? gitDir
      : path.resolve(dirPath, gitDir);
    const worktreesDir = path.join(absGitDir, "worktrees");

    // Debounce to avoid rapid-fire events
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const debouncedScan = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        const worktrees = this.listWorktrees(dirPath);
        onChange(worktrees);
      }, 500);
    };

    try {
      const watcher = watch(worktreesDir, { recursive: true }, debouncedScan);
      this.watchers.set(dirPath, watcher);
    } catch {
      // .git/worktrees may not exist yet (no worktrees created)
      // Watch the .git dir itself for creation of worktrees/
      try {
        const watcher = watch(absGitDir, (_event, filename) => {
          if (filename === "worktrees") {
            debouncedScan();
          }
        });
        this.watchers.set(dirPath, watcher);
      } catch {
        // Ignore - directory may not exist
      }
    }
  }

  stopWatching(dirPath: string) {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
    }
  }

  stopAllWatching() {
    for (const [dirPath] of this.watchers) {
      this.stopWatching(dirPath);
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
