import { isTermCanvasRunning, telemetryTerminal } from "./termcanvas.ts";

/**
 * PTY liveness probe for the watch loop.
 *
 * Returns:
 *   true  — PTY is alive; worker may still be working.
 *   false — PTY has exited; the watch loop should apply its timeout path
 *           (mark timed_out, attempt a retry, surface dispatch_failed_final
 *           when the retry budget is exhausted).
 *   null  — unknown; either TermCanvas is not running, the telemetry snapshot
 *           is unavailable, or the field was absent. The watch loop treats
 *           null as "no signal" and keeps polling.
 *
 * History: this used to be a stub that always returned null with a comment
 * claiming a telemetry import cycle. There is no cycle — workflow-lead
 * already imports telemetryTerminal directly — so the stub silently
 * disabled the entire PTY-exit branch of the watch loop. That is the bug
 * this helper exists to close: without it, an agent that exits without
 * writing result.json leaves the assignment "in_progress" until the
 * workbench timeout fires, which is typically far too long.
 */

export interface TerminalLivenessDependencies {
  isTermCanvasRunning(): boolean;
  telemetryTerminal(terminalId: string): { pty_alive?: boolean } | null;
}

const DEFAULT_DEPENDENCIES: TerminalLivenessDependencies = {
  isTermCanvasRunning,
  telemetryTerminal: (id) =>
    telemetryTerminal(id) as { pty_alive?: boolean } | null,
};

export function checkTerminalAlive(
  terminalId: string,
  dependencies: TerminalLivenessDependencies = DEFAULT_DEPENDENCIES,
): boolean | null {
  try {
    if (!dependencies.isTermCanvasRunning()) return null;
    const snapshot = dependencies.telemetryTerminal(terminalId);
    if (!snapshot) return null;
    if (typeof snapshot.pty_alive === "boolean") return snapshot.pty_alive;
    return null;
  } catch {
    // Telemetry probe failed (daemon unreachable, IPC flake). Treat as
    // unknown rather than assuming the PTY is dead — a spurious false
    // here would trigger an unnecessary retry cycle.
    return null;
  }
}
