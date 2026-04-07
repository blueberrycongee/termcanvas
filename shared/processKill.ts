/**
 * 3-stage process kill escalation: graceful signal → poll → force kill.
 *
 * Stage 0: Check if process is alive (skip if already dead)
 * Stage 1: Send graceful signal (SIGHUP by default for PTY groups, SIGTERM otherwise)
 * Stage 2: Send SIGKILL after grace period expires
 */

export interface KillOptions {
  /** Graceful signal to send first. Default: "SIGHUP" (for PTY process groups) */
  signal?: NodeJS.Signals;
  /** Grace period before escalating to SIGKILL. Default: 5000ms */
  termMs?: number;
  /** Final wait after SIGKILL before giving up. Default: 2000ms */
  killMs?: number;
  /** Poll interval for checking process liveness. Default: 100ms */
  pollMs?: number;
  /** Kill process group (negative PID) instead of single process. Default: true */
  processGroup?: boolean;
}

export interface KillResult {
  /** How the process was terminated */
  method: "already_dead" | "graceful" | "force_killed" | "unknown";
  /** Time in ms from first signal to confirmed dead */
  elapsedMs: number;
}

/**
 * Check if a process is alive by sending signal 0 (no-op probe).
 * Returns true if the process exists (or if we lack permission to signal it).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e.code === "EPERM") return true; // Permission denied = still alive
    return false; // ESRCH = no such process
  }
}

/**
 * Wait for a process to die, polling at regular intervals.
 * Returns true if the process died within the timeout, false otherwise.
 */
export async function waitForDeath(
  pid: number,
  timeoutMs: number,
  pollMs = 100,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return !isProcessAlive(pid);
}

/**
 * Kill a process with 3-stage escalation:
 * 1. Graceful signal (SIGHUP/SIGTERM)
 * 2. Wait for process to exit
 * 3. Force kill (SIGKILL) if still alive
 *
 * @param pid - Process ID to kill
 * @param options - Kill configuration
 * @returns Result describing how the process was terminated
 */
export async function killProcessEscalated(
  pid: number,
  options: KillOptions = {},
): Promise<KillResult> {
  const {
    signal = "SIGHUP",
    termMs = 5000,
    killMs = 2000,
    pollMs = 100,
    processGroup = true,
  } = options;

  const start = Date.now();

  // Refuse to kill PID <= 1 (init/launchd) or invalid PIDs.
  if (pid <= 1) {
    return { method: "already_dead", elapsedMs: 0 };
  }

  // Stage 0: Already dead?
  if (!isProcessAlive(pid)) {
    return { method: "already_dead", elapsedMs: Date.now() - start };
  }

  // Windows does not support process group kill (negative PID).
  const canUseProcessGroup = process.platform !== "win32";
  const targetPid = processGroup && canUseProcessGroup && pid > 1 ? -pid : pid;

  // Stage 1: Graceful signal
  try {
    process.kill(targetPid, signal);
  } catch {
    // Process may have died between check and kill
    if (!isProcessAlive(pid)) {
      return { method: "already_dead", elapsedMs: Date.now() - start };
    }
  }

  if (await waitForDeath(pid, termMs, pollMs)) {
    return { method: "graceful", elapsedMs: Date.now() - start };
  }

  // Stage 2: Force kill
  try {
    process.kill(targetPid, "SIGKILL");
  } catch {
    // Process may have died during the wait
    if (!isProcessAlive(pid)) {
      return { method: "graceful", elapsedMs: Date.now() - start };
    }
  }

  await waitForDeath(pid, killMs, pollMs);

  if (!isProcessAlive(pid)) {
    return { method: "force_killed", elapsedMs: Date.now() - start };
  }

  return { method: "unknown", elapsedMs: Date.now() - start };
}
