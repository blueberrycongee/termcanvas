/**
 * Worker lifecycle state machine.
 *
 * Tracks dispatched terminal workers so the agent loop can
 * auto-check telemetry and inject state-change notifications
 * into the conversation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkerStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "needs_approval";

export interface WorkerState {
  terminalId: string;
  status: WorkerStatus;
  startTime: number;
  endTime?: number;
  lastCheckedAt: number;
  notified: boolean;
}

export interface WorkerStateChange {
  terminalId: string;
  from: WorkerStatus;
  to: WorkerStatus;
}

export type TelemetryCheckFn = (
  terminalId: string,
) => Promise<{ status: WorkerStatus }>;

// ---------------------------------------------------------------------------
// Terminal statuses — no further transitions possible
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ReadonlySet<WorkerStatus> = new Set([
  "completed",
  "failed",
]);

// ---------------------------------------------------------------------------
// WorkerTracker
// ---------------------------------------------------------------------------

export class WorkerTracker {
  private workers = new Map<string, WorkerState>();

  register(terminalId: string): void {
    this.workers.set(terminalId, {
      terminalId,
      status: "pending",
      startTime: Date.now(),
      lastCheckedAt: Date.now(),
      notified: false,
    });
  }

  update(terminalId: string, status: WorkerStatus): void {
    const worker = this.workers.get(terminalId);
    if (!worker) return;

    worker.status = status;
    if (TERMINAL_STATUSES.has(status)) {
      worker.endTime = Date.now();
    }
  }

  async checkAll(fn: TelemetryCheckFn): Promise<WorkerStateChange[]> {
    const changes: WorkerStateChange[] = [];

    for (const [, worker] of this.workers) {
      if (TERMINAL_STATUSES.has(worker.status)) continue;

      try {
        const result = await fn(worker.terminalId);
        worker.lastCheckedAt = Date.now();

        if (result.status !== worker.status) {
          const from = worker.status;
          worker.status = result.status;
          if (TERMINAL_STATUSES.has(result.status)) {
            worker.endTime = Date.now();
          }
          changes.push({ terminalId: worker.terminalId, from, to: result.status });
        }
      } catch {
        // Telemetry check failed — skip this worker, try next turn
      }
    }

    return changes;
  }

  activeCount(): number {
    let count = 0;
    for (const [, worker] of this.workers) {
      if (!TERMINAL_STATUSES.has(worker.status)) {
        count++;
      }
    }
    return count;
  }

  all(): WorkerState[] {
    return [...this.workers.values()];
  }
}
