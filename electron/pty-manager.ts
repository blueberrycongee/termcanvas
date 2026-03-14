import * as pty from "node-pty";
import os from "os";

export class PtyManager {
  private instances = new Map<number, pty.IPty>();
  private nextId = 1;

  create(cwd: string, shell?: string): number {
    const defaultShell =
      shell ??
      (os.platform() === "win32"
        ? "powershell.exe"
        : (process.env.SHELL ?? "/bin/zsh"));

    const ptyProcess = pty.spawn(defaultShell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    });

    const id = this.nextId++;
    this.instances.set(id, ptyProcess);
    return id;
  }

  write(id: number, data: string) {
    this.instances.get(id)?.write(data);
  }

  resize(id: number, cols: number, rows: number) {
    this.instances.get(id)?.resize(cols, rows);
  }

  onData(id: number, callback: (data: string) => void) {
    this.instances.get(id)?.onData(callback);
  }

  onExit(id: number, callback: (exitCode: number) => void) {
    this.instances.get(id)?.onExit(({ exitCode }) => callback(exitCode));
  }

  destroy(id: number) {
    const instance = this.instances.get(id);
    if (instance) {
      instance.kill();
      this.instances.delete(id);
    }
  }

  destroyAll() {
    for (const [id] of this.instances) {
      this.destroy(id);
    }
  }
}
