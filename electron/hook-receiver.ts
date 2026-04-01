import net from "node:net";
import fs from "node:fs";
import os from "node:os";

export interface HookEvent {
  terminal_id: string;
  session_id?: string;
  hook_event_name: string;
  cwd?: string;
  [key: string]: unknown;
}

export class HookReceiver {
  private server: net.Server | null = null;
  private socketPath: string | null = null;
  private readonly onEvent: (event: HookEvent) => void;
  private cleanupRegistered = false;

  constructor(onEvent: (event: HookEvent) => void) {
    this.onEvent = onEvent;
  }

  async start(): Promise<string> {
    const socketPath = `${os.tmpdir()}/termcanvas-${process.pid}.sock`;

    // Remove stale socket from previous crash
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // No stale socket — fine
    }

    this.server = net.createServer((connection) => {
      const chunks: Buffer[] = [];

      connection.on("data", (chunk) => {
        chunks.push(chunk);
      });

      connection.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf-8");
          const parsed = JSON.parse(raw);

          if (!parsed || typeof parsed !== "object") {
            console.warn("[HookReceiver] Received non-object JSON, skipping");
            return;
          }

          if (!parsed.terminal_id) {
            console.warn("[HookReceiver] Event missing terminal_id, skipping");
            return;
          }

          if (!parsed.hook_event_name) {
            console.warn("[HookReceiver] Event missing hook_event_name, skipping");
            return;
          }

          this.onEvent(parsed as HookEvent);
        } catch (err) {
          console.warn("[HookReceiver] Failed to parse hook event:", err);
        }
      });

      connection.on("error", () => {
        // Connection-level errors are non-fatal
      });
    });

    this.server.on("error", (err) => {
      console.error("[HookReceiver] Server error:", err);
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(socketPath, () => resolve());
    });
    this.socketPath = socketPath;

    if (!this.cleanupRegistered) {
      this.cleanupRegistered = true;
      const cleanup = () => this.removeSocket();
      process.on("exit", cleanup);
      process.on("SIGINT", () => { cleanup(); process.exit(0); });
      process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    }

    return socketPath;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.removeSocket();
  }

  getSocketPath(): string | null {
    return this.socketPath;
  }

  private removeSocket(): void {
    if (!this.socketPath) return;
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Already removed or doesn't exist
    }
  }
}
