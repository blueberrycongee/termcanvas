import test from "node:test";
import assert from "node:assert/strict";
import {
  RESULT_SCHEMA_VERSION,
  validateRunResult,
} from "../src/protocol.ts";

function buildValidResult() {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    workbench_id: "workflow-xyz",
    assignment_id: "assignment-abc123",
    run_id: "run-0001",
    outcome: "completed",
    report_file: "report.md",
  };
}

const EXPECTED_IDS = {
  workbench_id: "workflow-xyz",
  assignment_id: "assignment-abc123",
  run_id: "run-0001",
} as const;

test("validateRunResult accepts a valid result", () => {
  const result = validateRunResult(buildValidResult(), EXPECTED_IDS);

  assert.equal(result.schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(result.assignment_id, EXPECTED_IDS.assignment_id);
  assert.equal(result.outcome, "completed");
  assert.equal(result.report_file, "report.md");
});

test("validateRunResult rejects invalid outcome", () => {
  const invalid = {
    ...buildValidResult(),
    outcome: "invalid_value",
  };

  assert.throws(
    () => validateRunResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /outcome/);
      return true;
    },
  );
});

test("validateRunResult accepts stuck outcome", () => {
  const result = validateRunResult(
    { ...buildValidResult(), outcome: "stuck" },
    EXPECTED_IDS,
  );
  assert.equal(result.outcome, "stuck");
});

test("validateRunResult accepts error outcome", () => {
  const result = validateRunResult(
    { ...buildValidResult(), outcome: "error" },
    EXPECTED_IDS,
  );
  assert.equal(result.outcome, "error");
});

test("validateRunResult requires report_file", () => {
  const invalid: Record<string, unknown> = { ...buildValidResult() };
  delete invalid.report_file;

  assert.throws(
    () => validateRunResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /report_file/);
      return true;
    },
  );
});

test("validateRunResult accepts a valid stuck_reason on a stuck result", () => {
  const result = validateRunResult(
    {
      ...buildValidResult(),
      outcome: "stuck",
      stuck_reason: "needs_credentials",
    },
    EXPECTED_IDS,
  );
  assert.equal(result.outcome, "stuck");
  assert.equal(result.stuck_reason, "needs_credentials");
});

test("validateRunResult leaves stuck_reason undefined when not provided", () => {
  const result = validateRunResult(
    { ...buildValidResult(), outcome: "stuck" },
    EXPECTED_IDS,
  );
  assert.equal(result.outcome, "stuck");
  assert.equal(result.stuck_reason, undefined);
});

test("validateRunResult rejects an unknown stuck_reason value", () => {
  assert.throws(
    () =>
      validateRunResult(
        {
          ...buildValidResult(),
          outcome: "stuck",
          stuck_reason: "needs_a_hug",
        },
        EXPECTED_IDS,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /stuck_reason/);
      assert.match(error.message, /needs_a_hug/);
      return true;
    },
  );
});

test("validateRunResult rejects stuck_reason when outcome is not stuck", () => {
  assert.throws(
    () =>
      validateRunResult(
        {
          ...buildValidResult(),
          outcome: "completed",
          stuck_reason: "needs_clarification",
        },
        EXPECTED_IDS,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /stuck_reason/);
      assert.match(error.message, /outcome="stuck"/);
      return true;
    },
  );
});

test("validateRunResult rejects mismatched run identity", () => {
  const invalid = {
    ...buildValidResult(),
    run_id: "run-other",
  };

  assert.throws(
    () => validateRunResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /run_id/);
      return true;
    },
  );
});
