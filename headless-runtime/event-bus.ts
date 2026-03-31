import { EventEmitter } from "node:events";

export type ServerEventType =
  | "terminal_created"
  | "terminal_destroyed"
  | "terminal_output"
  | "terminal_status_changed"
  | "workflow_started"
  | "workflow_completed"
  | "workflow_failed"
  | "server_started"
  | "server_stopping";

export interface ServerEvent {
  type: ServerEventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

const MAX_RECENT_EVENTS = 100;
const MAX_TERMINAL_EVENTS = 200;
const MAX_TERMINAL_BUFFERS = 100;

export class ServerEventBus {
  private readonly emitter = new EventEmitter();
  private readonly recentEvents: ServerEvent[] = [];
  private readonly terminalEvents = new Map<string, ServerEvent[]>();

  emit(type: ServerEventType, payload: Record<string, unknown>): void {
    const event: ServerEvent = { type, timestamp: Date.now(), payload };
    if (type !== "terminal_output" && type !== "terminal_status_changed") {
      this.recentEvents.push(event);
      if (this.recentEvents.length > MAX_RECENT_EVENTS) {
        this.recentEvents.shift();
      }
    }

    const terminalId =
      typeof payload.terminalId === "string" ? payload.terminalId : null;
    if (terminalId) {
      const stream = this.ensureTerminalBuffer(terminalId);
      stream.push(event);
      if (stream.length > MAX_TERMINAL_EVENTS) {
        stream.shift();
      }
    }

    this.emitter.emit(type, event);
    this.emitter.emit("*", event);
  }

  on(type: ServerEventType | "*", listener: (event: ServerEvent) => void): void {
    this.emitter.on(type, listener);
  }

  off(type: ServerEventType | "*", listener: (event: ServerEvent) => void): void {
    this.emitter.off(type, listener);
  }

  getRecentEvents(limit = 50): ServerEvent[] {
    return this.recentEvents.slice(-limit);
  }

  getTerminalEvents(terminalId: string, limit = 50): ServerEvent[] {
    return (this.terminalEvents.get(terminalId) ?? []).slice(-limit);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  private ensureTerminalBuffer(terminalId: string): ServerEvent[] {
    const existing = this.terminalEvents.get(terminalId);
    if (existing) {
      return existing;
    }

    if (this.terminalEvents.size >= MAX_TERMINAL_BUFFERS) {
      const oldestKey = this.terminalEvents.keys().next().value;
      if (oldestKey) {
        this.terminalEvents.delete(oldestKey);
      }
    }

    const stream: ServerEvent[] = [];
    this.terminalEvents.set(terminalId, stream);
    return stream;
  }
}
