import { HydraError } from "./errors.ts";

export const WORKFLOW_RESULT_SCHEMA_VERSION = "hydra/result/v1";

const RESULT_ACTION_TYPES = new Set([
  "complete",
  "retry",
  "transition",
]);

export interface VerificationTier {
  ran: boolean;
  pass?: boolean;
  detail?: string;
  reason?: string;
}

export interface ResultVerification {
  runtime?: VerificationTier;
  build?: VerificationTier;
  probing?: VerificationTier;
  static?: VerificationTier;
}

export interface WorkflowResultOutput {
  path: string;
  description?: string;
  kind?: string;
}

export interface WorkflowResultNextAction {
  type: "complete" | "retry" | "transition";
  reason: string;
  assignment_id?: string;
}

export interface WorkflowResultContract {
  schema_version: typeof WORKFLOW_RESULT_SCHEMA_VERSION;
  workflow_id: string;
  assignment_id: string;
  run_id: string;
  success: boolean;
  summary: string;
  outputs: WorkflowResultOutput[];
  evidence: string[];
  next_action: WorkflowResultNextAction;
  verification?: ResultVerification;
  satisfaction?: boolean;
  replan?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractIds(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const ids: Record<string, string> = {};
  if (typeof value.workflow_id === "string" && value.workflow_id) {
    ids.workflow_id = value.workflow_id;
  }
  if (typeof value.assignment_id === "string" && value.assignment_id) {
    ids.assignment_id = value.assignment_id;
  }
  if (typeof value.run_id === "string" && value.run_id) {
    ids.run_id = value.run_id;
  }
  return ids;
}

function failProtocolValidation(message: string, value: unknown): never {
  throw new HydraError(message, {
    errorCode: "PROTOCOL_INVALID_RESULT",
    stage: "protocol.validate_result",
    ids: extractIds(value),
  });
}

function expectRecord(
  value: unknown,
  field: string,
  root: unknown,
): Record<string, unknown> {
  if (!isRecord(value)) {
    failProtocolValidation(`Invalid ${field}: expected an object`, root);
  }
  return value;
}

function expectString(
  record: Record<string, unknown>,
  field: string,
  root: unknown,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    failProtocolValidation(`Invalid ${field}: expected a non-empty string`, root);
  }
  return value;
}

function expectBoolean(
  record: Record<string, unknown>,
  field: string,
  root: unknown,
): boolean {
  const value = record[field];
  if (typeof value !== "boolean") {
    failProtocolValidation(`Invalid ${field}: expected a boolean`, root);
  }
  return value;
}

function expectOptionalBoolean(
  record: Record<string, unknown>,
  field: string,
  root: unknown,
): boolean | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    failProtocolValidation(`Invalid ${field}: expected a boolean`, root);
  }
  return value;
}

function expectStringArray(
  record: Record<string, unknown>,
  field: string,
  root: unknown,
): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    failProtocolValidation(`Invalid ${field}: expected an array of non-empty strings`, root);
  }
  return value;
}

function validateOutputs(
  record: Record<string, unknown>,
  root: unknown,
): WorkflowResultOutput[] {
  const value = record.outputs;
  if (!Array.isArray(value)) {
    failProtocolValidation("Invalid outputs: expected an array", root);
  }

  return value.map((entry) => {
    const output = expectRecord(entry, "outputs[]", root);
    const validated: WorkflowResultOutput = {
      path: expectString(output, "path", root),
    };
    if (typeof output.description === "string" && output.description.trim() !== "") {
      validated.description = output.description;
    }
    if (typeof output.kind === "string" && output.kind.trim() !== "") {
      validated.kind = output.kind;
    }
    return validated;
  });
}

function validateNextAction(
  record: Record<string, unknown>,
  root: unknown,
): WorkflowResultNextAction {
  const value = expectRecord(record.next_action, "next_action", root);
  const type = expectString(value, "type", root);
  if (!RESULT_ACTION_TYPES.has(type)) {
    failProtocolValidation(`Invalid next_action.type: ${type}`, root);
  }

  const nextAction: WorkflowResultNextAction = {
    type: type as WorkflowResultNextAction["type"],
    reason: expectString(value, "reason", root),
  };

  const assignmentId = value.assignment_id;
  if (assignmentId !== undefined) {
    if (typeof assignmentId !== "string" || assignmentId.trim() === "") {
      failProtocolValidation("Invalid next_action.assignment_id", root);
    }
    nextAction.assignment_id = assignmentId;
  }

  if (nextAction.type === "transition" && !nextAction.assignment_id) {
    failProtocolValidation("Missing next_action.assignment_id for transition", root);
  }

  return nextAction;
}

function validateVerificationTier(value: unknown): VerificationTier | undefined {
  if (!isRecord(value) || typeof value.ran !== "boolean") {
    return undefined;
  }

  const tier: VerificationTier = { ran: value.ran };
  if (typeof value.pass === "boolean") tier.pass = value.pass;
  if (typeof value.detail === "string") tier.detail = value.detail;
  if (typeof value.reason === "string") tier.reason = value.reason;
  return tier;
}

function validateVerification(record: Record<string, unknown>): ResultVerification | undefined {
  const value = record.verification;
  if (value === undefined || !isRecord(value)) {
    return undefined;
  }

  const verification: ResultVerification = {};
  const runtime = validateVerificationTier(value.runtime);
  const build = validateVerificationTier(value.build);
  const probing = validateVerificationTier(value.probing);
  const staticTier = validateVerificationTier(value.static);
  if (runtime) verification.runtime = runtime;
  if (build) verification.build = build;
  if (probing) verification.probing = probing;
  if (staticTier) verification.static = staticTier;
  return Object.keys(verification).length > 0 ? verification : undefined;
}

export function validateWorkflowResultContract(
  value: unknown,
  expected: Pick<WorkflowResultContract, "workflow_id" | "assignment_id" | "run_id">,
): WorkflowResultContract {
  const record = expectRecord(value, "result", value);
  const schemaVersion = expectString(record, "schema_version", value);
  if (schemaVersion !== WORKFLOW_RESULT_SCHEMA_VERSION) {
    failProtocolValidation(
      `Invalid schema_version: expected ${WORKFLOW_RESULT_SCHEMA_VERSION}, received ${schemaVersion}`,
      value,
    );
  }

  const validated: WorkflowResultContract = {
    schema_version: WORKFLOW_RESULT_SCHEMA_VERSION,
    workflow_id: expectString(record, "workflow_id", value),
    assignment_id: expectString(record, "assignment_id", value),
    run_id: expectString(record, "run_id", value),
    success: expectBoolean(record, "success", value),
    summary: expectString(record, "summary", value),
    outputs: validateOutputs(record, value),
    evidence: expectStringArray(record, "evidence", value),
    next_action: validateNextAction(record, value),
  };

  const verification = validateVerification(record);
  if (verification) {
    validated.verification = verification;
  }

  const satisfaction = expectOptionalBoolean(record, "satisfaction", value);
  if (satisfaction !== undefined) {
    validated.satisfaction = satisfaction;
  }

  const replan = expectOptionalBoolean(record, "replan", value);
  if (replan !== undefined) {
    validated.replan = replan;
  }

  if (validated.workflow_id !== expected.workflow_id) {
    failProtocolValidation("Invalid workflow_id: result does not match workflow", value);
  }
  if (validated.assignment_id !== expected.assignment_id) {
    failProtocolValidation("Invalid assignment_id: result does not match assignment", value);
  }
  if (validated.run_id !== expected.run_id) {
    failProtocolValidation("Invalid run_id: result does not match active run", value);
  }

  return validated;
}
