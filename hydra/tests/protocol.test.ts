import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_RESULT_SCHEMA_VERSION,
  validateWorkflowResultContract,
} from "../src/protocol.ts";

function buildValidResult() {
  return {
    schema_version: WORKFLOW_RESULT_SCHEMA_VERSION,
    workflow_id: "workflow-xyz",
    assignment_id: "assignment-abc123",
    run_id: "run-0001",
    success: true,
    summary: "Validated the assignment run result.",
    outputs: [
      {
        path: "hydra/src/protocol.ts",
        description: "Workflow result protocol",
        kind: "source",
      },
    ],
    evidence: [
      "npm run typecheck",
      "npm test",
    ],
    next_action: {
      type: "complete",
      reason: "The assignment run is ready to finish.",
    },
    verification: {
      build: { ran: true, pass: true, detail: "tsc clean" },
    },
  };
}

const EXPECTED_IDS = {
  workflow_id: "workflow-xyz",
  assignment_id: "assignment-abc123",
  run_id: "run-0001",
} as const;

test("validateWorkflowResultContract accepts a valid v1 result", () => {
  const result = validateWorkflowResultContract(buildValidResult(), EXPECTED_IDS);

  assert.equal(result.schema_version, WORKFLOW_RESULT_SCHEMA_VERSION);
  assert.equal(result.assignment_id, EXPECTED_IDS.assignment_id);
  assert.equal(result.outputs[0]?.kind, "source");
  assert.equal(result.verification?.build?.pass, true);
});

test("validateWorkflowResultContract rejects transition actions without assignment_id", () => {
  const invalid = {
    ...buildValidResult(),
    next_action: {
      type: "transition",
      reason: "Move to the next assignment.",
    },
  };

  assert.throws(
    () => validateWorkflowResultContract(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /assignment_id/);
      return true;
    },
  );
});

test("validateWorkflowResultContract preserves satisfaction and replan fields", () => {
  const result = validateWorkflowResultContract(
    {
      ...buildValidResult(),
      satisfaction: false,
      replan: true,
    },
    EXPECTED_IDS,
  );

  assert.equal(result.satisfaction, false);
  assert.equal(result.replan, true);
});

test("validateWorkflowResultContract rejects mismatched run identity", () => {
  const invalid = {
    ...buildValidResult(),
    run_id: "run-other",
  };

  assert.throws(
    () => validateWorkflowResultContract(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /run_id/);
      return true;
    },
  );
});
