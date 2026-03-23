import * as pty from "node-pty";
import fs from "fs";
import { buildLaunchSpec, type PtyLaunchOptions } from "./pty-launch.ts";

export type PtyCreateOptions = PtyLaunchOptions;

export class PtyManager {
  private instances = new Map<number, pty.IPty>();
  private outputBuffers = new Map<number, string[]>();
  private readonly MAX_OUTPUT_LINES = 1000;
  private nextId = 1;

  async create(options: PtyCreateOptions): Promise<number> {
    if (!fs.existsSync(options.cwd)) {
      throw new Error(`Directory does not exist: ${options.cwd}`);
    }

    const launch = await buildLaunchSpec(options);

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(launch.file, launch.args, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: launch.cwd,
        env: launch.env,
      });
    } catch (error) {
      throw new Error(
        `Failed to spawn "${launch.file}" in "${launch.cwd}": ${String(error)}`,
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
      // PTY fd may already be invalid after process exit
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
      // Process may already be gone or not accept the signal
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

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process exited while the timeout elapsed.
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
