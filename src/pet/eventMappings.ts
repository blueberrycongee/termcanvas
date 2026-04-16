import type {
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../../shared/telemetry";
import type { AttentionPriority } from "./petStore";
import type { PetEvent } from "./stateMachine";

export interface PendingAttention {
  terminalId: string;
  label: string;
  priority: AttentionPriority;
  message: string;
}

const ATTENTION_MESSAGES: Record<AttentionPriority, string> = {
  error: "✗",
  stuck: "⚠",
  approval: "⏳",
  success: "✓",
};

function enteredState(
  prev: string | undefined,
  next: string | undefined,
  expected: string,
): boolean {
  return next === expected && prev !== expected;
}

export function samePetRelevantTelemetry(
  prev: TerminalTelemetrySnapshot | null | undefined,
  next: TerminalTelemetrySnapshot | null | undefined,
): boolean {
  return (
    prev?.turn_state === next?.turn_state &&
    prev?.derived_status === next?.derived_status &&
    prev?.workflow_id === next?.workflow_id &&
    prev?.repo_path === next?.repo_path
  );
}

export function isTelemetryProgressing(
  snapshot: TerminalTelemetrySnapshot | null | undefined,
): boolean {
  if (!snapshot) return false;
  return (
    snapshot.turn_state === "thinking" ||
    snapshot.turn_state === "in_turn" ||
    snapshot.turn_state === "tool_running" ||
    snapshot.turn_state === "tool_pending" ||
    snapshot.derived_status === "progressing" ||
    snapshot.derived_status === "awaiting_contract"
  );
}

export function shouldClearAttentionFromTelemetryTransition(
  prev: TerminalTelemetrySnapshot | null | undefined,
  next: TerminalTelemetrySnapshot | null | undefined,
): boolean {
  return isTelemetryProgressing(next) && !isTelemetryProgressing(prev);
}

export function derivePetEventFromTelemetryTransition(
  prev: TerminalTelemetrySnapshot | null | undefined,
  next: TerminalTelemetrySnapshot | null | undefined,
): PetEvent | null {
  if (!next) return null;

  if (enteredState(prev?.derived_status, next.derived_status, "error")) {
    return { type: "TASK_ERROR" };
  }

  if (enteredState(prev?.turn_state, next.turn_state, "awaiting_input")) {
    return { type: "WORKER_STUCK" };
  }

  if (
    enteredState(prev?.derived_status, next.derived_status, "stall_candidate")
  ) {
    return { type: "STALL" };
  }

  if (enteredState(prev?.turn_state, next.turn_state, "turn_complete")) {
    return { type: "TURN_COMPLETE" };
  }

  if (enteredState(prev?.turn_state, next.turn_state, "tool_running")) {
    return { type: "TOOL_RUNNING" };
  }

  if (enteredState(prev?.turn_state, next.turn_state, "tool_pending")) {
    return { type: "TOOL_PENDING" };
  }

  if (isTelemetryProgressing(next) && !isTelemetryProgressing(prev)) {
    return { type: "AGENT_THINKING" };
  }

  return null;
}

export function deriveAttentionFromTelemetryTransition(
  prev: TerminalTelemetrySnapshot | null | undefined,
  next: TerminalTelemetrySnapshot | null | undefined,
  context: {
    terminalId: string;
    label: string;
    focused: boolean;
    seenCompletion?: boolean;
  },
): PendingAttention | null {
  if (!next || context.focused) return null;

  let priority: AttentionPriority | null = null;

  if (enteredState(prev?.derived_status, next.derived_status, "error")) {
    priority = "error";
  } else if (
    enteredState(prev?.turn_state, next.turn_state, "awaiting_input") ||
    enteredState(prev?.derived_status, next.derived_status, "stall_candidate")
  ) {
    priority = "stuck";
  } else if (enteredState(prev?.turn_state, next.turn_state, "tool_pending")) {
    priority = "approval";
  } else if (enteredState(prev?.turn_state, next.turn_state, "turn_complete")) {
    priority = "success";
  }

  if (!priority) return null;
  if (priority === "success" && context.seenCompletion) return null;

  return {
    terminalId: context.terminalId,
    label: context.label,
    priority,
    message: `${ATTENTION_MESSAGES[priority]} ${context.label}`,
  };
}

export function derivePetEventFromWorkflowTransition(
  prev: WorkflowTelemetrySnapshot | null | undefined,
  next: WorkflowTelemetrySnapshot | null | undefined,
): PetEvent | null {
  if (!next) return null;

  if (enteredState(prev?.workflow_status, next.workflow_status, "failed")) {
    return { type: "DISPATCH_FAILED" };
  }

  if (
    enteredState(prev?.workflow_status, next.workflow_status, "completed")
  ) {
    return { type: "WORKFLOW_COMPLETED" };
  }

  if (enteredState(prev?.workflow_status, next.workflow_status, "active")) {
    return { type: "WORKFLOW_STARTED" };
  }

  return null;
}
