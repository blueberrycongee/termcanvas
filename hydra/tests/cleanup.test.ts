import test from "node:test";
import assert from "node:assert/strict";
import { parseCleanupArgs } from "../src/cleanup.ts";

test("parseCleanupArgs with agent ID", () => {
  const result = parseCleanupArgs(["hydra-123-abcd"]);
  assert.equal(result.agentId, "hydra-123-abcd");
  assert.equal(result.all, false);
  assert.equal(result.force, false);
});

test("parseCleanupArgs with --all", () => {
  const result = parseCleanupArgs(["--all"]);
  assert.equal(result.agentId, undefined);
  assert.equal(result.all, true);
  assert.equal(result.force, false);
});

test("parseCleanupArgs with --all --force", () => {
  const result = parseCleanupArgs(["--all", "--force"]);
  assert.equal(result.all, true);
  assert.equal(result.force, true);
});

test("parseCleanupArgs throws with no args", () => {
  assert.throws(() => parseCleanupArgs([]), /agent ID or --all/);
});
