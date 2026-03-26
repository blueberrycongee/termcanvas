import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildTaskPackageContext,
  buildTaskPackageDir,
  renderTaskPackageTemplate,
  writeTaskPackage,
} from "../src/task-package.ts";
import { validateHandoffContract } from "../src/protocol.ts";

function createContext(rootDir: string) {
  return buildTaskPackageContext({
    workspaceRoot: rootDir,
    workflowId: "workflow-auth",
    handoffId: "handoff-abc123",
    createdAt: "2026-03-26T12:00:00.000Z",
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
      title: "Implement the auth workflow",
      description: "Build the new file-contract-driven auth workflow.",
      acceptance_criteria: [
        "Writes result.json and done",
        "Leaves evidence for reviewers",
      ],
      skills: ["test-driven-development", "verification-before-completion"],
    },
    context: {
      files: ["src/auth.ts", "tests/auth.test.ts"],
      previous_handoffs: ["handoff-prev"],
      decisions: {
        dispatcher: "create-only",
      },
    },
  });
}

test("buildTaskPackageDir nests packages by workflow and handoff", () => {
  const packageDir = buildTaskPackageDir("/repo/project", "workflow-auth", "handoff-abc123");

  assert.equal(
    packageDir,
    path.join("/repo/project", ".hydra", "workflows", "workflow-auth", "handoff-abc123"),
  );
});

test("renderTaskPackageTemplate includes skills and output contract rules", () => {
  const context = createContext("/repo/project");
  const content = renderTaskPackageTemplate(context.contract);

  assert.match(content, /## Skills/);
  assert.match(content, /test-driven-development/);
  assert.match(content, /verification-before-completion/);
  assert.match(content, /## Input Contract/);
  assert.match(content, /## Output Contract/);
  assert.match(content, /result\.json/);
  assert.match(content, /done/);
  assert.match(content, /done marker must be valid JSON/i);
  assert.match(content, /"version": "hydra\/v2"/);
  assert.match(content, /"handoff_id": "handoff-abc123"/);
  assert.match(content, /"workflow_id": "workflow-auth"/);
  assert.match(content, /You must write both `result\.json` and `done` before finishing\./);
});

test("writeTaskPackage renders handoff.json and task.md with consistent paths", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-task-package-"));
  const context = createContext(rootDir);

  try {
    const written = writeTaskPackage(context.contract);
    const handoffJson = JSON.parse(fs.readFileSync(written.handoff_file, "utf-8"));
    const taskMd = fs.readFileSync(written.task_file, "utf-8");

    const validated = validateHandoffContract(handoffJson);

    assert.equal(validated.artifacts.package_dir, written.package_dir);
    assert.equal(validated.artifacts.result_file, written.result_file);
    assert.equal(validated.artifacts.done_file, written.done_file);
    assert.match(taskMd, new RegExp(written.result_file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(taskMd, new RegExp(written.done_file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
