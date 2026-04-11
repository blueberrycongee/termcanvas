import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderRunTask, writeRunTask } from "../src/run-task.ts";
import {
  getRunArtifactsDir,
  getRunResultFile,
  getRunTaskFile,
} from "../src/layout.ts";

function createSpec(repoPath: string) {
  return {
    repoPath,
    workflowId: "workflow-auth",
    assignmentId: "assignment-abc123",
    runId: "run-0001",
    role: "implementer",
    agentType: "codex",
    sourceRole: "tester",
    roleBody:
      "For this task, you are additionally playing an **implementer** role. Build the requested change.",
    objective: [
      "Implement the auth workflow using the approved research as the controlling input.",
      "",
      "Task: Build the new file-contract-driven auth workflow.",
    ],
    readFiles: [
      { label: "User request", path: path.join(repoPath, ".hydra", "workflows", "workflow-auth", "inputs", "user-request.md") },
      { label: "Approved research brief", path: path.join(repoPath, ".hydra", "workflows", "workflow-auth", "assignments", "assignment-res", "runs", "run-0001", "artifacts", "brief.md") },
    ],
    writeTargets: [
      {
        label: "Brief",
        path: path.join(repoPath, ".hydra", "workflows", "workflow-auth", "assignments", "assignment-abc123", "runs", "run-0001", "artifacts", "brief.md"),
        note: "This is the main human-readable brief for the next stage.",
      },
      {
        label: "Result JSON",
        path: getRunResultFile(repoPath, "workflow-auth", "assignment-abc123", "run-0001"),
        note: "Write this atomically after every required artifact is complete.",
      },
    ],
    decisionRules: [
      "- Use the approved research and user request as controlling inputs.",
      "- If the approved assumptions fail, return a replan instead of forcing a brittle implementation.",
    ],
    acceptanceCriteria: [
      "Implement the requested change without test hacking",
      "Write brief.md before publishing result.json",
    ],
    skills: [],
    extraSections: [
      {
        title: "Implementation Strategy",
        lines: [
          "- Treat the approved brief as the contract for what to build and what not to build.",
          "- Update code and tests honestly; do not fake success by weakening checks.",
        ],
      },
    ],
  };
}

test("renderRunTask renders a role-driven task file", () => {
  const content = renderRunTask(createSpec("/repo/project"));

  // ## Role section comes first and contains the role body briefing.
  assert.match(content, /## Role/);
  assert.match(content, /additionally playing an \*\*implementer\*\*/);

  // ## Run Context holds the workflow/assignment/run identity bullets.
  assert.match(content, /## Run Context/);
  assert.match(content, /Role: implementer/);
  assert.match(content, /Assignment ID: assignment-abc123/);
  assert.match(content, /Run ID: run-0001/);
  assert.match(content, /Source role: tester/);

  assert.match(content, /## Objective/);
  assert.match(content, /file-contract-driven auth workflow/);
  assert.match(content, /## Read First/);
  assert.match(content, /User request/);
  assert.match(content, /Approved research brief/);
  assert.match(content, /## Write Targets/);
  assert.match(content, /Brief/);
  assert.match(content, /Result JSON/);
  assert.match(content, /## Decision Rules/);
  assert.match(content, /replan/i);
  assert.match(content, /## Acceptance Criteria/);
  assert.match(content, /without test hacking/i);
  // Skills section is suppressed when nothing declares skills.
  assert.doesNotMatch(content, /## Skills/);
  assert.match(content, /## Implementation Strategy/);
  assert.match(content, /approved brief as the contract/i);
  assert.match(content, /## Operational Notes/);
  assert.match(content, /Hydra does not infer completion from terminal prose/i);
  assert.match(content, /## Completion/);
  assert.match(content, /Publish result\.json atomically/i);
  assert.doesNotMatch(content, /\bdone\b/i);
});

test("renderRunTask omits the Role section when no role body is provided", () => {
  const spec = createSpec("/repo/project");
  delete (spec as { roleBody?: string }).roleBody;
  const content = renderRunTask(spec);
  // The Run Context block must still render even without a role body.
  assert.match(content, /## Run Context/);
  // No bare ## Role header should appear.
  assert.doesNotMatch(content, /\n## Role\n/);
});

test("writeRunTask writes task.md inside the assignment run directory", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-run-task-"));
  const spec = createSpec(repoPath);

  try {
    const written = writeRunTask(spec);
    const taskFile = getRunTaskFile(repoPath, "workflow-auth", "assignment-abc123", "run-0001");
    const resultFile = getRunResultFile(repoPath, "workflow-auth", "assignment-abc123", "run-0001");
    const artifactsDir = getRunArtifactsDir(repoPath, "workflow-auth", "assignment-abc123", "run-0001");
    const taskMd = fs.readFileSync(taskFile, "utf-8");

    assert.equal(written.task_file, taskFile);
    assert.equal(written.result_file, resultFile);
    assert.equal(written.artifact_dir, artifactsDir);
    assert.equal(fs.existsSync(artifactsDir), true);
    assert.match(taskMd, new RegExp(resultFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
