import type { TerminalStatus } from "../types";

export type TerminalProcessPhase = "idle" | "spawning" | "running" | "exited";
export type TerminalActivityPhase = "none" | "active" | "waiting";
export type TerminalTurnPhase = "none" | "completed";
export type TerminalExitKind = "none" | "success" | "error" | "killed";

export interface TerminalLifecycleState {
  processPhase: TerminalProcessPhase;
  activityPhase: TerminalActivityPhase;
  turnPhase: TerminalTurnPhase;
  exitKind: TerminalExitKind;
}

export type TerminalLifecycleEvent =
  | { type: "spawn_requested" }
  | { type: "spawn_succeeded" }
  | { type: "spawn_failed" }
  | { type: "output_received" }
  | { type: "waiting_timeout" }
  | { type: "turn_completed" }
  | { type: "process_exited_success" }
  | { type: "process_exited_error" }
  | { type: "hook_failed" }
  | { type: "destroy_requested" };

export type TerminalLifecycleReaction =
  | "schedule_waiting_timeout"
  | "clear_waiting_timeout";

export const IDLE_LIFECYCLE_STATE: TerminalLifecycleState = {
  processPhase: "idle",
  activityPhase: "none",
  turnPhase: "none",
  exitKind: "none",
};

export function hydrateLifecycleFromPublicStatus(
  status: TerminalStatus,
): TerminalLifecycleState {
  switch (status) {
    case "running":
      return {
        processPhase: "running",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "none",
      };
    case "active":
      return {
        processPhase: "running",
        activityPhase: "active",
        turnPhase: "none",
        exitKind: "none",
      };
    case "waiting":
      return {
        processPhase: "running",
        activityPhase: "waiting",
        turnPhase: "none",
        exitKind: "none",
      };
    case "completed":
      return {
        processPhase: "running",
        activityPhase: "none",
        turnPhase: "completed",
        exitKind: "none",
      };
    case "success":
      return {
        processPhase: "exited",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "success",
      };
    case "error":
      return {
        processPhase: "running",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "error",
      };
    case "idle":
    default:
      return { ...IDLE_LIFECYCLE_STATE };
  }
}

export function derivePublicTerminalStatus(
  state: TerminalLifecycleState,
): TerminalStatus {
  if (state.exitKind === "success") {
    return "success";
  }
  if (state.exitKind === "error" || state.exitKind === "killed") {
    return "error";
  }
  if (state.turnPhase === "completed") {
    return "completed";
  }
  if (state.processPhase === "running" && state.activityPhase === "waiting") {
    return "waiting";
  }
  if (state.processPhase === "running" && state.activityPhase === "active") {
    return "active";
  }
  if (state.processPhase === "running") {
    return "running";
  }
  return "idle";
}

export function canCompleteTerminalTurn(
  state: TerminalLifecycleState,
): boolean {
  return (
    state.processPhase === "running" &&
    (state.activityPhase === "active" || state.activityPhase === "waiting") &&
    state.exitKind === "none"
  );
}

export function transitionLifecycle(
  state: TerminalLifecycleState,
  event: TerminalLifecycleEvent,
): TerminalLifecycleState {
  switch (event.type) {
    case "spawn_requested":
      return {
        processPhase: "spawning",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "none",
      };
    case "spawn_succeeded":
      if (state.processPhase !== "spawning") {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase} -> spawn_succeeded`,
        );
      }
      return {
        processPhase: "running",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "none",
      };
    case "spawn_failed":
      if (state.processPhase !== "spawning") {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase} -> spawn_failed`,
        );
      }
      return {
        processPhase: "exited",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "error",
      };
    case "output_received":
      if (state.processPhase !== "running") {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase} -> output_received`,
        );
      }
      return {
        processPhase: "running",
        activityPhase: "active",
        turnPhase: "none",
        exitKind: "none",
      };
    case "waiting_timeout":
      if (
        state.processPhase !== "running" ||
        state.activityPhase !== "active"
      ) {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase}/${state.activityPhase} -> waiting_timeout`,
        );
      }
      return {
        ...state,
        activityPhase: "waiting",
      };
    case "turn_completed":
      if (
        state.processPhase !== "running" ||
        (state.activityPhase !== "active" && state.activityPhase !== "waiting")
      ) {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase}/${state.activityPhase} -> turn_completed`,
        );
      }
      return {
        ...state,
        turnPhase: "completed",
      };
    case "process_exited_success":
      if (
        state.processPhase !== "running" &&
        state.processPhase !== "spawning"
      ) {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase} -> process_exited_success`,
        );
      }
      return {
        processPhase: "exited",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "success",
      };
    case "process_exited_error":
      if (
        state.processPhase !== "running" &&
        state.processPhase !== "spawning"
      ) {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase} -> process_exited_error`,
        );
      }
      return {
        processPhase: "exited",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "error",
      };
    case "hook_failed":
      if (state.processPhase !== "running") {
        throw new Error(
          `Illegal terminal lifecycle transition: ${state.processPhase} -> hook_failed`,
        );
      }
      return {
        ...state,
        turnPhase: "none",
        exitKind: "error",
      };
    case "destroy_requested":
      return {
        processPhase: "exited",
        activityPhase: "none",
        turnPhase: "none",
        exitKind: "killed",
      };
    default:
      return state;
  }
}

export function getLifecycleReactions(
  prev: TerminalLifecycleState,
  next: TerminalLifecycleState,
  event: TerminalLifecycleEvent,
): TerminalLifecycleReaction[] {
  const reactions = new Set<TerminalLifecycleReaction>();

  if (
    event.type === "spawn_requested" ||
    event.type === "spawn_failed" ||
    event.type === "process_exited_success" ||
    event.type === "process_exited_error" ||
    event.type === "destroy_requested"
  ) {
    reactions.add("clear_waiting_timeout");
  }

  if (event.type === "output_received") {
    reactions.add("clear_waiting_timeout");
    reactions.add("schedule_waiting_timeout");
  }

  if (
    prev.activityPhase === "active" &&
    next.activityPhase === "waiting"
  ) {
    reactions.add("clear_waiting_timeout");
  }

  return [...reactions];
}
