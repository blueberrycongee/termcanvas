import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearDispatchFeedback,
  getReportFilePath,
  readDispatchIntent,
  readWorkbenchIntent,
  writeDispatchFeedback,
  writeDispatchIntent,
  writeWorkbenchIntent,
  writeWorkbenchSummary,
} from "../src/artifacts.ts";
import {
  getDispatchFeedbackFile,
  getDispatchIntentFile,
  getRunReportFile,
  getWorkbenchIntentFile,
  getWorkbenchSummaryFile,
} from "../src/layout.ts";

function makeRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-artifacts-test-"));
}

test("writeWorkbenchIntent writes intent.md and returns the absolute path", () => {
  const repo = makeRepo();
  try {
    const filePath = writeWorkbenchIntent(repo, "wf-1", "Add OAuth login");
    assert.equal(filePath, getWorkbenchIntentFile(repo, "wf-1"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# Workbench Intent/);
    assert.match(content, /Add OAuth login/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readWorkbenchIntent returns the file content when present and null otherwise", () => {
  const repo = makeRepo();
  try {
    const filePath = writeWorkbenchIntent(repo, "wf-1", "Refactor billing");
    const content = readWorkbenchIntent(filePath);
    assert.ok(content);
    assert.match(content, /Refactor billing/);

    const missing = readWorkbenchIntent(path.join(repo, "missing.md"));
    assert.equal(missing, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeWorkbenchSummary writes summary.md under outputs/", () => {
  const repo = makeRepo();
  try {
    const filePath = writeWorkbenchSummary(repo, "wf-1", "All nodes completed.");
    assert.equal(filePath, getWorkbenchSummaryFile(repo, "wf-1"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# Workbench Summary/);
    assert.match(content, /All nodes completed\./);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeDispatchIntent writes nodes/{id}/intent.md with role and node id in the heading", () => {
  const repo = makeRepo();
  try {
    const filePath = writeDispatchIntent(repo, "wf-1", "dev", "dev", "Implement login form");
    assert.equal(filePath, getDispatchIntentFile(repo, "wf-1", "dev"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# dev — dev/);
    assert.match(content, /Implement login form/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readDispatchIntent round-trips written content", () => {
  const repo = makeRepo();
  try {
    const filePath = writeDispatchIntent(repo, "wf-1", "review", "reviewer", "Verify the OAuth flow");
    const content = readDispatchIntent(filePath);
    assert.ok(content);
    assert.match(content, /Verify the OAuth flow/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("writeDispatchFeedback writes feedback.md and clearDispatchFeedback removes it", () => {
  const repo = makeRepo();
  try {
    const filePath = writeDispatchFeedback(repo, "wf-1", "dev", "Tests still failing.");
    assert.equal(filePath, getDispatchFeedbackFile(repo, "wf-1", "dev"));
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.match(content, /# Feedback/);
    assert.match(content, /Tests still failing\./);

    clearDispatchFeedback(repo, "wf-1", "dev");
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("clearDispatchFeedback is a no-op when the feedback file does not exist", () => {
  const repo = makeRepo();
  try {
    assert.doesNotThrow(() => clearDispatchFeedback(repo, "wf-1", "dev"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("getReportFilePath matches the canonical run report layout", () => {
  const repo = makeRepo();
  try {
    const reportPath = getReportFilePath(repo, "wf-1", "asg-1", "run-1");
    assert.equal(reportPath, getRunReportFile(repo, "wf-1", "asg-1", "run-1"));
    assert.match(reportPath, /\.hydra\/workbenches\/wf-1\/dispatches\/asg-1\/runs\/run-1\/report\.md$/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
