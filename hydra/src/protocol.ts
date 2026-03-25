import path from "node:path";
import { HydraError } from "./errors.ts";

export const PROTOCOL_VERSION = "hydra/v2";
export const TASK_PACKAGE_FILES = {
  handoff: "handoff.json",
  task: "task.md",
  result: "result.json",
  done: "done",
} as const;

const AGENT_ROLES = new Set([
  "planner",
  "implementer",
  "evaluator",
  "reviewer",
  "integrator",
  "researcher",
]);

const AGENT_TYPES = new Set([
  "claude",
  "codex",
  "kimi",
  "gemini",
]);

const NEXT_ACTION_TYPES = new Set([
  "complete",
  "retry",
  "handoff",
]);

export interface TaskPackagePaths {
  package_dir: string;
  handoff_file: string;
  task_file: string;
  result_file: string;
  done_file: string;
}

export interface ProtocolAgent {
  role: string;
  agent_type: string;
  agent_id: string | null;
}

export interface ProtocolTask {
  type: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  constraints?: Record<string, unknown>;
  skills?: string[];
}

export interface ProtocolContext {
  files: string[];
  previous_handoffs: string[];
  decisions?: Record<string, string>;
  shared_state?: Record<string, unknown>;
}

export interface HandoffContract {
  version: typeof PROTOCOL_VERSION;
  handoff_id: string;
  workflow_id: string;
  created_at: string;
  from: ProtocolAgent;
  to: ProtocolAgent;
  task: ProtocolTask;
  context: ProtocolContext;
  artifacts: TaskPackagePaths;
}

export interface ResultOutput {
  path: string;
  description: string;
}

export interface ResultNextAction {
  type: "complete" | "retry" | "handoff";
  reason: string;
  handoff_id?: string;
}

export interface ResultContract {
  version: typeof PROTOCOL_VERSION;
  handoff_id: string;
  workflow_id: string;
  success: boolean;
  summary: string;
  outputs: ResultOutput[];
  evidence: string[];
  next_action: ResultNextAction;
}

export interface DoneMarker {
  version: typeof PROTOCOL_VERSION;
  handoff_id: string;
  workflow_id: string;
  result_file: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractIds(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const ids: Record<string, string> = {};
  if (typeof value.handoff_id === "string" && value.handoff_id) {
    ids.handoff_id = value.handoff_id;
  }
  if (typeof value.workflow_id === "string" && value.workflow_id) {
    ids.workflow_id = value.workflow_id;
  }
  return ids;
}

function failProtocolValidation(
  errorCode: "PROTOCOL_INVALID_HANDOFF" | "PROTOCOL_INVALID_RESULT" | "PROTOCOL_INVALID_DONE",
  stage: "protocol.validate_handoff" | "protocol.validate_result" | "protocol.validate_done",
  message: string,
  value: unknown,
): never {
  throw new HydraError(message, {
    errorCode,
    stage,
    ids: extractIds(value),
  });
}

function expectRecord(
  value: unknown,
  field: string,
  errorCode: "PROTOCOL_INVALID_HANDOFF" | "PROTOCOL_INVALID_RESULT" | "PROTOCOL_INVALID_DONE",
  stage: "protocol.validate_handoff" | "protocol.validate_result" | "protocol.validate_done",
  root: unknown,
): Record<string, unknown> {
  if (!isRecord(value)) {
    failProtocolValidation(errorCode, stage, `Invalid ${field}: expected an object`, root);
  }
  return value;
}

function expectString(
  record: Record<string, unknown>,
  field: string,
  errorCode: "PROTOCOL_INVALID_HANDOFF" | "PROTOCOL_INVALID_RESULT" | "PROTOCOL_INVALID_DONE",
  stage: "protocol.validate_handoff" | "protocol.validate_result" | "protocol.validate_done",
  root: unknown,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    failProtocolValidation(errorCode, stage, `Invalid ${field}: expected a non-empty string`, root);
  }
  return value;
}

function expectBoolean(
  record: Record<string, unknown>,
  field: string,
  errorCode: "PROTOCOL_INVALID_RESULT",
  stage: "protocol.validate_result",
  root: unknown,
): boolean {
  const value = record[field];
  if (typeof value !== "boolean") {
    failProtocolValidation(errorCode, stage, `Invalid ${field}: expected a boolean`, root);
  }
  return value;
}

function expectStringArray(
  record: Record<string, unknown>,
  field: string,
  errorCode: "PROTOCOL_INVALID_HANDOFF" | "PROTOCOL_INVALID_RESULT",
  stage: "protocol.validate_handoff" | "protocol.validate_result",
  root: unknown,
): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    failProtocolValidation(errorCode, stage, `Invalid ${field}: expected an array of non-empty strings`, root);
  }
  return value;
}

function expectOptionalStringArray(
  record: Record<string, unknown>,
  field: string,
  errorCode: "PROTOCOL_INVALID_HANDOFF",
  stage: "protocol.validate_handoff",
  root: unknown,
): string[] | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    failProtocolValidation(errorCode, stage, `Invalid ${field}: expected an array of non-empty strings`, root);
  }
  return value;
}

function expectOptionalRecord(
  record: Record<string, unknown>,
  field: string,
  errorCode: "PROTOCOL_INVALID_HANDOFF",
  stage: "protocol.validate_handoff",
  root: unknown,
): Record<string, unknown> | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  return expectRecord(value, field, errorCode, stage, root);
}

function expectOptionalStringRecord(
  record: Record<string, unknown>,
  field: string,
  errorCode: "PROTOCOL_INVALID_HANDOFF",
  stage: "protocol.validate_handoff",
  root: unknown,
): Record<string, string> | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    failProtocolValidation(errorCode, stage, `Invalid ${field}: expected an object`, root);
  }
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    failProtocolValidation(errorCode, stage, `Invalid ${field}: expected string values`, root);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function expectVersion(
  record: Record<string, unknown>,
  errorCode: "PROTOCOL_INVALID_HANDOFF" | "PROTOCOL_INVALID_RESULT" | "PROTOCOL_INVALID_DONE",
  stage: "protocol.validate_handoff" | "protocol.validate_result" | "protocol.validate_done",
  root: unknown,
): typeof PROTOCOL_VERSION {
  const version = expectString(record, "version", errorCode, stage, root);
  if (version !== PROTOCOL_VERSION) {
    failProtocolValidation(errorCode, stage, `Invalid version: expected ${PROTOCOL_VERSION}`, root);
  }
  return PROTOCOL_VERSION;
}

function validateAgent(
  value: unknown,
  field: "from" | "to",
  root: unknown,
): ProtocolAgent {
  const record = expectRecord(value, field, "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  const role = expectString(record, "role", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  if (!AGENT_ROLES.has(role)) {
    failProtocolValidation("PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", `Invalid ${field}.role: ${role}`, root);
  }

  const agentType = expectString(record, "agent_type", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  if (!AGENT_TYPES.has(agentType)) {
    failProtocolValidation("PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", `Invalid ${field}.agent_type: ${agentType}`, root);
  }

  const agentId = record.agent_id;
  if (agentId !== null && (typeof agentId !== "string" || agentId.trim() === "")) {
    failProtocolValidation("PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", `Invalid ${field}.agent_id`, root);
  }

  return {
    role,
    agent_type: agentType,
    agent_id: agentId,
  };
}

function validateTask(value: unknown, root: unknown): ProtocolTask {
  const record = expectRecord(value, "task", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  const acceptanceCriteria = expectStringArray(
    record,
    "acceptance_criteria",
    "PROTOCOL_INVALID_HANDOFF",
    "protocol.validate_handoff",
    root,
  );
  if (acceptanceCriteria.length === 0) {
    failProtocolValidation("PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", "Invalid acceptance_criteria: expected at least one item", root);
  }

  return {
    type: expectString(record, "type", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
    title: expectString(record, "title", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
    description: expectString(record, "description", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
    acceptance_criteria: acceptanceCriteria,
    constraints: expectOptionalRecord(record, "constraints", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
    skills: expectOptionalStringArray(record, "skills", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
  };
}

function validateContext(value: unknown, root: unknown): ProtocolContext {
  const record = expectRecord(value, "context", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  return {
    files: expectStringArray(record, "files", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
    previous_handoffs: expectStringArray(
      record,
      "previous_handoffs",
      "PROTOCOL_INVALID_HANDOFF",
      "protocol.validate_handoff",
      root,
    ),
    decisions: expectOptionalStringRecord(record, "decisions", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
    shared_state: expectOptionalRecord(record, "shared_state", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root),
  };
}

export function buildTaskPackagePaths(packageDir: string): TaskPackagePaths {
  const resolved = path.resolve(packageDir);
  return {
    package_dir: resolved,
    handoff_file: path.join(resolved, TASK_PACKAGE_FILES.handoff),
    task_file: path.join(resolved, TASK_PACKAGE_FILES.task),
    result_file: path.join(resolved, TASK_PACKAGE_FILES.result),
    done_file: path.join(resolved, TASK_PACKAGE_FILES.done),
  };
}

function validateArtifacts(value: unknown, root: unknown): TaskPackagePaths {
  const record = expectRecord(value, "artifacts", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  const packageDir = expectString(record, "package_dir", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  if (!path.isAbsolute(packageDir)) {
    failProtocolValidation("PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", "Invalid artifacts.package_dir: expected an absolute path", root);
  }

  const handoffFile = expectString(record, "handoff_file", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  const taskFile = expectString(record, "task_file", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  const resultFile = expectString(record, "result_file", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  const doneFile = expectString(record, "done_file", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);

  const expected = buildTaskPackagePaths(packageDir);
  const actual: TaskPackagePaths = {
    package_dir: packageDir,
    handoff_file: handoffFile,
    task_file: taskFile,
    result_file: resultFile,
    done_file: doneFile,
  };

  for (const key of Object.keys(expected) as Array<keyof TaskPackagePaths>) {
    if (actual[key] !== expected[key]) {
      failProtocolValidation(
        "PROTOCOL_INVALID_HANDOFF",
        "protocol.validate_handoff",
        `Invalid artifacts.${key}: expected ${expected[key]}`,
        root,
      );
    }
  }

  return expected;
}

function validateCreatedAt(record: Record<string, unknown>, root: unknown): string {
  const createdAt = expectString(record, "created_at", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", root);
  if (Number.isNaN(Date.parse(createdAt))) {
    failProtocolValidation("PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", "Invalid created_at: expected an ISO timestamp", root);
  }
  return createdAt;
}

export function validateHandoffContract(value: unknown): HandoffContract {
  const record = expectRecord(value, "handoff", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", value);

  return {
    version: expectVersion(record, "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", value),
    handoff_id: expectString(record, "handoff_id", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", value),
    workflow_id: expectString(record, "workflow_id", "PROTOCOL_INVALID_HANDOFF", "protocol.validate_handoff", value),
    created_at: validateCreatedAt(record, value),
    from: validateAgent(record.from, "from", value),
    to: validateAgent(record.to, "to", value),
    task: validateTask(record.task, value),
    context: validateContext(record.context, value),
    artifacts: validateArtifacts(record.artifacts, value),
  };
}

function validateOutputs(record: Record<string, unknown>, root: unknown): ResultOutput[] {
  const value = record.outputs;
  if (!Array.isArray(value)) {
    failProtocolValidation("PROTOCOL_INVALID_RESULT", "protocol.validate_result", "Invalid outputs: expected an array", root);
  }

  return value.map((entry) => {
    const output = expectRecord(entry, "outputs[]", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", root);
    return {
      path: expectString(output, "path", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", root),
      description: expectString(output, "description", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", root),
    };
  });
}

function validateNextAction(record: Record<string, unknown>, root: unknown): ResultNextAction {
  const value = expectRecord(record.next_action, "next_action", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", root);
  const type = expectString(value, "type", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", root);
  if (!NEXT_ACTION_TYPES.has(type)) {
    failProtocolValidation("PROTOCOL_INVALID_RESULT", "protocol.validate_result", `Invalid next_action.type: ${type}`, root);
  }

  const nextAction: ResultNextAction = {
    type: type as ResultNextAction["type"],
    reason: expectString(value, "reason", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", root),
  };

  const handoffId = value.handoff_id;
  if (handoffId !== undefined) {
    if (typeof handoffId !== "string" || handoffId.trim() === "") {
      failProtocolValidation("PROTOCOL_INVALID_RESULT", "protocol.validate_result", "Invalid next_action.handoff_id", root);
    }
    nextAction.handoff_id = handoffId;
  }

  return nextAction;
}

export function validateResultContract(
  value: unknown,
  handoff: Pick<HandoffContract, "handoff_id" | "workflow_id">,
): ResultContract {
  const record = expectRecord(value, "result", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", value);
  const validated: ResultContract = {
    version: expectVersion(record, "PROTOCOL_INVALID_RESULT", "protocol.validate_result", value),
    handoff_id: expectString(record, "handoff_id", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", value),
    workflow_id: expectString(record, "workflow_id", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", value),
    success: expectBoolean(record, "success", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", value),
    summary: expectString(record, "summary", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", value),
    outputs: validateOutputs(record, value),
    evidence: expectStringArray(record, "evidence", "PROTOCOL_INVALID_RESULT", "protocol.validate_result", value),
    next_action: validateNextAction(record, value),
  };

  if (validated.handoff_id !== handoff.handoff_id) {
    failProtocolValidation("PROTOCOL_INVALID_RESULT", "protocol.validate_result", "Invalid handoff_id: result does not match handoff", value);
  }
  if (validated.workflow_id !== handoff.workflow_id) {
    failProtocolValidation("PROTOCOL_INVALID_RESULT", "protocol.validate_result", "Invalid workflow_id: result does not match handoff", value);
  }

  return validated;
}

export function validateDoneMarker(
  value: unknown,
  handoff: Pick<HandoffContract, "handoff_id" | "workflow_id" | "artifacts">,
): DoneMarker {
  const record = expectRecord(value, "done", "PROTOCOL_INVALID_DONE", "protocol.validate_done", value);
  const validated: DoneMarker = {
    version: expectVersion(record, "PROTOCOL_INVALID_DONE", "protocol.validate_done", value),
    handoff_id: expectString(record, "handoff_id", "PROTOCOL_INVALID_DONE", "protocol.validate_done", value),
    workflow_id: expectString(record, "workflow_id", "PROTOCOL_INVALID_DONE", "protocol.validate_done", value),
    result_file: expectString(record, "result_file", "PROTOCOL_INVALID_DONE", "protocol.validate_done", value),
  };

  if (validated.handoff_id !== handoff.handoff_id) {
    failProtocolValidation("PROTOCOL_INVALID_DONE", "protocol.validate_done", "Invalid handoff_id: done marker does not match handoff", value);
  }
  if (validated.workflow_id !== handoff.workflow_id) {
    failProtocolValidation("PROTOCOL_INVALID_DONE", "protocol.validate_done", "Invalid workflow_id: done marker does not match handoff", value);
  }
  if (validated.result_file !== handoff.artifacts.result_file) {
    failProtocolValidation("PROTOCOL_INVALID_DONE", "protocol.validate_done", "Invalid result_file: done marker does not match handoff artifacts", value);
  }

  return validated;
}
