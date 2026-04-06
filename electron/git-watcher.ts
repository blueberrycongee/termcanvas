import fs from "node:fs";
import path from "node:path";

const DIFF_SIGNAL_FILES = new Set(["HEAD", "index"]);
const LOG_SIGNAL_FILES = new Set([
  "HEAD",
  "COMMIT_EDITMSG",
  "MERGE_HEAD",
  "REBASE_HEAD",
  "FETCH_HEAD",
  "rebase-merge",
]);

interface GitWatchCallbacks {
  onChanged?: () => void;
  onLogChanged?: () => void;
  onPresenceChanged?: (isGitRepo: boolean) => void;
}

interface GitWatchState {
  callbacks: GitWatchCallbacks;
  gitDir: string | null;
  gitDirWatcher: fs.FSWatcher | null;
  presenceWatcher: fs.FSWatcher | null;
  diffTimer: NodeJS.Timeout | null;
  logTimer: NodeJS.Timeout | null;
  isGitRepo: boolean;
}

function isRelevantGitSignal(name: string | null): boolean {
  if (!name) return true;
  if (name === "index.lock") return false;
  return DIFF_SIGNAL_FILES.has(name) || LOG_SIGNAL_FILES.has(name);
}

/**
 * Watches the worktree root for .git presence changes and the resolved git dir
 * for diff/log refresh signals. All callbacks are debounced by 500ms.
 */
export class GitFileWatcher {
  private states = new Map<string, GitWatchState>();
  private lastMtimes = new Map<string, number>();

  watch(worktreePath: string, callbacks: GitWatchCallbacks): void {
    if (this.states.has(worktreePath)) return;

    const state: GitWatchState = {
      callbacks,
      gitDir: null,
      gitDirWatcher: null,
      presenceWatcher: null,
      diffTimer: null,
      logTimer: null,
      isGitRepo: false,
    };

    this.states.set(worktreePath, state);
    this.watchGitPresence(worktreePath, (isGitRepo) => {
      callbacks.onPresenceChanged?.(isGitRepo);
    });

    const gitDir = this.resolveGitDir(worktreePath);
    if (gitDir) {
      state.isGitRepo = true;
      this.startGitDirectoryWatch(worktreePath, gitDir);
    }
  }

  watchGitPresence(dirPath: string, callback: (isGitRepo: boolean) => void): void {
    const state = this.states.get(dirPath);
    if (!state || state.presenceWatcher) return;

    state.presenceWatcher = fs.watch(dirPath, (_event, changedFile) => {
      if (changedFile && changedFile !== ".git") {
        return;
      }
      this.refreshPresenceState(dirPath, callback);
    });
  }

  unwatch(worktreePath: string): void {
    const state = this.states.get(worktreePath);
    if (!state) return;

    state.gitDirWatcher?.close();
    state.presenceWatcher?.close();
    if (state.diffTimer) clearTimeout(state.diffTimer);
    if (state.logTimer) clearTimeout(state.logTimer);
    this.states.delete(worktreePath);

    for (const key of this.lastMtimes.keys()) {
      if (key.startsWith(`${worktreePath}:`)) {
        this.lastMtimes.delete(key);
      }
    }
  }

  unwatchAll(): void {
    for (const worktreePath of [...this.states.keys()]) {
      this.unwatch(worktreePath);
    }
  }

  private refreshPresenceState(worktreePath: string, callback: (isGitRepo: boolean) => void) {
    const state = this.states.get(worktreePath);
    if (!state) return;

    const gitDir = this.resolveGitDir(worktreePath);
    const nextIsRepo = gitDir !== null;
    if (nextIsRepo === state.isGitRepo) {
      return;
    }

    state.isGitRepo = nextIsRepo;
    callback(nextIsRepo);

    if (nextIsRepo) {
      this.startGitDirectoryWatch(worktreePath, gitDir);
      return;
    }

    state.gitDirWatcher?.close();
    state.gitDirWatcher = null;
    state.gitDir = null;
  }

  private startGitDirectoryWatch(worktreePath: string, resolvedGitDir: string) {
    const state = this.states.get(worktreePath);
    if (!state) return;

    const gitDir = resolvedGitDir;

    state.gitDirWatcher?.close();
    state.gitDir = gitDir;

    for (const name of new Set([...DIFF_SIGNAL_FILES, ...LOG_SIGNAL_FILES])) {
      this.recordMtime(worktreePath, gitDir, name);
    }

    try {
      state.gitDirWatcher = fs.watch(gitDir, (event, changedFile) => {
        const name = typeof changedFile === "string" ? changedFile : null;
        if (!isRelevantGitSignal(name)) {
          return;
        }
        if (name && !this.didFileChange(worktreePath, gitDir, name, event)) {
          return;
        }

        if (!name || DIFF_SIGNAL_FILES.has(name)) {
          this.scheduleDiffEvent(worktreePath);
        }
        if (!name || LOG_SIGNAL_FILES.has(name)) {
          this.scheduleLogEvent(worktreePath);
        }
      });
    } catch {
      state.gitDirWatcher = null;
    }
  }

  private scheduleDiffEvent(worktreePath: string) {
    const state = this.states.get(worktreePath);
    if (!state) return;
    if (state.diffTimer) clearTimeout(state.diffTimer);
    state.diffTimer = setTimeout(() => {
      state.diffTimer = null;
      state.callbacks.onChanged?.();
    }, 500);
  }

  private scheduleLogEvent(worktreePath: string) {
    const state = this.states.get(worktreePath);
    if (!state) return;
    if (state.logTimer) clearTimeout(state.logTimer);
    state.logTimer = setTimeout(() => {
      state.logTimer = null;
      state.callbacks.onLogChanged?.();
    }, 500);
  }

  private resolveGitDir(worktreePath: string): string | null {
    try {
      const dotGitPath = path.join(worktreePath, ".git");
      const stat = fs.statSync(dotGitPath);
      if (stat.isDirectory()) {
        return dotGitPath;
      }

      const raw = fs.readFileSync(dotGitPath, "utf-8").trim();
      const match = raw.match(/^gitdir:\s*(.+)$/i);
      if (!match) {
        return null;
      }
      let gitDir = match[1].trim();
      if (!path.isAbsolute(gitDir)) {
        gitDir = path.resolve(worktreePath, gitDir);
      }
      return gitDir;
    } catch {
      return null;
    }
  }

  private recordMtime(worktreePath: string, gitDir: string, name: string) {
    const key = `${worktreePath}:${name}`;
    try {
      this.lastMtimes.set(key, fs.statSync(path.join(gitDir, name)).mtimeMs);
    } catch {
      this.lastMtimes.set(key, 0);
    }
  }

  private didFileChange(
    worktreePath: string,
    gitDir: string,
    name: string,
    event: string,
  ): boolean {
    const filePath = path.join(gitDir, name);
    const key = `${worktreePath}:${name}`;
    let newMtime = 0;
    try {
      newMtime = fs.statSync(filePath).mtimeMs;
    } catch {
      if (event === "rename") {
        this.lastMtimes.set(key, 0);
        return true;
      }
      return false;
    }

    const lastMtime = this.lastMtimes.get(key) ?? 0;
    if (event !== "rename" && newMtime === lastMtime) {
      return false;
    }
    this.lastMtimes.set(key, newMtime);
    return true;
  }
}
