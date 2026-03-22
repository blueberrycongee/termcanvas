import fs from "fs";
import path from "path";
import os from "os";

export type SessionType = "claude" | "codex";

interface CompletionSignal {
  completed: boolean;
}

/**
 * Pure function: check if the tail of a JSONL file contains a turn-completion signal.
 * Reads the last `tailBytes` of the file to avoid loading the entire file.
 */
export function checkTurnComplete(
  filePath: string,
  type: SessionType,
  tailBytes = 131072,
): CompletionSignal {
  let content: string;
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size === 0) return { completed: false };

    const fd = fs.openSync(filePath, "r");
    const readSize = Math.min(tailBytes, size);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, size - readSize);
    fs.closeSync(fd);
    content = buf.toString("utf-8");
  } catch {
    return { completed: false };
  }

  // Parse last few lines as JSON
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  // Check from the end — the completion signal is usually the last or second-to-last line
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    if (type === "claude") {
      // Signal 1: assistant message with stop_reason "end_turn"
      if (
        parsed.type === "assistant" &&
        typeof parsed.message === "object" &&
        parsed.message !== null &&
        (parsed.message as Record<string, unknown>).stop_reason === "end_turn"
      ) {
        return { completed: true };
      }
      // Signal 2: system message with subtype "turn_duration"
      if (parsed.type === "system" && parsed.subtype === "turn_duration") {
        return { completed: true };
      }
    }

    if (type === "codex") {
      // Signal: event_msg with payload.type "task_complete"
      if (
        parsed.type === "event_msg" &&
        typeof parsed.payload === "object" &&
        parsed.payload !== null &&
        (parsed.payload as Record<string, unknown>).type === "task_complete"
      ) {
        return { completed: true };
      }
    }
  }

  return { completed: false };
}

export function toClaudeProjectKey(cwd: string): string {
  return cwd.replaceAll(/[/\\.:]/g, "-");
}

/**
 * Resolve the JSONL file path for a session.
 */
function resolveSessionFile(
  sessionId: string,
  type: SessionType,
  cwd: string,
): string | null {
  const home = os.homedir();

  if (type === "claude") {
    const projectKey = toClaudeProjectKey(cwd);
    return path.join(home, ".claude", "projects", projectKey, sessionId + ".jsonl");
  }

  if (type === "codex") {
    const sessionsDir = path.join(home, ".codex", "sessions");
    try {
      const now = new Date();
      // Search last 7 days of date directories
      for (let d = 0; d < 7; d++) {
        const date = new Date(now.getTime() - d * 86400000);
        const yyyy = String(date.getFullYear());
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        const dayDir = path.join(sessionsDir, yyyy, mm, dd);
        if (!fs.existsSync(dayDir)) continue;
        const files = fs.readdirSync(dayDir);
        const match = files.find((f) => f.includes(sessionId));
        if (match) return path.join(dayDir, match);
      }
    } catch (err) {
      console.warn(`[SessionWatcher] codex resolveSessionFile error for session=${sessionId}:`, err);
    }
    return null;
  }

  return null;
}

interface WatchEntry {
  watcher: fs.FSWatcher;
  filePath: string;
  lastNotifiedMtime: number;
  debounceTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
}

/**
 * Watches AI CLI session JSONL files for turn-completion signals.
 * Uses fs.watch on the parent directory + mtime verification (same pattern as GitFileWatcher).
 */
export class SessionWatcher {
  private entries = new Map<string, WatchEntry>();

  watch(
    sessionId: string,
    type: SessionType,
    cwd: string,
    callback: () => void,
  ): { ok: boolean; reason?: string } {
    if (this.entries.has(sessionId)) return { ok: true };

    const filePath = resolveSessionFile(sessionId, type, cwd);
    if (!filePath) {
      console.warn(`[SessionWatcher] resolveSessionFile returned null for session=${sessionId} type=${type} cwd=${cwd}`);
      return { ok: false, reason: "session-file-not-found" };
    }

    console.log(`[SessionWatcher] watch session=${sessionId} type=${type} file=${filePath}`);

    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);

    // Ensure directory exists before watching
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.error(`[SessionWatcher] failed to create directory ${dir}:`, err);
        return { ok: false, reason: "dir-create-failed" };
      }
    }

    let lastNotifiedMtime = 0;
    try {
      lastNotifiedMtime = fs.statSync(filePath).mtimeMs;
    } catch {
      // File may not exist yet
    }

    let debounceTimer: NodeJS.Timeout | null = null;
    // Track whether we already notified for the current turn's completion.
    // Reset when we observe a non-completed state (i.e. a new turn has started
    // and pushed the old turn_duration out of the JSONL tail).
    let awaitingNewTurn = false;

    const tryCheck = (source: string): boolean => {
      let currentMtime = 0;
      try {
        currentMtime = fs.statSync(filePath).mtimeMs;
      } catch {
        return false;
      }

      const entry = this.entries.get(sessionId);
      if (!entry || currentMtime === entry.lastNotifiedMtime) return false;

      // Always update mtime to avoid re-checking the same file state
      entry.lastNotifiedMtime = currentMtime;

      const result = checkTurnComplete(filePath, type);
      console.log(`[SessionWatcher] checkTurnComplete source=${source} session=${sessionId} completed=${result.completed} awaitingNewTurn=${awaitingNewTurn}`);
      if (result.completed) {
        if (!awaitingNewTurn) {
          awaitingNewTurn = true;
          console.log(`[SessionWatcher] completed session=${sessionId}`);
          callback();
          return true;
        }
      } else {
        // New turn started — the old completion is no longer in the tail
        awaitingNewTurn = false;
      }
      return false;
    };

    const watcher = fs.watch(dir, (event, changedFile) => {
      if (changedFile && changedFile !== basename) return;

      console.log(`[SessionWatcher] fs.watch event=${event} file=${changedFile} session=${sessionId}`);

      let newMtime = 0;
      try {
        newMtime = fs.statSync(filePath).mtimeMs;
      } catch {
        return;
      }

      const entry = this.entries.get(sessionId);
      if (!entry) return;
      if (newMtime === entry.lastNotifiedMtime) return;

      // Debounce: JSONL may get multiple rapid writes per turn
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        tryCheck("fs.watch");
      }, 300);
    });

    // Fallback polling: fs.watch on macOS can miss events (rename from atomic writes).
    // After 30s, poll every 10s as a safety net.
    const POLL_DELAY = 30_000;
    const POLL_INTERVAL = 10_000;
    const pollTimer = setTimeout(() => {
      const entry = this.entries.get(sessionId);
      if (!entry) return;

      console.log(`[SessionWatcher] starting fallback polling for session=${sessionId}`);
      entry.pollTimer = setInterval(() => {
        if (!this.entries.has(sessionId)) {
          const e = this.entries.get(sessionId);
          if (e?.pollTimer) clearInterval(e.pollTimer);
          return;
        }
        tryCheck("poll");
      }, POLL_INTERVAL);
    }, POLL_DELAY);

    this.entries.set(sessionId, {
      watcher,
      filePath,
      lastNotifiedMtime,
      debounceTimer,
      pollTimer,
    });

    // Initial check: the turn may have completed before the watcher was set up.
    // Mark awaitingNewTurn so we don't re-fire for the same completion, but
    // still fire the callback so the renderer knows the current state.
    if (lastNotifiedMtime > 0) {
      const result = checkTurnComplete(filePath, type);
      if (result.completed) {
        console.log(`[SessionWatcher] initial check: already completed session=${sessionId}`);
        awaitingNewTurn = true;
        callback();
      }
    }

    return { ok: true };
  }

  unwatch(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    console.log(`[SessionWatcher] unwatch session=${sessionId}`);
    entry.watcher.close();
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    if (entry.pollTimer) {
      clearTimeout(entry.pollTimer);
      clearInterval(entry.pollTimer);
    }
    this.entries.delete(sessionId);
  }

  unwatchAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.unwatch(sessionId);
    }
  }
}
