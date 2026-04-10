import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearNodeFeedback,
  getReportFilePath,
  readNodeIntent,
  readWorkflowIntent,
  writeNodeFeedback,
  writeNodeIntent,
  writeWorkflowIntent,
  writeWorkflowSummary,
} from "../src/artifacts.ts";
import {
  getNodeFeedbackFile,
  getNodeIntentFile,
  getRunReportFile,
  getWorkflowIntentFile,
  getWorkflowSummaryFile,
} from "../src/layout.ts";

function makeRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-artifacts-test-"));
}

test("writeWorkflowIntent writes intent.md and returns the absolute path", () => {
  const repo = makeRepo();
  try {
    const filePath = writeWorkflowIntent(repo, "wf-1", "Add OAuth login");
    assert.equal(filePath, getWorkflowIntentFile(repo, "wf-1"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# Workflow Intent/);
    assert.match(content, /Add OAuth login/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readWorkflowIntent returns the file content when present and null otherwise", () => {
  const repo = makeRepo();
  try {
    const filePath = writeWorkflowIntent(repo, "wf-1", "Refactor billing");
    const content = readWorkflowIntent(filePath);
    assert.ok(content);
    assert.match(content, /Refactor billing/);

    const missing = readWorkflowIntent(path.join(repo, "missing.md"));
    assert.equal(missing, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeWorkflowSummary writes summary.md under outputs/", () => {
  const repo = makeRepo();
  try {
    const filePath = writeWorkflowSummary(repo, "wf-1", "All nodes completed.");
    assert.equal(filePath, getWorkflowSummaryFile(repo, "wf-1"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# Workflow Summary/);
    assert.match(content, /All nodes completed\./);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeNodeIntent writes nodes/{id}/intent.md with role and node id in the heading", () => {
  const repo = makeRepo();
  try {
    const filePath = writeNodeIntent(repo, "wf-1", "dev", "implementer", "Implement login form");
    assert.equal(filePath, getNodeIntentFile(repo, "wf-1", "dev"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# implementer — Node dev/);
    assert.match(content, /Implement login form/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readNodeIntent round-trips written content", () => {
  const repo = makeRepo();
  try {
    const filePath = writeNodeIntent(repo, "wf-1", "tester", "tester", "Verify the OAuth flow");
    const content = readNodeIntent(filePath);
    assert.ok(content);
    assert.match(content, /Verify the OAuth flow/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeNodeFeedback writes feedback.md and clearNodeFeedback removes it", () => {
  const repo = makeRepo();
  try {
    const filePath = writeNodeFeedback(repo, "wf-1", "dev", "Tests still failing.");
    assert.equal(filePath, getNodeFeedbackFile(repo, "wf-1", "dev"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# Feedback/);
    assert.match(content, /Tests still failing\./);

    clearNodeFeedback(repo, "wf-1", "dev");
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("clearNodeFeedback is a no-op when the feedback file does not exist", () => {
  const repo = makeRepo();
  try {
    assert.doesNotThrow(() => clearNodeFeedback(repo, "wf-1", "dev"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("getReportFilePath matches the canonical run report layout", () => {
  const repo = makeRepo();
  try {
    const reportPath = getReportFilePath(repo, "wf-1", "asg-1", "run-1");
    assert.equal(reportPath, getRunReportFile(repo, "wf-1", "asg-1", "run-1"));
    assert.match(reportPath, /\.hydra\/workflows\/wf-1\/assignments\/asg-1\/runs\/run-1\/report\.md$/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
