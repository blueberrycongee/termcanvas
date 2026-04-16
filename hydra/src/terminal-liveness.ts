import type { TelemetryDerivedStatus } from "../../shared/telemetry.ts";
import { isTermCanvasRunning, telemetryTerminal } from "./termcanvas.ts";

/**
 * Telemetry-backed probes used by the watch loop.
 *
 * The watch loop needs two distinct signals from telemetry:
 *
 *   1. PTY liveness (checkTerminalAlive) — hard signal, drives timeouts.
 *      pty_alive === false means the PTY exited; the watch loop then marks
 *      the assignment timed_out and kicks a retry through the state machine.
 *
 *   2. Progress liveness (probeTerminalProgress) — soft signal, drives
 *      advisory DecisionPoints. derived_status plus last_meaningful_progress_at
 *      tell us when a worker is alive but not doing anything. The watch
 *      loop does NOT kill such workers autonomously — the Lead decides
 *      via a stall_advisory DecisionPoint.
 *
 * History: checkTerminalAlive used to be a stub returning null with a
 * comment blaming a "telemetry import cycle" that does not exist —
 * workflow-lead already imports telemetryTerminal. The stub silently
 * disabled the entire PTY-exit branch of the watch loop. That is the bug
 * this helper exists to close.
 */

export interface TerminalLivenessDependencies {
  isTermCanvasRunning(): boolean;
  telemetryTerminal(terminalId: string): TelemetrySnapshotProbe | null;
}

/**
 * Narrow shape of the telemetry snapshot the watch loop cares about. We
 * deliberately keep it minimal instead of importing the full
 * TerminalTelemetrySnapshot — the hydra CLI receives whatever the
 * `termcanvas telemetry get` command prints as JSON, and future telemetry
 * fields should not break hydra parsing. Optional everywhere on purpose:
 * absent means "no signal", the same as undefined, so fallbacks are
 * uniform.
 */
export interface TelemetrySnapshotProbe {
  pty_alive?: boolean;
  derived_status?: TelemetryDerivedStatus;
  last_meaningful_progress_at?: string;
}

const DEFAULT_DEPENDENCIES: TerminalLivenessDependencies = {
  isTermCanvasRunning,
  telemetryTerminal: (id) =>
    telemetryTerminal(id) as TelemetrySnapshotProbe | null,
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

export interface ProgressProbeResult {
  /** Full snapshot payload when the probe succeeded; null otherwise. */
  snapshot: TelemetrySnapshotProbe | null;
  /** True when telemetry was reachable AND returned a snapshot. */
  available: boolean;
}

/**
 * Best-effort read of the subset of telemetry the stall-advisory logic
 * needs. Returns available=false when the snapshot could not be fetched —
 * callers MUST treat that as "unknown" rather than as "progressing", to
 * avoid suppressing advisories whenever telemetry is momentarily down.
 */
export function probeTerminalProgress(
  terminalId: string,
  dependencies: TerminalLivenessDependencies = DEFAULT_DEPENDENCIES,
): ProgressProbeResult {
  try {
    if (!dependencies.isTermCanvasRunning()) {
      return { snapshot: null, available: false };
    }
    const snapshot = dependencies.telemetryTerminal(terminalId);
    if (!snapshot) return { snapshot: null, available: false };
    return { snapshot, available: true };
  } catch {
    return { snapshot: null, available: false };
  }
}
