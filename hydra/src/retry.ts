import { HydraError } from "./errors.ts";
import type {
  DispatchCreateOnlyRequest,
  DispatchCreateOnlyResult,
} from "./dispatcher.ts";
import type { HandoffManager } from "./handoff/manager.ts";
import type { HandoffStateMachine } from "./handoff/state-machine.ts";
import type { Handoff, HandoffDispatchAttempt } from "./handoff/types.ts";

export interface RegisterDispatchAttemptInput {
  terminalId: string;
  agentType: HandoffDispatchAttempt["agent_type"];
  prompt: string;
  startedAt: string;
  retryOf?: string;
}

export interface RetryTimedOutHandoffInput {
  handoffId: string;
  timeoutCheckedAt: string;
  dispatchRequest: DispatchCreateOnlyRequest;
}

export interface RetryDependencies {
  manager: HandoffManager;
  stateMachine: HandoffStateMachine;
  dispatchCreateOnly(request: DispatchCreateOnlyRequest): Promise<DispatchCreateOnlyResult>;
  now?: () => string;
}

export type RetryOutcome =
  | { status: "noop" }
  | { status: "retried"; terminalId: string }
  | { status: "failed" };

function loadHandoffOrThrow(manager: HandoffManager, handoffId: string): Handoff {
  const handoff = manager.load(handoffId);
  if (!handoff) {
    throw new HydraError(`Handoff not found: ${handoffId}`, {
      errorCode: "HANDOFF_NOT_FOUND",
      stage: "retry.load_handoff",
      ids: { handoff_id: handoffId },
    });
  }
  return handoff;
}

function lastAttempt(handoff: Handoff): HandoffDispatchAttempt | undefined {
  return handoff.dispatch?.attempts[handoff.dispatch.attempts.length - 1];
}

function ensureDispatchState(handoff: Handoff): NonNullable<Handoff["dispatch"]> {
  if (!handoff.dispatch) {
    handoff.dispatch = {
      active_terminal_id: null,
      attempts: [],
    };
  }
  return handoff.dispatch;
}

export function registerDispatchAttempt(
  manager: HandoffManager,
  handoffId: string,
  input: RegisterDispatchAttemptInput,
): Handoff {
  const handoff = loadHandoffOrThrow(manager, handoffId);
  const dispatch = ensureDispatchState(handoff);
  dispatch.attempts.push({
    attempt: dispatch.attempts.length + 1,
    terminal_id: input.terminalId,
    agent_type: input.agentType,
    prompt: input.prompt,
    started_at: input.startedAt,
    retry_of: input.retryOf,
  });
  dispatch.active_terminal_id = input.terminalId;
  manager.save(handoff);
  return handoff;
}

export function hasHandoffTimedOut(
  handoff: Handoff,
  checkedAt: string,
): boolean {
  if (
    handoff.status !== "claimed"
    && handoff.status !== "in_progress"
  ) {
    return false;
  }

  if (!handoff.timeout_minutes || handoff.timeout_minutes <= 0) {
    return false;
  }

  const referenceTime = lastAttempt(handoff)?.started_at
    ?? handoff.status_updated_at
    ?? handoff.created_at;
  const checkedAtMs = Date.parse(checkedAt);
  const referenceMs = Date.parse(referenceTime);

  if (Number.isNaN(checkedAtMs) || Number.isNaN(referenceMs)) {
    return false;
  }

  return checkedAtMs - referenceMs > handoff.timeout_minutes * 60 * 1000;
}

function markLastAttemptTimedOut(
  manager: HandoffManager,
  handoffId: string,
  timedOutAt: string,
): Handoff {
  const handoff = loadHandoffOrThrow(manager, handoffId);
  const attempt = lastAttempt(handoff);
  if (attempt) {
    attempt.timed_out_at = timedOutAt;
    manager.save(handoff);
  }
  return handoff;
}

// Note: timeout and manual retries intentionally do NOT destroy the old
// user may want to inspect it for diagnostics. Terminal cleanup happens
// via Cmd+D (SIGHUP to process group) or `hydra cleanup`.
export async function retryTimedOutHandoff(
  input: RetryTimedOutHandoffInput,
  dependencies: RetryDependencies,
): Promise<RetryOutcome> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const handoff = loadHandoffOrThrow(dependencies.manager, input.handoffId);

  if (!hasHandoffTimedOut(handoff, input.timeoutCheckedAt)) {
    return { status: "noop" };
  }

  markLastAttemptTimedOut(dependencies.manager, input.handoffId, input.timeoutCheckedAt);
  await dependencies.stateMachine.markTimedOut(input.handoffId, {
    code: "HANDOFF_TIMEOUT",
    message: `Handoff timed out after ${handoff.timeout_minutes} minute(s)`,
    stage: "retry.timeout_check",
  });

  const retryDecision = await dependencies.stateMachine.scheduleRetry(input.handoffId);
  if (retryDecision.handoff.status === "failed") {
    return { status: "failed" };
  }

  const dispatchStartedAt = now();
  const previousTerminalId = handoff.dispatch?.active_terminal_id ?? lastAttempt(handoff)?.terminal_id;
  try {
    const dispatch = await dependencies.dispatchCreateOnly(input.dispatchRequest);
    await dependencies.stateMachine.claimPending(
      input.handoffId,
      `retry:${input.handoffId}:${dispatchStartedAt}`,
    );
    await dependencies.stateMachine.markInProgress(input.handoffId, {
      tickId: `retry:${input.handoffId}:${dispatchStartedAt}`,
    });
    registerDispatchAttempt(dependencies.manager, input.handoffId, {
      terminalId: dispatch.terminalId,
      agentType: dispatch.terminalType as HandoffDispatchAttempt["agent_type"],
      prompt: dispatch.prompt,
      startedAt: dispatchStartedAt,
      retryOf: previousTerminalId ?? undefined,
    });
    return {
      status: "retried",
      terminalId: dispatch.terminalId,
    };
  } catch (error) {
    await dependencies.stateMachine.markFailed(input.handoffId, {
      code: "HANDOFF_RETRY_DISPATCH_FAILED",
      message: error instanceof Error ? error.message : String(error),
      stage: "retry.dispatch",
    });
    return {
      status: "failed",
    };
  }
}
