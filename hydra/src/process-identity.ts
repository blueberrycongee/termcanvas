import type { AssignmentManager } from "./assignment/manager.ts";
import { getRuntime } from "./runtime/index.ts";

/**
 * Durable process-identity capture for dispatched runs.
 *
 * Why this exists: when an assignment's terminal is later found missing
 * (app restart, crash, user close), we need a way to distinguish
 *   (a) the original worker is still running — leave it alone,
 *   (b) the process died and the PID was never reused — safe to mark failed,
 *   (c) the PID got recycled to a totally unrelated process — do not kill.
 *
 * A raw PID alone cannot disambiguate (b) from (c) — Linux recycles PIDs
 * aggressively on tight process tables. shell_pid + captured_at gives the
 * reconcile logic enough to compare against the kernel's reported start
 * time of whatever currently holds that PID. This file writes the record;
 * the reconcile pass (separate commit) reads it.
 *
 * Capture is best-effort. Telemetry may be unreachable (app not running,
 * IPC flake) or the PTY may not have spawned its shell at the moment we
 * ask. Either condition leaves process_identity undefined on the run,
 * which reconcile reads as "unknown — prompt the user" rather than as
 * "definitely orphaned". Silent skip is the right default here.
 */

export interface ProcessIdentityDependencies {
  telemetryTerminal(terminalId: string): { shell_pid?: number | null } | null;
  now?: () => string;
}

function defaultTelemetry(terminalId: string): { shell_pid?: number | null } | null {
  try {
    return getRuntime().telemetryTerminal(terminalId);
  } catch {
    // Telemetry unreachable (e.g. TermCanvas not running) — swallow and let
    // the caller skip identity capture rather than fail the dispatch itself.
    return null;
  }
}

const DEFAULT_DEPENDENCIES: ProcessIdentityDependencies = {
  telemetryTerminal: defaultTelemetry,
};

export function captureRunShellPid(
  manager: AssignmentManager,
  assignmentId: string,
  runId: string,
  dependencies: ProcessIdentityDependencies = DEFAULT_DEPENDENCIES,
): void {
  const now = dependencies.now ?? (() => new Date().toISOString());

  let assignment;
  try {
    assignment = manager.load(assignmentId);
  } catch {
    return;
  }
  if (!assignment) return;

  const run = assignment.runs.find((entry) => entry.id === runId);
  if (!run) return;

  let snapshot: { shell_pid?: number | null } | null = null;
  try {
    snapshot = dependencies.telemetryTerminal(run.terminal_id);
  } catch {
    return;
  }
  if (!snapshot) return;

  // Only persist when we actually have a PID. Recording shell_pid=null adds
  // no information over leaving process_identity undefined, and pollutes
  // the reconcile logic with a field that looks present but is useless.
  const shellPid = typeof snapshot.shell_pid === "number" ? snapshot.shell_pid : null;
  if (shellPid === null) return;

  run.process_identity = {
    shell_pid: shellPid,
    captured_at: now(),
  };
  manager.save(assignment);
}
