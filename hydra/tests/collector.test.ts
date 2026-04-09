import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectRunResult } from "../src/collector.ts";
import { RESULT_SCHEMA_VERSION } from "../src/protocol.ts";

function createRunResultPath(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-collector-"));
  return path.join(rootDir, "result.json");
}

function buildExpectation(resultFile: string) {
  return {
    workflow_id: "workflow-auth",
    assignment_id: "assignment-abc123",
    run_id: "run-0001",
    result_file: resultFile,
  } as const;
}

test("collectRunResult returns waiting when result.json is missing", () => {
  const resultFile = createRunResultPath();

  try {
    const collected = collectRunResult(buildExpectation(resultFile));

    assert.deepEqual(collected, {
      status: "waiting",
      advance: false,
      reason: "result_missing",
    });
  } finally {
    fs.rmSync(path.dirname(resultFile), { recursive: true, force: true });
  }
});

test("collectRunResult returns completed when result.json is valid", () => {
  const resultFile = createRunResultPath();

  try {
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        schema_version: RESULT_SCHEMA_VERSION,
        workflow_id: "workflow-auth",
        assignment_id: "assignment-abc123",
        run_id: "run-0001",
        success: true,
        summary: "Implemented the collector flow.",
        outputs: [{ path: "hydra/src/collector.ts", description: "Collector implementation" }],
        evidence: ["npm test"],
        intent: { type: "done", confidence: "high" },
      }, null, 2),
      "utf-8",
    );

    const collected = collectRunResult(buildExpectation(resultFile));

    assert.equal(collected.status, "completed");
    assert.equal(collected.advance, true);
    assert.equal(collected.result.summary, "Implemented the collector flow.");
  } finally {
    fs.rmSync(path.dirname(resultFile), { recursive: true, force: true });
  }
});

test("collectRunResult fails when result.json does not satisfy the schema", () => {
  const resultFile = createRunResultPath();

  try {
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        schema_version: RESULT_SCHEMA_VERSION,
        workflow_id: "workflow-auth",
        assignment_id: "assignment-abc123",
        run_id: "run-0001",
        success: "yes",
      }, null, 2),
      "utf-8",
    );

    const collected = collectRunResult(buildExpectation(resultFile));

    assert.equal(collected.status, "failed");
    assert.equal(collected.advance, false);
    assert.equal(collected.failure?.code, "COLLECTOR_RESULT_INVALID");
  } finally {
    fs.rmSync(path.dirname(resultFile), { recursive: true, force: true });
  }
});
