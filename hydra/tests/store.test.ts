import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-store-"));
process.env.HYDRA_HOME = testDir;

const { saveAgent, loadAgent, listAgents, deleteAgent } = await import(
  "../src/store.ts"
);

const record = {
  id: "hydra-1234-abcd",
  task: "fix the bug",
  type: "claude",
  repo: "/tmp/repo",
  terminalId: "tc-001",
  worktreePath: "/tmp/repo/.worktrees/hydra-1234-abcd",
  branch: "hydra/1234-abcd",
  baseBranch: "main",
  ownWorktree: true,
  createdAt: new Date().toISOString(),
};

test("saveAgent + loadAgent round-trip", () => {
  saveAgent(record);
  const loaded = loadAgent(record.id);
  assert.deepStrictEqual(loaded, record);
});

test("listAgents returns all saved agents", () => {
  const agents = listAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, record.id);
});

test("listAgents filters by repo", () => {
  assert.equal(listAgents("/tmp/repo").length, 1);
  assert.equal(listAgents("/tmp/other").length, 0);
});

test("deleteAgent removes record", () => {
  deleteAgent(record.id);
  assert.equal(loadAgent(record.id), null);
  assert.equal(listAgents().length, 0);
});

test.after(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});
