import test from "node:test";
import assert from "node:assert/strict";
import {
  RESULT_SCHEMA_VERSION,
  validateSubAgentResult,
} from "../src/protocol.ts";

function buildValidResult() {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    workflow_id: "workflow-xyz",
    assignment_id: "assignment-abc123",
    run_id: "run-0001",
    outcome: "completed",
    report_file: "report.md",
  };
}

const EXPECTED_IDS = {
  workflow_id: "workflow-xyz",
  assignment_id: "assignment-abc123",
  run_id: "run-0001",
} as const;

test("validateSubAgentResult accepts a valid result", () => {
  const result = validateSubAgentResult(buildValidResult(), EXPECTED_IDS);

  assert.equal(result.schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(result.assignment_id, EXPECTED_IDS.assignment_id);
  assert.equal(result.outcome, "completed");
  assert.equal(result.report_file, "report.md");
});

test("validateSubAgentResult rejects invalid outcome", () => {
  const invalid = {
    ...buildValidResult(),
    outcome: "invalid_value",
  };

  assert.throws(
    () => validateSubAgentResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /outcome/);
      return true;
    },
  );
});

test("validateSubAgentResult accepts stuck outcome", () => {
  const result = validateSubAgentResult(
    { ...buildValidResult(), outcome: "stuck" },
    EXPECTED_IDS,
  );
  assert.equal(result.outcome, "stuck");
});

test("validateSubAgentResult accepts error outcome", () => {
  const result = validateSubAgentResult(
    { ...buildValidResult(), outcome: "error" },
    EXPECTED_IDS,
  );
  assert.equal(result.outcome, "error");
});

test("validateSubAgentResult requires report_file", () => {
  const invalid: Record<string, unknown> = { ...buildValidResult() };
  delete invalid.report_file;

  assert.throws(
    () => validateSubAgentResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /report_file/);
      return true;
    },
  );
});

test("validateSubAgentResult rejects mismatched run identity", () => {
  const invalid = {
    ...buildValidResult(),
    run_id: "run-other",
  };

  assert.throws(
    () => validateSubAgentResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /run_id/);
      return true;
    },
  );
});
