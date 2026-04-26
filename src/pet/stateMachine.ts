export type PetState =
  | "idle"
  | "sleeping"
  | "waking"
  | "curious"
  | "working"
  | "waiting"
  | "celebrating"
  | "worried"
  | "confused"
  | "commanding"
  | "triumph"
  | "walking";

export type PetEvent =
  | { type: "TERMINAL_CREATED" }
  | { type: "TERMINAL_DESTROYED" }
  | { type: "AGENT_THINKING" }
  | { type: "TOOL_RUNNING" }
  | { type: "TOOL_PENDING" }
  | { type: "TURN_COMPLETE" }
  | { type: "TASK_SUCCESS" }
  | { type: "TASK_ERROR" }
  | { type: "STALL" }
  | { type: "WORKER_STUCK" }
  | { type: "WORKFLOW_STARTED" }
  | { type: "WORKFLOW_COMPLETED" }
  | { type: "DISPATCH_FAILED" }
  | { type: "APP_IDLE" }
  | { type: "CLICK" }
  | { type: "TIMER"; elapsed: number };

export interface PetStateInfo {
  state: PetState;
  enteredAt: number;
  previousState: PetState;
}

const SLEEP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes idle → sleep
const CELEBRATE_DURATION_MS = 3000;
const WORRIED_DURATION_MS = 4000;
const CURIOUS_DURATION_MS = 2000;
const TRIUMPH_DURATION_MS = 5000;
const WAKING_DURATION_MS = 1500;

export function transition(info: PetStateInfo, event: PetEvent): PetState {
  const { state } = info;
  const elapsed = event.type === "TIMER" ? event.elapsed : 0;

  // CLICK while idle/sleeping → waking
  if (event.type === "CLICK") {
    if (state === "sleeping") return "waking";
    if (state === "idle") return "curious";
    return state;
  }

  switch (state) {
    case "sleeping":
      if (event.type === "TERMINAL_CREATED") return "waking";
      if (event.type === "AGENT_THINKING") return "waking";
      if (event.type === "WORKFLOW_STARTED") return "waking";
      return "sleeping";

    case "waking":
      if (event.type === "TIMER" && elapsed >= WAKING_DURATION_MS) return "idle";
      if (event.type === "AGENT_THINKING") return "working";
      if (event.type === "WORKFLOW_STARTED") return "commanding";
      return "waking";

    case "idle":
      if (event.type === "TERMINAL_CREATED") return "curious";
      if (event.type === "AGENT_THINKING") return "working";
      if (event.type === "TOOL_RUNNING") return "working";
      if (event.type === "WORKFLOW_STARTED") return "commanding";
      if (event.type === "TASK_ERROR") return "worried";
      if (event.type === "TIMER" && elapsed >= SLEEP_THRESHOLD_MS) return "sleeping";
      return "idle";

    case "curious":
      if (event.type === "AGENT_THINKING") return "working";
      if (event.type === "TIMER" && elapsed >= CURIOUS_DURATION_MS) return "idle";
      return "curious";

    case "working":
      if (event.type === "TOOL_PENDING") return "waiting";
      if (event.type === "TASK_SUCCESS") return "celebrating";
      if (event.type === "TURN_COMPLETE") return "celebrating";
      if (event.type === "TASK_ERROR") return "worried";
      if (event.type === "WORKER_STUCK") return "confused";
      if (event.type === "STALL") return "confused";
      if (event.type === "WORKFLOW_STARTED") return "commanding";
      return "working";

    case "waiting":
      if (event.type === "TOOL_RUNNING") return "working";
      if (event.type === "AGENT_THINKING") return "working";
      if (event.type === "TASK_SUCCESS") return "celebrating";
      if (event.type === "TASK_ERROR") return "worried";
      if (event.type === "STALL") return "confused";
      return "waiting";

    case "celebrating":
      if (event.type === "TASK_ERROR") return "worried";
      if (event.type === "TIMER" && elapsed >= CELEBRATE_DURATION_MS)
        return info.previousState === "commanding" ? "commanding" : "idle";
      return "celebrating";

    case "worried":
      if (event.type === "AGENT_THINKING") return "working";
      if (event.type === "TASK_SUCCESS") return "celebrating";
      if (event.type === "TIMER" && elapsed >= WORRIED_DURATION_MS) return "idle";
      return "worried";

    case "confused":
      if (event.type === "AGENT_THINKING") return "working";
      if (event.type === "TASK_SUCCESS") return "celebrating";
      if (event.type === "TASK_ERROR") return "worried";
      if (event.type === "TIMER" && elapsed >= WORRIED_DURATION_MS) return "idle";
      return "confused";

    case "commanding":
      if (event.type === "DISPATCH_FAILED") return "worried";
      if (event.type === "WORKER_STUCK") return "confused";
      if (event.type === "WORKFLOW_COMPLETED") return "triumph";
      if (event.type === "TASK_ERROR") return "worried";
      return "commanding";

    case "triumph":
      if (event.type === "TIMER" && elapsed >= TRIUMPH_DURATION_MS) return "idle";
      return "triumph";

    case "walking":
      // Walking is managed by movement system, not state machine
      return "walking";

    default:
      return "idle";
  }
}

export function createInitialStateInfo(): PetStateInfo {
  return {
    state: "idle",
    enteredAt: Date.now(),
    previousState: "idle",
  };
}
