/**
 * Periodically reports VM status to a cloud API Gateway callback URL.
 */

interface HeartbeatPayload {
  workflow_status: string;
  current_handoff: string | null;
  telemetry_snapshot: unknown;
  resource_usage: {
    memory_mb: number;
    uptime_seconds: number;
  };
}

interface HeartbeatConfig {
  callbackUrl: string;
  intervalMs?: number;
  getPayload?: () => HeartbeatPayload;
}

const DEFAULT_INTERVAL_MS = 10_000;

export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly callbackUrl: string;
  private readonly intervalMs: number;
  private readonly getPayload: () => HeartbeatPayload;
  private readonly startTime = Date.now();

  constructor(config: HeartbeatConfig) {
    this.callbackUrl = config.callbackUrl;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.getPayload = config.getPayload ?? (() => this.defaultPayload());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Send first heartbeat immediately
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const payload = this.getPayload();
    try {
      const response = await fetch(this.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        console.error(
          `[heartbeat] callback returned ${response.status}: ${response.statusText}`,
        );
      }
    } catch (err) {
      console.error("[heartbeat] callback failed:", err);
    }
  }

  private defaultPayload(): HeartbeatPayload {
    const mem = process.memoryUsage();
    return {
      workflow_status: "running",
      current_handoff: null,
      telemetry_snapshot: null,
      resource_usage: {
        memory_mb: Math.round(mem.rss / (1024 * 1024)),
        uptime_seconds: Math.round((Date.now() - this.startTime) / 1000),
      },
    };
  }
}
