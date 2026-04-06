import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_VERSION,
  buildTaskPackagePaths,
  validateDoneMarker,
  validateHandoffContract,
  validateResultContract,
} from "../src/protocol.ts";

function buildValidHandoff() {
  return {
    version: PROTOCOL_VERSION,
    handoff_id: "handoff-abc123",
    workflow_id: "workflow-xyz",
    created_at: "2026-03-26T12:00:00.000Z",
    from: {
      role: "planner",
      agent_type: "claude",
      agent_id: "claude-session-1",
    },
    to: {
      role: "implementer",
      agent_type: "codex",
      agent_id: null,
    },
    task: {
      type: "implement-feature",
      title: "Implement protocol v2",
      description: "Create the file contract validator.",
      acceptance_criteria: [
        "Reject invalid result files",
        "Keep paths inside the package directory",
      ],
      skills: ["test-driven-development"],
    },
    context: {
      files: ["hydra/src/protocol.ts"],
      previous_handoffs: [],
      decisions: {
        result_gate: "schema-first",
      },
    },
    artifacts: buildTaskPackagePaths("/tmp/hydra/workflow-xyz/handoff-abc123"),
  };
}

function buildValidResult() {
  return {
    version: PROTOCOL_VERSION,
    handoff_id: "handoff-abc123",
    workflow_id: "workflow-xyz",
    success: true,
    summary: "Validated the protocol contract.",
    outputs: [
      {
        path: "hydra/src/protocol.ts",
        description: "Protocol types and validators",
      },
    ],
    evidence: [
      "npm run typecheck",
      "npm test",
    ],
    next_action: {
      type: "complete",
      reason: "Contract is valid and ready for the next stage.",
    },
  };
}

function buildValidDoneMarker() {
  return {
    version: PROTOCOL_VERSION,
    handoff_id: "handoff-abc123",
    workflow_id: "workflow-xyz",
    result_file: "/tmp/hydra/workflow-xyz/handoff-abc123/result.json",
  };
}

test("validateHandoffContract accepts a valid v2 contract", () => {
  const handoff = validateHandoffContract(buildValidHandoff());

  assert.equal(handoff.artifacts.task_file, "/tmp/hydra/workflow-xyz/handoff-abc123/task.md");
  assert.equal(handoff.artifacts.result_file, "/tmp/hydra/workflow-xyz/handoff-abc123/result.json");
  assert.equal(handoff.artifacts.done_file, "/tmp/hydra/workflow-xyz/handoff-abc123/done");
});

test("validateHandoffContract accepts the new researcher/tester roles", () => {
  const handoff = buildValidHandoff();
  handoff.from.role = "researcher";
  handoff.to.role = "tester";

  const validated = validateHandoffContract(handoff);

  assert.equal(validated.from.role, "researcher");
  assert.equal(validated.to.role, "tester");
});

test("validateHandoffContract rejects missing required fields", () => {
  const invalid = buildValidHandoff();
  delete (invalid as Partial<typeof invalid>).workflow_id;

  assert.throws(
    () => validateHandoffContract(invalid),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_HANDOFF");
      assert.match(error.message, /workflow_id/);
      return true;
    },
  );
});

test("validateResultContract rejects incorrect field types", () => {
  const invalid = {
    ...buildValidResult(),
    success: "yes",
  };

  assert.throws(
    () => validateResultContract(invalid, buildValidHandoff()),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_RESULT");
      assert.match(error.message, /success/);
      return true;
    },
  );
});

test("validateResultContract preserves satisfaction loop fields", () => {
  const result = validateResultContract(
    {
      ...buildValidResult(),
      satisfaction: false,
      replan: true,
    },
    buildValidHandoff(),
  );

  assert.equal(result.satisfaction, false);
  assert.equal(result.replan, true);
});

test("validateHandoffContract rejects artifact path mismatches", () => {
  const invalid = buildValidHandoff();
  invalid.artifacts.result_file = "/tmp/hydra/other/result.json";

  assert.throws(
    () => validateHandoffContract(invalid),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_HANDOFF");
      assert.match(error.message, /result_file/);
      return true;
    },
  );
});

test("validateDoneMarker rejects done markers that point at a different result file", () => {
  const handoff = validateHandoffContract(buildValidHandoff());
  const invalid = buildValidDoneMarker();
  invalid.result_file = "/tmp/hydra/workflow-xyz/handoff-abc123/other-result.json";

  assert.throws(
    () => validateDoneMarker(invalid, handoff),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "PROTOCOL_INVALID_DONE");
      assert.match(error.message, /result_file/);
      return true;
    },
  );
});
