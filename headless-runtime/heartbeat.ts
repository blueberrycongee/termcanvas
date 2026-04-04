/**
 * Periodically reports VM status to a cloud API Gateway callback URL.
 */

import {
  NotificationTransport,
  type JsonNotificationSender,
} from "./notification-transport.ts";

export interface HeartbeatPayload {
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
  sender?: JsonNotificationSender;
  secret?: string;
}

const DEFAULT_INTERVAL_MS = 10_000;

export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly callbackUrl: string;
  private readonly intervalMs: number;
  private readonly getPayload: () => HeartbeatPayload;
  private readonly startTime = Date.now();
  private readonly sender: JsonNotificationSender;

  constructor(config: HeartbeatConfig) {
    this.callbackUrl = config.callbackUrl;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.getPayload = config.getPayload ?? (() => this.defaultPayload());
    this.sender =
      config.sender ?? new NotificationTransport({ secret: config.secret });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sender.stop();
  }

  private tick(): void {
    this.sender.sendJson({
      url: this.callbackUrl,
      label: "heartbeat",
      payload: this.getPayload(),
    });
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
