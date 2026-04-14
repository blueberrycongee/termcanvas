import { HydraError } from "./errors.ts";

export const RESULT_SCHEMA_VERSION = "hydra/result/v0.1";

// --- Outcome: machine-readable routing signal for Hydra ---

export type RunOutcome = "completed" | "stuck" | "error";

/**
 * When a worker reports outcome="stuck", `stuck_reason` tells Lead *why* it
 * is stuck so Lead can decide what to do without having to read report.md
 * first. The categories are deliberately coarse — they classify the kind of
 * intervention needed, not the underlying technical detail (which lives in
 * report.md). Inspired by Google's A2A protocol task-state vocabulary.
 *
 *   needs_clarification — the worker cannot disambiguate the request
 *   needs_credentials   — the worker is missing an auth token / secret
 *   needs_context       — the worker is missing a file / artifact / spec
 *   blocked_technical   — an environmental / technical block the worker
 *                         cannot resolve on its own (network, tool, etc.)
 */
export type StuckReason =
  | "needs_clarification"
  | "needs_credentials"
  | "needs_context"
  | "blocked_technical";

// --- Sub-agent result contract ---
//
// JSON keeps only what Hydra needs to drive routing.
// All human-readable content (summary, evidence, reflection, output
// descriptions) lives in the `report.md` file referenced by `report_file`.

export interface RunResult {
  schema_version: typeof RESULT_SCHEMA_VERSION;
  workbench_id: string;
  assignment_id: string;
  run_id: string;

  outcome: RunOutcome;
  report_file: string;       // path to report.md (relative to result.json's dir or absolute)

  /**
   * Required when outcome === "stuck"; rejected otherwise. Lets Lead route
   * stuck workers to the right intervention without parsing report.md prose.
   */
  stuck_reason?: StuckReason;
}

// --- Validation helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractIds(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const ids: Record<string, string> = {};
  if (typeof value.workbench_id === "string" && value.workbench_id) ids.workbench_id = value.workbench_id;
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

const VALID_OUTCOMES = new Set<RunOutcome>(["completed", "stuck", "error"]);

function validateOutcome(record: Record<string, unknown>, root: unknown): RunOutcome {
  const value = expectString(record, "outcome", root);
  if (!VALID_OUTCOMES.has(value as RunOutcome)) {
    failValidation(`Invalid outcome: ${value}. Expected one of: ${[...VALID_OUTCOMES].join(", ")}`, root);
  }
  return value as RunOutcome;
}

const VALID_STUCK_REASONS = new Set<StuckReason>([
  "needs_clarification",
  "needs_credentials",
  "needs_context",
  "blocked_technical",
]);

function validateStuckReason(
  record: Record<string, unknown>,
  outcome: RunOutcome,
  root: unknown,
): StuckReason | undefined {
  const raw = record.stuck_reason;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    failValidation("Invalid stuck_reason: expected a string", root);
  }
  if (outcome !== "stuck") {
    failValidation(
      `Invalid stuck_reason: only allowed when outcome="stuck" (received outcome="${outcome}")`,
      root,
    );
  }
  if (!VALID_STUCK_REASONS.has(raw as StuckReason)) {
    failValidation(
      `Invalid stuck_reason: ${raw}. Expected one of: ${[...VALID_STUCK_REASONS].join(", ")}`,
      root,
    );
  }
  return raw as StuckReason;
}

// --- Main validation ---

export function validateRunResult(
  value: unknown,
  expected: Pick<RunResult, "workbench_id" | "assignment_id" | "run_id">,
): RunResult {
  const record = expectRecord(value, "result", value);
  const schemaVersion = expectString(record, "schema_version", value);
  if (schemaVersion !== RESULT_SCHEMA_VERSION) {
    failValidation(
      `Invalid schema_version: expected ${RESULT_SCHEMA_VERSION}, received ${schemaVersion}`,
      value,
    );
  }

  const outcome = validateOutcome(record, value);
  const validated: RunResult = {
    schema_version: RESULT_SCHEMA_VERSION,
    workbench_id: expectString(record, "workbench_id", value),
    assignment_id: expectString(record, "assignment_id", value),
    run_id: expectString(record, "run_id", value),
    outcome,
    report_file: expectString(record, "report_file", value),
    stuck_reason: validateStuckReason(record, outcome, value),
  };

  if (validated.workbench_id !== expected.workbench_id) {
    failValidation("Invalid workbench_id: result does not match workbench", value);
  }
  if (validated.assignment_id !== expected.assignment_id) {
    failValidation("Invalid assignment_id: result does not match assignment", value);
  }
  if (validated.run_id !== expected.run_id) {
    failValidation("Invalid run_id: result does not match active run", value);
  }

  return validated;
}
