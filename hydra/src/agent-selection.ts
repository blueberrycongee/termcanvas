import type { AgentType } from "./handoff/types.ts";

export const SUPPORTED_AGENT_TYPES = [
  "claude",
  "codex",
  "kimi",
  "gemini",
] as const satisfies readonly AgentType[];

export const DEFAULT_AGENT_TYPE: AgentType = "claude";

/** Agent types that support auto-approve (bypass permission prompts). */
export const AUTO_APPROVE_AGENT_TYPES = new Set<AgentType>(["claude", "codex"]);

const AGENT_TYPES = new Set<AgentType>(SUPPORTED_AGENT_TYPES);

export interface WorkflowAgentTypeSelection {
  allType?: AgentType;
  plannerType?: AgentType;
  implementerType?: AgentType;
  evaluatorType?: AgentType;
}

export interface ResolvedWorkflowAgentTypes {
  plannerType: AgentType;
  implementerType: AgentType;
  evaluatorType: AgentType;
}

export interface WorkerAgentTypeSelection {
  workerType?: AgentType;
}

export function parseAgentType(value: string | undefined): AgentType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !AGENT_TYPES.has(normalized as AgentType)) {
    return undefined;
  }
  return normalized as AgentType;
}

export function parseAgentTypeFlag(flag: string, value: string | undefined): AgentType {
  const parsed = parseAgentType(value);
  if (parsed) {
    return parsed;
  }
  throw new Error(
    `Expected ${flag} to be one of: ${SUPPORTED_AGENT_TYPES.join(", ")}`,
  );
}

export function resolveCurrentAgentType(
  env: Record<string, string | undefined> = process.env,
): AgentType | undefined {
  return parseAgentType(env.TERMCANVAS_TERMINAL_TYPE);
}

export function resolveDefaultAgentType(
  env: Record<string, string | undefined> = process.env,
): AgentType {
  return resolveCurrentAgentType(env) ?? DEFAULT_AGENT_TYPE;
}

export function resolveWorkflowAgentTypes(
  selection: WorkflowAgentTypeSelection,
  env: Record<string, string | undefined> = process.env,
): ResolvedWorkflowAgentTypes {
  const baseType = selection.allType ?? resolveDefaultAgentType(env);
  return {
    plannerType: selection.plannerType ?? baseType,
    implementerType: selection.implementerType ?? selection.allType ?? baseType,
    evaluatorType: selection.evaluatorType ?? selection.allType ?? baseType,
  };
}

export function resolveWorkerAgentType(
  selection: WorkerAgentTypeSelection,
  env: Record<string, string | undefined> = process.env,
): AgentType {
  return selection.workerType ?? resolveDefaultAgentType(env);
}
