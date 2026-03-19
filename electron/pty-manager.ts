import * as pty from "node-pty";
import fs from "fs";
import { buildLaunchSpec, type PtyLaunchOptions } from "./pty-launch";

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
   * Resolves when the PTY produces any output, or after {@link timeoutMs}.
   * Used to gate the submit key (\r) until the CLI has processed a paste.
   */
  waitForOutput(id: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const instance = this.instances.get(id);
      if (!instance) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        disposable.dispose();
        resolve();
      }, timeoutMs);
      const disposable = instance.onData(() => {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
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

  destroy(id: number) {
    const instance = this.instances.get(id);
    if (instance) {
      instance.kill();
      this.instances.delete(id);
    }
    this.outputBuffers.delete(id);
  }

  destroyAll() {
    for (const [id] of this.instances) {
      this.destroy(id);
    }
  }
}
