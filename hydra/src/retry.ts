import { HydraError } from "./errors.ts";
import type {
  DispatchCreateOnlyRequest,
  DispatchCreateOnlyResult,
} from "./dispatcher.ts";
import type { AssignmentManager } from "./assignment/manager.ts";
import type { AssignmentStateMachine } from "./assignment/state-machine.ts";
import type { AssignmentRecord, AssignmentRun } from "./assignment/types.ts";
import { captureRunShellPid } from "./process-identity.ts";

export interface RegisterDispatchAttemptInput {
  runId: string;
  terminalId: string;
  agentType: AssignmentRun["agent_type"];
  prompt: string;
  taskFile: string;
  resultFile: string;
  artifactDir: string;
  startedAt: string;
  retryOfRunId?: string;
}

export interface RetryTimedOutAssignmentInput {
  assignmentId: string;
  timeoutCheckedAt: string;
  dispatchRequest: DispatchCreateOnlyRequest;
  runId: string;
  taskFile: string;
  resultFile: string;
  artifactDir: string;
}

export interface RetryDependencies {
  manager: AssignmentManager;
  stateMachine: AssignmentStateMachine;
  dispatchCreateOnly(request: DispatchCreateOnlyRequest): Promise<DispatchCreateOnlyResult>;
  destroyTerminal?: (terminalId: string) => void;
  now?: () => string;
}

export type RetryOutcome =
  | { status: "noop" }
  | { status: "retried"; terminalId: string }
  | { status: "failed" };

function loadAssignmentOrThrow(manager: AssignmentManager, assignmentId: string): AssignmentRecord {
  const assignment = manager.load(assignmentId);
  if (!assignment) {
    throw new HydraError(`Assignment not found: ${assignmentId}`, {
      errorCode: "ASSIGNMENT_NOT_FOUND",
      stage: "retry.load_assignment",
      ids: { assignment_id: assignmentId },
    });
  }
  return assignment;
}

function lastRun(assignment: AssignmentRecord): AssignmentRun | undefined {
  return assignment.runs[assignment.runs.length - 1];
}

export function registerDispatchAttempt(
  manager: AssignmentManager,
  assignmentId: string,
  input: RegisterDispatchAttemptInput,
): AssignmentRecord {
  const assignment = loadAssignmentOrThrow(manager, assignmentId);
  assignment.runs.push({
    id: input.runId,
    terminal_id: input.terminalId,
    agent_type: input.agentType,
    prompt: input.prompt,
    task_file: input.taskFile,
    result_file: input.resultFile,
    artifact_dir: input.artifactDir,
    status: "running",
    started_at: input.startedAt,
    retry_of_run_id: input.retryOfRunId,
  });
  assignment.active_run_id = input.runId;
  assignment.updated_at = input.startedAt;
  manager.save(assignment);
  return assignment;
}

export function hasAssignmentTimedOut(
  assignment: AssignmentRecord,
  checkedAt: string,
): boolean {
  if (assignment.status !== "claimed" && assignment.status !== "in_progress") {
    return false;
  }
  if (!assignment.timeout_minutes || assignment.timeout_minutes <= 0) {
    return false;
  }

  const referenceTime = lastRun(assignment)?.started_at
    ?? assignment.status_updated_at
    ?? assignment.created_at;
  const checkedAtMs = Date.parse(checkedAt);
  const referenceMs = Date.parse(referenceTime);
  if (Number.isNaN(checkedAtMs) || Number.isNaN(referenceMs)) {
    return false;
  }
  return checkedAtMs - referenceMs > assignment.timeout_minutes * 60 * 1000;
}

function markLastRunTimedOut(
  manager: AssignmentManager,
  assignmentId: string,
  timedOutAt: string,
): AssignmentRecord {
  const assignment = loadAssignmentOrThrow(manager, assignmentId);
  const run = lastRun(assignment);
  if (run) {
    run.status = "timed_out";
    run.ended_at = timedOutAt;
    assignment.updated_at = timedOutAt;
    manager.save(assignment);
  }
  return assignment;
}

// Timeout and manual retries intentionally do NOT destroy the old terminal.
// Retry means "start a fresh run in a new terminal", not "kill the old one".
export async function retryTimedOutAssignment(
  input: RetryTimedOutAssignmentInput,
  dependencies: RetryDependencies,
): Promise<RetryOutcome> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const assignment = loadAssignmentOrThrow(dependencies.manager, input.assignmentId);

  if (!hasAssignmentTimedOut(assignment, input.timeoutCheckedAt)) {
    return { status: "noop" };
  }

  markLastRunTimedOut(dependencies.manager, input.assignmentId, input.timeoutCheckedAt);
  await dependencies.stateMachine.markTimedOut(input.assignmentId, {
    code: "ASSIGNMENT_TIMEOUT",
    message: `Assignment timed out after ${assignment.timeout_minutes} minute(s)`,
    stage: "retry.timeout_check",
  });

  const retryDecision = await dependencies.stateMachine.scheduleRetry(input.assignmentId);
  if (retryDecision.assignment.status === "failed") {
    return { status: "failed" };
  }

  const dispatchStartedAt = now();
  const retryTickId = `retry:${input.assignmentId}:${dispatchStartedAt}`;
  const previousRunId = lastRun(assignment)?.id;
  const claim = await dependencies.stateMachine.claimPending(
    input.assignmentId,
    retryTickId,
  );
  if (!claim.changed) {
    return { status: "noop" };
  }

  let dispatchedTerminalId: string | undefined;
  try {
    const dispatch = await dependencies.dispatchCreateOnly(input.dispatchRequest);
    dispatchedTerminalId = dispatch.terminalId;
    registerDispatchAttempt(dependencies.manager, input.assignmentId, {
      runId: input.runId,
      terminalId: dispatch.terminalId,
      agentType: dispatch.terminalType as AssignmentRun["agent_type"],
      prompt: dispatch.prompt,
      taskFile: input.taskFile,
      resultFile: input.resultFile,
      artifactDir: input.artifactDir,
      startedAt: dispatchStartedAt,
      retryOfRunId: previousRunId ?? undefined,
    });
    // Best-effort process identity capture — see workflow-lead.ts dispatch
    // for rationale. Retries get the same treatment so every in-flight run
    // in assignment.json carries a reconcile anchor.
    captureRunShellPid(dependencies.manager, input.assignmentId, input.runId);
    await dependencies.stateMachine.markInProgress(input.assignmentId, {
      tickId: retryTickId,
      runId: input.runId,
    });
    return {
      status: "retried",
      terminalId: dispatch.terminalId,
    };
  } catch (error) {
    if (dispatchedTerminalId) {
      try {
        dependencies.destroyTerminal?.(dispatchedTerminalId);
      } catch {}
    }
    await dependencies.stateMachine.markFailed(input.assignmentId, {
      code: "ASSIGNMENT_RETRY_DISPATCH_FAILED",
      message: error instanceof Error ? error.message : String(error),
      stage: "retry.dispatch",
    });
    return { status: "failed" };
  }
}
