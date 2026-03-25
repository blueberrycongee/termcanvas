import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { HydraError } from "../errors.ts";
import { HandoffManager } from "./manager.ts";
import type {
  Handoff,
  HandoffError,
  HandoffStatus,
  HandoffTransition,
} from "./types.ts";

export interface StateMachineOptions {
  lockRetryMs?: number;
  lockTimeoutMs?: number;
  now?: () => string;
}

export interface MarkInProgressInput {
  tickId?: string;
  agentId?: string;
}

export interface FailureInput {
  code: string;
  message: string;
  stage: string;
}

export interface StateTransitionResult {
  changed: boolean;
  handoff: Handoff;
}

export class HandoffStateMachine {
  private readonly manager: HandoffManager;
  private readonly lockRetryMs: number;
  private readonly lockTimeoutMs: number;
  private readonly now: () => string;

  constructor(
    manager: HandoffManager,
    options: StateMachineOptions = {},
  ) {
    this.manager = manager;
    this.lockRetryMs = options.lockRetryMs ?? 5;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 500;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async claimPending(handoffId: string, tickId: string): Promise<StateTransitionResult> {
    return this.withLockedHandoff(handoffId, (handoff) => {
      if (handoff.status === "pending") {
        handoff.claim = {
          tick_id: tickId,
          claimed_at: this.now(),
        };
        this.applyTransition(handoff, "claimed", {
          event: "claim_pending",
          tick_id: tickId,
        });
        return { changed: true, handoff };
      }

      if (handoff.status === "claimed" && handoff.claim?.tick_id === tickId) {
        return { changed: false, handoff };
      }

      return { changed: false, handoff };
    });
  }

  async markInProgress(
    handoffId: string,
    input: MarkInProgressInput = {},
  ): Promise<StateTransitionResult> {
    return this.withLockedHandoff(handoffId, (handoff) => {
      if (handoff.status === "in_progress") {
        const sameTick = !input.tickId || handoff.claim?.tick_id === input.tickId;
        const sameAgent = !input.agentId || handoff.to.agent_id === input.agentId;
        if (sameTick && sameAgent) {
          return { changed: false, handoff };
        }
      }

      if (handoff.status !== "claimed") {
        throw this.invalidTransition(handoff, "markInProgress", ["claimed"]);
      }

      if (input.tickId && handoff.claim?.tick_id !== input.tickId) {
        throw this.invalidTransition(handoff, "markInProgress", ["claimed"]);
      }

      if (input.agentId) {
        handoff.to = {
          ...handoff.to,
          agent_id: input.agentId,
        };
      }

      this.applyTransition(handoff, "in_progress", {
        event: "mark_in_progress",
        tick_id: input.tickId,
        agent_id: input.agentId,
      });
      return { changed: true, handoff };
    });
  }

  async markCompleted(
    handoffId: string,
    result: NonNullable<Handoff["result"]>,
  ): Promise<StateTransitionResult> {
    return this.withLockedHandoff(handoffId, (handoff) => {
      if (handoff.status === "completed" && this.sameResult(handoff.result, result)) {
        return { changed: false, handoff };
      }

      if (handoff.status !== "claimed" && handoff.status !== "in_progress") {
        throw this.invalidTransition(handoff, "markCompleted", ["claimed", "in_progress"]);
      }

      handoff.claim = undefined;
      handoff.last_error = undefined;
      handoff.result = {
        ...result,
        completed_at: result.completed_at ?? this.now(),
      };
      this.applyTransition(handoff, "completed", {
        event: "mark_completed",
        agent_id: handoff.to.agent_id ?? undefined,
      });
      return { changed: true, handoff };
    });
  }

  async markFailed(
    handoffId: string,
    failure: FailureInput,
  ): Promise<StateTransitionResult> {
    return this.withLockedHandoff(handoffId, (handoff) => {
      if (handoff.status === "failed" && this.sameFailure(handoff.last_error, failure, false)) {
        return { changed: false, handoff };
      }

      if (handoff.status === "completed") {
        throw this.invalidTransition(handoff, "markFailed", ["pending", "claimed", "in_progress", "timed_out"]);
      }

      handoff.claim = undefined;
      handoff.last_error = this.buildFailure(failure, false);
      this.applyTransition(handoff, "failed", {
        event: "mark_failed",
        agent_id: handoff.to.agent_id ?? undefined,
      });
      return { changed: true, handoff };
    });
  }

  async markTimedOut(
    handoffId: string,
    failure: FailureInput,
  ): Promise<StateTransitionResult> {
    return this.withLockedHandoff(handoffId, (handoff) => {
      if (handoff.status === "timed_out" && this.sameFailure(handoff.last_error, failure, true)) {
        return { changed: false, handoff };
      }

      if (handoff.status !== "claimed" && handoff.status !== "in_progress") {
        throw this.invalidTransition(handoff, "markTimedOut", ["claimed", "in_progress"]);
      }

      handoff.last_error = this.buildFailure(failure, true);
      this.applyTransition(handoff, "timed_out", {
        event: "mark_timed_out",
        agent_id: handoff.to.agent_id ?? undefined,
      });
      return { changed: true, handoff };
    });
  }

  async scheduleRetry(handoffId: string): Promise<StateTransitionResult> {
    return this.withLockedHandoff(handoffId, (handoff) => {
      if (handoff.status !== "timed_out") {
        throw this.invalidTransition(handoff, "scheduleRetry", ["timed_out"]);
      }

      if (handoff.retry_count >= handoff.max_retries) {
        handoff.claim = undefined;
        handoff.last_error = {
          code: "HANDOFF_RETRY_LIMIT_EXCEEDED",
          message: `Retry limit reached for ${handoff.id}`,
          stage: "handoff.scheduleRetry",
          retryable: false,
          at: this.now(),
        };
        this.applyTransition(handoff, "failed", {
          event: "retry_exhausted",
        });
        return { changed: true, handoff };
      }

      handoff.retry_count += 1;
      handoff.claim = undefined;
      handoff.last_error = undefined;
      handoff.result = undefined;
      handoff.to = {
        ...handoff.to,
        agent_id: null,
      };
      this.applyTransition(handoff, "pending", {
        event: "schedule_retry",
      });
      return { changed: true, handoff };
    });
  }

  private async withLockedHandoff(
    handoffId: string,
    work: (handoff: Handoff) => StateTransitionResult,
  ): Promise<StateTransitionResult> {
    const handoffPath = this.manager.getHandoffPath(handoffId);
    const lockPath = `${handoffPath}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      let lockFd: number | undefined;
      try {
        lockFd = fs.openSync(lockPath, "wx");
        const handoff = this.manager.load(handoffId);
        if (!handoff) {
          throw new HydraError(`Handoff not found: ${handoffId}`, {
            errorCode: "HANDOFF_NOT_FOUND",
            stage: "handoff.load",
            ids: { handoff_id: handoffId },
          });
        }

        this.ensureStateTracking(handoff);
        const result = work(handoff);
        if (result.changed) {
          this.manager.save(handoff);
        }
        return result;
      } catch (error: unknown) {
        if (this.isLockBusyError(error) && Date.now() < deadline) {
          await delay(this.lockRetryMs);
          continue;
        }
        if (this.isLockBusyError(error)) {
          throw new HydraError(`Timed out waiting for handoff lock: ${handoffId}`, {
            errorCode: "HANDOFF_LOCK_TIMEOUT",
            stage: "handoff.lock",
            ids: { handoff_id: handoffId },
          });
        }
        throw error;
      } finally {
        if (lockFd !== undefined) {
          fs.closeSync(lockFd);
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // lock was never acquired or already removed
        }
      }
    }
  }

  private ensureStateTracking(handoff: Handoff): void {
    if (!handoff.status_updated_at) {
      handoff.status_updated_at = handoff.created_at;
    }
    if (!handoff.transitions) {
      handoff.transitions = [];
    }
  }

  private applyTransition(
    handoff: Handoff,
    nextStatus: HandoffStatus,
    transition: Omit<HandoffTransition, "from" | "to" | "at">,
  ): void {
    this.ensureStateTracking(handoff);
    const at = this.now();
    handoff.transitions!.push({
      ...transition,
      from: handoff.status,
      to: nextStatus,
      at,
    });
    handoff.status = nextStatus;
    handoff.status_updated_at = at;
  }

  private buildFailure(input: FailureInput, retryable: boolean): HandoffError {
    return {
      ...input,
      retryable,
      at: this.now(),
    };
  }

  private sameFailure(
    previous: HandoffError | undefined,
    next: FailureInput,
    retryable: boolean,
  ): boolean {
    return (
      previous?.code === next.code
      && previous.message === next.message
      && previous.stage === next.stage
      && previous.retryable === retryable
    );
  }

  private sameResult(
    previous: Handoff["result"] | undefined,
    next: NonNullable<Handoff["result"]>,
  ): boolean {
    if (!previous) return false;
    return (
      previous.success === next.success
      && previous.message === next.message
      && JSON.stringify(previous.output_files ?? []) === JSON.stringify(next.output_files ?? [])
    );
  }

  private invalidTransition(
    handoff: Handoff,
    action: string,
    allowedStatuses: HandoffStatus[],
  ): HydraError {
    return new HydraError(
      `Cannot ${action} from ${handoff.status}; expected ${allowedStatuses.join(", ")}`,
      {
        errorCode: "HANDOFF_INVALID_TRANSITION",
        stage: `handoff.${action}`,
        ids: {
          handoff_id: handoff.id,
          workflow_id: handoff.workflow_id,
          current_status: handoff.status,
        },
      },
    );
  }

  private isLockBusyError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "EEXIST";
  }
}
