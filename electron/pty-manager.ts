import * as pty from "node-pty";
import fs from "fs";
import { buildLaunchSpec, type PtyLaunchOptions } from "./pty-launch.ts";
import { killProcessEscalated } from "../shared/processKill.ts";
import { computeBackoff } from "../shared/backoff.ts";

export type PtyCreateOptions = PtyLaunchOptions;
type PtySpawnFn = typeof pty.spawn;
type BuildLaunchSpecFn = typeof buildLaunchSpec;

interface PtyManagerDeps {
  spawn: PtySpawnFn;
  buildLaunchSpec: BuildLaunchSpecFn;
}

const RETRYABLE_PTY_SPAWN_ERRORS = [
  /posix_spawnp failed/i,
  /forkpty\(3\) failed/i,
  /device not configured/i,
];
const MAX_PTY_CREATE_ATTEMPTS = 3;

function isRetryablePtySpawnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_PTY_SPAWN_ERRORS.some((pattern) => pattern.test(message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PtyManager {
  private instances = new Map<number, pty.IPty>();
  private outputBuffers = new Map<number, string[]>();
  private readonly MAX_OUTPUT_LINES = 1000;
  private nextId = 1;
  private readonly deps: PtyManagerDeps;

  constructor(deps: Partial<PtyManagerDeps> = {}) {
    this.deps = {
      spawn: pty.spawn,
      buildLaunchSpec,
      ...deps,
    };
  }

  async create(options: PtyCreateOptions): Promise<number> {
    if (!fs.existsSync(options.cwd)) {
      throw new Error(`Directory does not exist: ${options.cwd}`);
    }

    const launch = await this.deps.buildLaunchSpec(options);

    let ptyProcess: pty.IPty | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_PTY_CREATE_ATTEMPTS; attempt += 1) {
      try {
        ptyProcess = this.deps.spawn(launch.file, launch.args, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: launch.cwd,
          env: launch.env,
        });
        break;
      } catch (error) {
        lastError = error;
        if (
          attempt >= MAX_PTY_CREATE_ATTEMPTS ||
          !isRetryablePtySpawnError(error)
        ) {
          throw new Error(
            `Failed to spawn "${launch.file}" in "${launch.cwd}": ${String(error)}`,
          );
        }

        console.warn(
          `[PtyManager] transient PTY spawn failure on attempt ${attempt}/${MAX_PTY_CREATE_ATTEMPTS}: ${String(error)}`,
        );
        await sleep(computeBackoff(attempt, { baseMs: 50, maxMs: 500, multiplier: 2, jitterFraction: 0.2 }));
      }
    }

    if (!ptyProcess) {
      throw new Error(
        `Failed to spawn "${launch.file}" in "${launch.cwd}": ${String(lastError)}`,
      );
    }

    const id = this.nextId++;
    this.instances.set(id, ptyProcess);
    return id;
  }

  getPid(id: number): number | undefined {
    return this.instances.get(id)?.pid;
  }

  write(id: number, data: string) {
    this.instances.get(id)?.write(data);
  }

  /**
   * Resolves when PTY output settles (no new output for {@link settleMs}),
   * or after {@link timeoutMs} at most.
   * Used to gate the submit key (\r) until the CLI has finished processing
   * and rendering a paste.
   */
  waitForOutput(id: number, timeoutMs: number, settleMs = 50): Promise<void> {
    return new Promise((resolve) => {
      const instance = this.instances.get(id);
      if (!instance) {
        resolve();
        return;
      }
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      const maxTimer = setTimeout(() => {
        if (settleTimer) clearTimeout(settleTimer);
        disposable.dispose();
        resolve();
      }, timeoutMs);
      const disposable = instance.onData(() => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          clearTimeout(maxTimer);
          disposable.dispose();
          resolve();
        }, settleMs);
      });
    });
  }

  resize(id: number, cols: number, rows: number) {
    try {
      this.instances.get(id)?.resize(cols, rows);
    } catch {
      // Kill the process group before removing from map to prevent orphans.
      const inst = this.instances.get(id);
      if (inst && inst.pid > 1) {
        killProcessEscalated(inst.pid, { signal: "SIGHUP", termMs: 2000, killMs: 500 })
          .catch(() => {});
      }
      this.instances.delete(id);
    }
  }

  notifyThemeChanged(id: number) {
    const pid = this.instances.get(id)?.pid;
    if (!pid) return;

    if (process.platform === "win32") {
      return;
    }

    try {
      process.kill(pid, "SIGWINCH");
    } catch {
    }
  }

  onData(id: number, callback: (data: string) => void) {
    this.instances.get(id)?.onData(callback);
  }

  onExit(id: number, callback: (exitCode: number) => void) {
    this.instances.get(id)?.onExit(({ exitCode }) => {
      this.instances.delete(id);
      this.outputBuffers.delete(id);
      callback(exitCode);
    });
  }

  captureOutput(id: number, data: string) {
    let buffer = this.outputBuffers.get(id);
    if (!buffer) {
      buffer = [];
      this.outputBuffers.set(id, buffer);
    }
    const lines = data.split("\n");
    for (const line of lines) {
      buffer.push(line);
    }
    if (buffer.length > this.MAX_OUTPUT_LINES) {
      buffer.splice(0, buffer.length - this.MAX_OUTPUT_LINES);
    }
  }

  getOutput(id: number, lineCount: number = 50): string[] {
    const buffer = this.outputBuffers.get(id) ?? [];
    return buffer.slice(-lineCount);
  }

  async destroy(id: number): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      this.outputBuffers.delete(id);
      return;
    }

    const pid = instance.pid;
    this.instances.delete(id);
    this.outputBuffers.delete(id);

    // 3-stage kill: SIGHUP → wait → SIGKILL
    if (pid > 1) {
      const result = await killProcessEscalated(pid, {
        signal: "SIGHUP",
        termMs: 5000,
        killMs: 2000,
        processGroup: true,
      });
      if (result.method === "unknown") {
        console.warn(`[PtyManager] process ${pid} may still be alive after kill escalation`);
      }
    }
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.instances.keys()];
    await Promise.all(ids.map((id) => this.destroy(id)));
  }
}

export class OutputBatcher {
  private pending = new Map<number, string[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushCallback: (ptyId: number, data: string) => void;

  constructor(flushCallback: (ptyId: number, data: string) => void) {
    this.flushCallback = flushCallback;
  }

  push(ptyId: number, data: string) {
    let buf = this.pending.get(ptyId);
    if (!buf) {
      buf = [];
      this.pending.set(ptyId, buf);
    }
    buf.push(data);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 8);
    }
  }

  flush() {
    this.timer = null;
    for (const [ptyId, chunks] of this.pending) {
      this.flushCallback(ptyId, chunks.join(""));
    }
    this.pending.clear();
  }

  dispose() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
