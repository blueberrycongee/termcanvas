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
    intent: {
      type: "done",
      confidence: "high",
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

test("validateSubAgentResult accepts a valid v2 result", () => {
  const result = validateSubAgentResult(buildValidResult(), EXPECTED_IDS);

  assert.equal(result.schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(result.assignment_id, EXPECTED_IDS.assignment_id);
  assert.equal(result.outputs[0]?.kind, "source");
  assert.equal(result.verification?.build?.pass, true);
  assert.equal(result.intent.type, "done");
});

test("validateSubAgentResult rejects invalid intent type", () => {
  const invalid = {
    ...buildValidResult(),
    intent: { type: "invalid_type" },
  };

  assert.throws(
    () => validateSubAgentResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /intent\.type/);
      return true;
    },
  );
});

test("validateSubAgentResult validates needs_rework requires reason", () => {
  const invalid = {
    ...buildValidResult(),
    intent: { type: "needs_rework" },
  };

  assert.throws(
    () => validateSubAgentResult(invalid, EXPECTED_IDS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /reason/);
      return true;
    },
  );
});

test("validateSubAgentResult preserves reflection", () => {
  const result = validateSubAgentResult(
    {
      ...buildValidResult(),
      reflection: {
        approach: "Grep-first strategy",
        blockers_encountered: ["Missing types"],
        confidence_factors: ["All tests pass"],
      },
    },
    EXPECTED_IDS,
  );

  assert.equal(result.reflection?.approach, "Grep-first strategy");
  assert.deepEqual(result.reflection?.blockers_encountered, ["Missing types"]);
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
