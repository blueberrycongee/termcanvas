import { HydraError } from "./errors.ts";

export const RESULT_SCHEMA_VERSION = "hydra/result/v2";

// --- Shared types (unchanged) ---

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

// --- Sub-agent intent (replaces next_action routing) ---

export type SubAgentIntent =
  | { type: "done"; confidence?: "high" | "medium" | "low" }
  | { type: "needs_rework"; reason: string; scope?: "minor" | "major" }
  | { type: "blocked"; reason: string; needs?: string }
  | { type: "replan"; reason: string };

// --- Sub-agent reflection (structured self-assessment for Hydra to retain) ---

export interface SubAgentReflection {
  approach: string;
  blockers_encountered?: string[];
  confidence_factors?: string[];
  time_spent_reasoning?: string;
}

// --- Sub-agent result contract (v2) ---

export interface SubAgentResult {
  schema_version: typeof RESULT_SCHEMA_VERSION;
  workflow_id: string;
  assignment_id: string;
  run_id: string;
  success: boolean;
  summary: string;
  outputs: WorkflowResultOutput[];
  evidence: string[];
  intent: SubAgentIntent;
  verification?: ResultVerification;
  reflection?: SubAgentReflection;
}

// --- Validation helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractIds(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const ids: Record<string, string> = {};
  if (typeof value.workflow_id === "string" && value.workflow_id) ids.workflow_id = value.workflow_id;
  if (typeof value.assignment_id === "string" && value.assignment_id) ids.assignment_id = value.assignment_id;
  if (typeof value.run_id === "string" && value.run_id) ids.run_id = value.run_id;
  return ids;
}

function failValidation(message: string, value: unknown): never {
  throw new HydraError(message, {
    errorCode: "PROTOCOL_INVALID_RESULT",
    stage: "protocol.validate_result",
    ids: extractIds(value),
  });
}

function expectRecord(value: unknown, field: string, root: unknown): Record<string, unknown> {
  if (!isRecord(value)) failValidation(`Invalid ${field}: expected an object`, root);
  return value;
}

function expectString(record: Record<string, unknown>, field: string, root: unknown): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    failValidation(`Invalid ${field}: expected a non-empty string`, root);
  }
  return value;
}

function expectBoolean(record: Record<string, unknown>, field: string, root: unknown): boolean {
  const value = record[field];
  if (typeof value !== "boolean") failValidation(`Invalid ${field}: expected a boolean`, root);
  return value;
}

function expectStringArray(record: Record<string, unknown>, field: string, root: unknown): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((e) => typeof e !== "string" || e.trim() === "")) {
    failValidation(`Invalid ${field}: expected an array of non-empty strings`, root);
  }
  return value;
}

function validateOutputs(record: Record<string, unknown>, root: unknown): WorkflowResultOutput[] {
  const value = record.outputs;
  if (!Array.isArray(value)) failValidation("Invalid outputs: expected an array", root);
  return value.map((entry) => {
    const output = expectRecord(entry, "outputs[]", root);
    const validated: WorkflowResultOutput = { path: expectString(output, "path", root) };
    if (typeof output.description === "string" && output.description.trim() !== "") validated.description = output.description;
    if (typeof output.kind === "string" && output.kind.trim() !== "") validated.kind = output.kind;
    return validated;
  });
}

const VALID_INTENT_TYPES = new Set(["done", "needs_rework", "blocked", "replan"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_SCOPE = new Set(["minor", "major"]);

function validateIntent(record: Record<string, unknown>, root: unknown): SubAgentIntent {
  const raw = expectRecord(record.intent, "intent", root);
  const type = expectString(raw, "type", root);
  if (!VALID_INTENT_TYPES.has(type)) {
    failValidation(`Invalid intent.type: ${type}. Expected one of: ${[...VALID_INTENT_TYPES].join(", ")}`, root);
  }

  switch (type) {
    case "done": {
      const intent: SubAgentIntent = { type: "done" };
      if (typeof raw.confidence === "string") {
        if (!VALID_CONFIDENCE.has(raw.confidence)) {
          failValidation(`Invalid intent.confidence: ${raw.confidence}`, root);
        }
        intent.confidence = raw.confidence as "high" | "medium" | "low";
      }
      return intent;
    }
    case "needs_rework": {
      const intent: SubAgentIntent = {
        type: "needs_rework",
        reason: expectString(raw, "reason", root),
      };
      if (typeof raw.scope === "string") {
        if (!VALID_SCOPE.has(raw.scope)) {
          failValidation(`Invalid intent.scope: ${raw.scope}`, root);
        }
        intent.scope = raw.scope as "minor" | "major";
      }
      return intent;
    }
    case "blocked":
      return {
        type: "blocked",
        reason: expectString(raw, "reason", root),
        ...(typeof raw.needs === "string" ? { needs: raw.needs } : {}),
      };
    case "replan":
      return {
        type: "replan",
        reason: expectString(raw, "reason", root),
      };
    default:
      failValidation(`Unexpected intent type: ${type}`, root);
  }
}

function validateVerificationTier(value: unknown): VerificationTier | undefined {
  if (!isRecord(value) || typeof value.ran !== "boolean") return undefined;
  const tier: VerificationTier = { ran: value.ran };
  if (typeof value.pass === "boolean") tier.pass = value.pass;
  if (typeof value.detail === "string") tier.detail = value.detail;
  if (typeof value.reason === "string") tier.reason = value.reason;
  return tier;
}

function validateVerification(record: Record<string, unknown>): ResultVerification | undefined {
  const value = record.verification;
  if (value === undefined || !isRecord(value)) return undefined;
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

function validateReflection(record: Record<string, unknown>): SubAgentReflection | undefined {
  const value = record.reflection;
  if (value === undefined || !isRecord(value)) return undefined;
  if (typeof value.approach !== "string" || value.approach.trim() === "") return undefined;
  const reflection: SubAgentReflection = { approach: value.approach };
  if (Array.isArray(value.blockers_encountered)) {
    reflection.blockers_encountered = value.blockers_encountered.filter(
      (e): e is string => typeof e === "string" && e.trim() !== "",
    );
  }
  if (Array.isArray(value.confidence_factors)) {
    reflection.confidence_factors = value.confidence_factors.filter(
      (e): e is string => typeof e === "string" && e.trim() !== "",
    );
  }
  if (typeof value.time_spent_reasoning === "string") {
    reflection.time_spent_reasoning = value.time_spent_reasoning;
  }
  return reflection;
}

// --- Main validation function ---

export function validateSubAgentResult(
  value: unknown,
  expected: Pick<SubAgentResult, "workflow_id" | "assignment_id" | "run_id">,
): SubAgentResult {
  const record = expectRecord(value, "result", value);
  const schemaVersion = expectString(record, "schema_version", value);
  if (schemaVersion !== RESULT_SCHEMA_VERSION) {
    failValidation(
      `Invalid schema_version: expected ${RESULT_SCHEMA_VERSION}, received ${schemaVersion}`,
      value,
    );
  }

  const validated: SubAgentResult = {
    schema_version: RESULT_SCHEMA_VERSION,
    workflow_id: expectString(record, "workflow_id", value),
    assignment_id: expectString(record, "assignment_id", value),
    run_id: expectString(record, "run_id", value),
    success: expectBoolean(record, "success", value),
    summary: expectString(record, "summary", value),
    outputs: validateOutputs(record, value),
    evidence: expectStringArray(record, "evidence", value),
    intent: validateIntent(record, value),
  };

  const verification = validateVerification(record);
  if (verification) validated.verification = verification;

  const reflection = validateReflection(record);
  if (reflection) validated.reflection = reflection;

  if (validated.workflow_id !== expected.workflow_id) {
    failValidation("Invalid workflow_id: result does not match workflow", value);
  }
  if (validated.assignment_id !== expected.assignment_id) {
    failValidation("Invalid assignment_id: result does not match assignment", value);
  }
  if (validated.run_id !== expected.run_id) {
    failValidation("Invalid run_id: result does not match active run", value);
  }

  return validated;
}
