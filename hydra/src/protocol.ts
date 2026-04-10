import { HydraError } from "./errors.ts";

export const RESULT_SCHEMA_VERSION = "hydra/result/v0.1";

// --- Outcome: machine-readable routing signal for Hydra ---

export type SubAgentOutcome = "completed" | "stuck" | "error";

// --- Sub-agent result contract ---
//
// JSON keeps only what Hydra needs to drive routing.
// All human-readable content (summary, evidence, reflection, output
// descriptions) lives in the `report.md` file referenced by `report_file`.

export interface SubAgentResult {
  schema_version: typeof RESULT_SCHEMA_VERSION;
  workflow_id: string;
  assignment_id: string;
  run_id: string;

  outcome: SubAgentOutcome;
  report_file: string;       // path to report.md (relative to result.json's dir or absolute)
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

const VALID_OUTCOMES = new Set<SubAgentOutcome>(["completed", "stuck", "error"]);

function validateOutcome(record: Record<string, unknown>, root: unknown): SubAgentOutcome {
  const value = expectString(record, "outcome", root);
  if (!VALID_OUTCOMES.has(value as SubAgentOutcome)) {
    failValidation(`Invalid outcome: ${value}. Expected one of: ${[...VALID_OUTCOMES].join(", ")}`, root);
  }
  return value as SubAgentOutcome;
}

// --- Main validation ---

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
    outcome: validateOutcome(record, value),
    report_file: expectString(record, "report_file", value),
  };

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
