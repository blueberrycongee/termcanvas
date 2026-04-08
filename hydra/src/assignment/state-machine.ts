import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { HydraError } from "../errors.ts";
import { AssignmentManager } from "./manager.ts";
import type {
  AssignmentError,
  AssignmentRecord,
  AssignmentStatus,
  AssignmentTransition,
} from "./types.ts";

export interface StateMachineOptions {
  lockRetryMs?: number;
  lockTimeoutMs?: number;
  now?: () => string;
}

export interface MarkInProgressInput {
  tickId?: string;
  runId?: string;
}

export interface FailureInput {
  code: string;
  message: string;
  stage: string;
}

export interface StateTransitionResult {
  changed: boolean;
  assignment: AssignmentRecord;
}

export class AssignmentStateMachine {
  private readonly lockRetryMs: number;
  private readonly lockTimeoutMs: number;
  private readonly now: () => string;
  private readonly manager: AssignmentManager;

  constructor(
    manager: AssignmentManager,
    options: StateMachineOptions = {},
  ) {
    this.manager = manager;
    this.lockRetryMs = options.lockRetryMs ?? 5;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 500;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async claimPending(assignmentId: string, tickId: string): Promise<StateTransitionResult> {
    return this.withLockedAssignment(assignmentId, (assignment) => {
      if (assignment.status === "pending") {
        assignment.claim = {
          tick_id: tickId,
          claimed_at: this.now(),
        };
        this.applyTransition(assignment, "claimed", {
          event: "claim_pending",
          tick_id: tickId,
        });
        return { changed: true, assignment };
      }
      if (assignment.status === "claimed" && assignment.claim?.tick_id === tickId) {
        return { changed: false, assignment };
      }
      return { changed: false, assignment };
    });
  }

  async markInProgress(
    assignmentId: string,
    input: MarkInProgressInput = {},
  ): Promise<StateTransitionResult> {
    return this.withLockedAssignment(assignmentId, (assignment) => {
      if (assignment.status === "in_progress") {
        const sameTick = !input.tickId || assignment.claim?.tick_id === input.tickId;
        const sameRun = !input.runId || assignment.active_run_id === input.runId;
        if (sameTick && sameRun) {
          return { changed: false, assignment };
        }
      }

      if (assignment.status !== "claimed") {
        throw this.invalidTransition(assignment, "markInProgress", ["claimed"]);
      }
      if (input.tickId && assignment.claim?.tick_id !== input.tickId) {
        throw this.invalidTransition(assignment, "markInProgress", ["claimed"]);
      }

      this.applyTransition(assignment, "in_progress", {
        event: "mark_in_progress",
        tick_id: input.tickId,
        run_id: input.runId,
      });
      return { changed: true, assignment };
    });
  }

  async markCompleted(
    assignmentId: string,
    result: NonNullable<AssignmentRecord["result"]>,
  ): Promise<StateTransitionResult> {
    return this.withLockedAssignment(assignmentId, (assignment) => {
      if (assignment.status === "completed" && this.sameResult(assignment.result, result)) {
        return { changed: false, assignment };
      }
      if (assignment.status !== "claimed" && assignment.status !== "in_progress") {
        throw this.invalidTransition(assignment, "markCompleted", ["claimed", "in_progress"]);
      }

      assignment.claim = undefined;
      assignment.last_error = undefined;
      const activeRun = assignment.active_run_id
        ? assignment.runs.find((run) => run.id === assignment.active_run_id)
        : undefined;
      if (activeRun) {
        activeRun.status = "completed";
        activeRun.ended_at = result.completed_at ?? this.now();
      }
      assignment.result = {
        ...result,
        completed_at: result.completed_at ?? this.now(),
      };
      this.applyTransition(assignment, "completed", {
        event: "mark_completed",
        run_id: assignment.active_run_id ?? undefined,
      });
      return { changed: true, assignment };
    });
  }

  async markFailed(assignmentId: string, failure: FailureInput): Promise<StateTransitionResult> {
    return this.withLockedAssignment(assignmentId, (assignment) => {
      if (assignment.status === "failed" && this.sameFailure(assignment.last_error, failure, false)) {
        return { changed: false, assignment };
      }
      if (assignment.status === "completed") {
        throw this.invalidTransition(assignment, "markFailed", ["pending", "claimed", "in_progress", "timed_out"]);
      }

      assignment.claim = undefined;
      const activeRun = assignment.active_run_id
        ? assignment.runs.find((run) => run.id === assignment.active_run_id)
        : undefined;
      if (activeRun) {
        activeRun.status = "failed";
        activeRun.ended_at = this.now();
      }
      assignment.last_error = this.buildFailure(failure, false);
      this.applyTransition(assignment, "failed", {
        event: "mark_failed",
        run_id: assignment.active_run_id ?? undefined,
      });
      return { changed: true, assignment };
    });
  }

  async markTimedOut(assignmentId: string, failure: FailureInput): Promise<StateTransitionResult> {
    return this.withLockedAssignment(assignmentId, (assignment) => {
      if (assignment.status === "timed_out" && this.sameFailure(assignment.last_error, failure, true)) {
        return { changed: false, assignment };
      }
      if (assignment.status !== "claimed" && assignment.status !== "in_progress") {
        throw this.invalidTransition(assignment, "markTimedOut", ["claimed", "in_progress"]);
      }

      const activeRun = assignment.active_run_id
        ? assignment.runs.find((run) => run.id === assignment.active_run_id)
        : undefined;
      if (activeRun) {
        activeRun.status = "timed_out";
        activeRun.ended_at = this.now();
      }
      assignment.last_error = this.buildFailure(failure, true);
      this.applyTransition(assignment, "timed_out", {
        event: "mark_timed_out",
        run_id: assignment.active_run_id ?? undefined,
      });
      return { changed: true, assignment };
    });
  }

  async scheduleRetry(assignmentId: string): Promise<StateTransitionResult> {
    return this.withLockedAssignment(assignmentId, (assignment) => {
      if (assignment.status !== "timed_out") {
        throw this.invalidTransition(assignment, "scheduleRetry", ["timed_out"]);
      }

      if (assignment.retry_count >= assignment.max_retries) {
        assignment.claim = undefined;
        assignment.last_error = {
          code: "ASSIGNMENT_RETRY_LIMIT_EXCEEDED",
          message: `Retry limit reached for ${assignment.id}`,
          stage: "assignment.scheduleRetry",
          retryable: false,
          at: this.now(),
        };
        this.applyTransition(assignment, "failed", { event: "retry_exhausted" });
        return { changed: true, assignment };
      }

      assignment.retry_count += 1;
      assignment.claim = undefined;
      assignment.last_error = undefined;
      assignment.result = undefined;
      assignment.active_run_id = null;
      this.applyTransition(assignment, "pending", { event: "schedule_retry" });
      return { changed: true, assignment };
    });
  }

  private async withLockedAssignment(
    assignmentId: string,
    work: (assignment: AssignmentRecord) => StateTransitionResult,
  ): Promise<StateTransitionResult> {
    const assignmentPath = this.manager.getAssignmentPath(assignmentId);
    const lockPath = `${assignmentPath}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      let lockFd: number | undefined;
      try {
        lockFd = fs.openSync(lockPath, "wx");
        const assignment = this.manager.load(assignmentId);
        if (!assignment) {
          throw new HydraError(`Assignment not found: ${assignmentId}`, {
            errorCode: "ASSIGNMENT_NOT_FOUND",
            stage: "assignment.load",
            ids: { assignment_id: assignmentId },
          });
        }

        this.ensureStateTracking(assignment);
        const result = work(assignment);
        if (result.changed) {
          assignment.updated_at = this.now();
          this.manager.save(assignment);
        }
        return result;
      } catch (error: unknown) {
        if (this.isLockBusyError(error) && Date.now() < deadline) {
          await delay(this.lockRetryMs);
          continue;
        }
        if (this.isLockBusyError(error)) {
          throw new HydraError(`Timed out waiting for assignment lock: ${assignmentId}`, {
            errorCode: "ASSIGNMENT_LOCK_TIMEOUT",
            stage: "assignment.lock",
            ids: { assignment_id: assignmentId },
          });
        }
        throw error;
      } finally {
        if (lockFd !== undefined) {
          fs.closeSync(lockFd);
          try {
            fs.unlinkSync(lockPath);
          } catch {}
        }
      }
    }
  }

  private ensureStateTracking(assignment: AssignmentRecord): void {
    assignment.transitions = assignment.transitions ?? [];
  }

  private applyTransition(
    assignment: AssignmentRecord,
    to: AssignmentStatus,
    details: Pick<AssignmentTransition, "event" | "tick_id" | "run_id">,
  ): void {
    const from = assignment.status;
    assignment.status = to;
    assignment.status_updated_at = this.now();
    assignment.transitions = assignment.transitions ?? [];
    assignment.transitions.push({
      event: details.event,
      from,
      to,
      at: assignment.status_updated_at,
      tick_id: details.tick_id,
      run_id: details.run_id,
    });
  }

  private buildFailure(failure: FailureInput, retryable: boolean): AssignmentError {
    return {
      code: failure.code,
      message: failure.message,
      stage: failure.stage,
      retryable,
      at: this.now(),
    };
  }

  private sameFailure(
    current: AssignmentError | undefined,
    next: FailureInput,
    retryable: boolean,
  ): boolean {
    return current?.code === next.code
      && current?.message === next.message
      && current?.stage === next.stage
      && current?.retryable === retryable;
  }

  private sameResult(
    current: AssignmentRecord["result"] | undefined,
    next: NonNullable<AssignmentRecord["result"]>,
  ): boolean {
    return JSON.stringify(current) === JSON.stringify(next);
  }

  private invalidTransition(
    assignment: AssignmentRecord,
    action: string,
    expected: AssignmentStatus[],
  ): HydraError {
    return new HydraError(
      `Invalid assignment transition for ${assignment.id}: cannot ${action} from ${assignment.status}; expected ${expected.join(" or ")}`,
      {
        errorCode: "ASSIGNMENT_INVALID_TRANSITION",
        stage: "assignment.transition",
        ids: {
          assignment_id: assignment.id,
          workflow_id: assignment.workflow_id,
        },
      },
    );
  }

  private isLockBusyError(error: unknown): boolean {
    return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
  }
}
