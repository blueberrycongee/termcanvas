/**
 * Handoff System - Public API
 */

export { HandoffManager } from "./manager.ts";
export { HandoffStateMachine } from "./state-machine.ts";
export type {
  Handoff,
  HandoffStatus,
  AgentRole,
  AgentType,
  AgentInfo,
  TaskDefinition,
  HandoffContext,
  HandoffClaim,
  HandoffTransition,
  HandoffError,
} from "./types.ts";
