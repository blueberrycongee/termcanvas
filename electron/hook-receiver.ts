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

export interface HookHealth {
  socketPath: string | null;
  lastEventAt: string | null;
  eventsReceived: number;
  parseErrors: number;
}

export function getHookSocketPath(
  platform: NodeJS.Platform = process.platform,
  pid: number = process.pid,
  tmpDir: string = os.tmpdir(),
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\termcanvas-${pid}`;
  }
  return `${tmpDir}/termcanvas-${pid}.sock`;
}

export class HookReceiver {
  private server: net.Server | null = null;
  private socketPath: string | null = null;
  private readonly onEvent: (event: HookEvent) => void;
  private cleanupRegistered = false;
  private eventsReceived = 0;
  private parseErrors = 0;
  private lastEventAt: string | null = null;

  constructor(onEvent: (event: HookEvent) => void) {
    this.onEvent = onEvent;
  }

  getHealth(): HookHealth {
    return {
      socketPath: this.socketPath,
      lastEventAt: this.lastEventAt,
      eventsReceived: this.eventsReceived,
      parseErrors: this.parseErrors,
    };
  }

  async start(): Promise<string> {
    const socketPath = getHookSocketPath();

    if (process.platform !== "win32") {
      // Remove stale unix socket from a previous crash.
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // No stale socket — fine
      }
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
            this.parseErrors++;
            return;
          }

          if (!parsed.terminal_id) {
            console.warn("[HookReceiver] Event missing terminal_id, skipping");
            this.parseErrors++;
            return;
          }

          if (!parsed.hook_event_name) {
            console.warn("[HookReceiver] Event missing hook_event_name, skipping");
            this.parseErrors++;
            return;
          }

          this.eventsReceived++;
          this.lastEventAt = new Date().toISOString();

          console.log(
            `[HookReceiver] ${parsed.hook_event_name} terminal=${parsed.terminal_id}` +
            (parsed.tool_name ? ` tool=${parsed.tool_name}` : "") +
            (parsed.session_id ? ` session=${parsed.session_id}` : "") +
            (parsed.error ? ` error=${parsed.error}` : ""),
          );
          this.onEvent(parsed as HookEvent);
        } catch (err) {
          this.parseErrors++;
          console.warn("[HookReceiver] Failed to parse hook event:", err);
        }
      });

      connection.on("error", () => {
        // Connection-level errors are non-fatal
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.server?.off("error", onError);
        console.error("[HookReceiver] Server error:", err);
        reject(err);
      };

      this.server!.once("error", onError);
      this.server!.listen(socketPath, () => {
        this.server?.off("error", onError);
        resolve();
      });
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
    if (process.platform === "win32") return;
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Already removed or doesn't exist
    }
  }
}
