import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hydraSrcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(hydraSrcDir, "..", "..");
const hydraCliPath = path.join(repoRoot, "hydra", "src", "cli.ts");
const tsxCliPath = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initRepo(): string {
  const repo = makeTempDir("hydra-standalone-e2e-");
  execFileSync("git", ["init", "--initial-branch", "main"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Hydra Test"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.email", "hydra@test.invalid"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  fs.writeFileSync(path.join(repo, "README.md"), "# Hydra standalone e2e\n", "utf-8");
  execFileSync("git", ["add", "README.md"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  return repo;
}

function createManagedWorktree(repo: string, label: string): {
  branch: string;
  worktreePath: string;
} {
  const worktreesRoot = path.join(repo, ".worktrees");
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const branch = `hydra/${label}`;
  const worktreePath = path.join(worktreesRoot, label);
  execFileSync("git", ["worktree", "add", "-b", branch, worktreePath, "main"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  return { branch, worktreePath };
}

function writeFakeAgentClis(binDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });

  const sharedHelpers = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

function lastArg() {
  return process.argv[process.argv.length - 1] ?? "";
}

function flagValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

function parseTaskPathFromPrompt(prompt) {
  const match = prompt.match(/read (.+?task\.md) FIRST/i);
  return match ? match[1] : null;
}

function readTaskSpec(taskPath) {
  const content = fs.readFileSync(taskPath, "utf8");
  const capture = (pattern, label) => {
    const match = content.match(pattern);
    if (!match) {
      throw new Error("Missing " + label + " in task.md");
    }
    return match[1].trim();
  };
  return {
    workbenchId: capture(/- Workbench ID: (.+)$/m, "workbench id"),
    assignmentId: capture(/- Assignment ID: (.+)$/m, "assignment id"),
    runId: capture(/- Run ID: (.+)$/m, "run id"),
    reportPath: capture(/^- Report: (.+)$/m, "report path"),
    resultPath: capture(/^- Result JSON: (.+)$/m, "result path"),
  };
}

function maybeCommitArtifact(spec) {
  const artifactPath = path.join(process.cwd(), spec.assignmentId + ".txt");
  const content = "assignment=" + spec.assignmentId + "\nrun=" + spec.runId + "\ncwd=" + process.cwd() + "\n";
  fs.writeFileSync(artifactPath, content, "utf8");
  try {
    cp.execFileSync("git", ["add", path.basename(artifactPath)], {
      cwd: process.cwd(),
      stdio: "pipe",
      encoding: "utf8",
    });
    cp.execFileSync("git", ["commit", "-m", "fake worker " + spec.assignmentId + " " + spec.runId], {
      cwd: process.cwd(),
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Hydra Test",
        GIT_AUTHOR_EMAIL: "hydra@test.invalid",
        GIT_COMMITTER_NAME: "Hydra Test",
        GIT_COMMITTER_EMAIL: "hydra@test.invalid",
      },
    });
  } catch {
    // Non-git workdirs are acceptable for this fake worker.
  }
}

function writeRunOutputs(spec, provider) {
  fs.mkdirSync(path.dirname(spec.reportPath), { recursive: true });
  fs.writeFileSync(
    spec.reportPath,
    "# Report\n\nprovider=" + provider + "\nassignment=" + spec.assignmentId + "\nrun=" + spec.runId + "\ncwd=" + process.cwd() + "\n",
    "utf8",
  );
  fs.writeFileSync(
    spec.resultPath,
    JSON.stringify({
      schema_version: "hydra/result/v0.1",
      workbench_id: spec.workbenchId,
      assignment_id: spec.assignmentId,
      run_id: spec.runId,
      outcome: "completed",
      report_file: path.basename(spec.reportPath),
    }, null, 2),
    "utf8",
  );
  maybeCommitArtifact(spec);
}
`;

const fakeCodex = String.raw`#!/usr/bin/env node
${sharedHelpers}

const args = process.argv.slice(2);
const prompt = lastArg();
const taskPath = parseTaskPathFromPrompt(prompt);
const resumeIdx = args.indexOf("resume");
if (taskPath) {
  const spec = readTaskSpec(taskPath);
  writeRunOutputs(spec, "codex");
  console.log(JSON.stringify({
    type: "thread.started",
    thread_id: "fake-codex-" + spec.assignmentId + "-" + spec.runId,
  }));
  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "completed " + spec.assignmentId,
    },
  }));
  process.exit(0);
}

if (args[0] === "exec" && resumeIdx !== -1) {
  const sessionId = args[resumeIdx + 1] ?? "missing-session";
  const requestedCd = flagValue("--cd") ?? process.cwd();
  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "follow-up cwd=" + process.cwd() + " requested_cd=" + requestedCd + " session=" + sessionId + " message=" + lastArg(),
    },
  }));
  process.exit(0);
}

console.error("fake codex could not determine whether this is a task run or follow-up");
process.exit(1);
`;

const fakeClaude = String.raw`#!/usr/bin/env node
${sharedHelpers}

const args = process.argv.slice(2);
const prompt = lastArg();
const taskPath = parseTaskPathFromPrompt(prompt);
const resumeIdx = args.indexOf("--resume");
if (taskPath) {
  const spec = readTaskSpec(taskPath);
  writeRunOutputs(spec, "claude");
  console.log(JSON.stringify({
    session_id: "fake-claude-" + spec.assignmentId + "-" + spec.runId,
    result: "completed " + spec.assignmentId,
  }));
  process.exit(0);
}

if (resumeIdx !== -1) {
  const sessionId = args[resumeIdx + 1] ?? "missing-session";
  console.log(JSON.stringify({
    session_id: "forked-" + sessionId,
    result: "follow-up cwd=" + process.cwd() + " session=" + sessionId + " message=" + lastArg(),
  }));
  process.exit(0);
}

console.error("fake claude could not determine whether this is a task run or follow-up");
process.exit(1);
`;

  const codexPath = path.join(binDir, "codex");
  const claudePath = path.join(binDir, "claude");
  fs.writeFileSync(codexPath, fakeCodex, { encoding: "utf-8", mode: 0o755 });
  fs.writeFileSync(claudePath, fakeClaude, { encoding: "utf-8", mode: 0o755 });
}

function makeStandaloneEnv(homeDir: string, binDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    HYDRA_HOME: path.join(homeDir, ".hydra-home"),
    HYDRA_STANDALONE: "1",
    HYDRA_LEAD_ID: "standalone-lead-test",
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    TERMCANVAS_URL: "",
    TERMCANVAS_HOST: "",
    TERMCANVAS_PORT: "",
    TERMCANVAS_TERMINAL_ID: "",
  };
}

function runHydra(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = repoRoot,
): string {
  return execFileSync(
    process.execPath,
    [tsxCliPath, hydraCliPath, ...args],
    {
      cwd,
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function runHydraJson<T>(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = repoRoot,
): T {
  return JSON.parse(runHydra(args, env, cwd)) as T;
}

function readJsonLines<T>(output: string): T[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

test("standalone workflow lifecycle runs without TermCanvas and asks in the dispatch worktree", () => {
  const repo = initRepo();
  const homeDir = makeTempDir("hydra-standalone-home-");
  const binDir = path.join(homeDir, "bin");
  writeFakeAgentClis(binDir);
  const env = makeStandaloneEnv(homeDir, binDir);

  try {
    const init = runHydraJson<{ workbench_id: string }>(
      ["init", "--intent", "Standalone lifecycle", "--repo", repo, "--worktree", repo],
      env,
    );
    const isolated = createManagedWorktree(repo, "standalone-dev");

    const dispatched = runHydraJson<{ dispatch_id: string; status: string }>(
      [
        "dispatch",
        "--workbench",
        init.workbench_id,
        "--dispatch",
        "dev",
        "--role",
        "dev",
        "--intent",
        "Implement the standalone lifecycle flow",
        "--repo",
        repo,
        "--worktree",
        isolated.worktreePath,
        "--worktree-branch",
        isolated.branch,
      ],
      env,
    );
    assert.equal(dispatched.status, "dispatched");

    const firstDecision = runHydraJson<{
      type: string;
      completed?: { dispatch_id: string; outcome: string };
    }>(
      [
        "watch",
        "--workbench",
        init.workbench_id,
        "--repo",
        repo,
        "--interval-ms",
        "20",
        "--timeout-ms",
        "5000",
      ],
      env,
    );
    assert.equal(firstDecision.type, "dispatch_completed");
    assert.equal(firstDecision.completed?.dispatch_id, "dev");
    assert.equal(firstDecision.completed?.outcome, "completed");

    const followUp = runHydraJson<{
      answer: string;
      cli: string;
      dispatch_id: string;
    }>(
      [
        "ask",
        "--workbench",
        init.workbench_id,
        "--dispatch",
        "dev",
        "--message",
        "Where did you run?",
        "--repo",
        repo,
      ],
      env,
    );
    assert.equal(followUp.dispatch_id, "dev");
    assert.equal(followUp.cli, "claude");
    assert.match(followUp.answer, new RegExp(isolated.worktreePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const status = runHydraJson<{
      workbench: { id: string; status: string };
      assignments: Array<{ id: string; status: string }>;
    }>(
      ["status", "--workbench", init.workbench_id, "--repo", repo],
      env,
    );
    assert.equal(status.workbench.id, init.workbench_id);
    assert.equal(status.workbench.status, "active");
    assert.equal(status.assignments[0]?.id, "dev");
    assert.equal(status.assignments[0]?.status, "in_progress");

    const ledger = readJsonLines<{ event: { type: string } }>(
      runHydra(["ledger", "--workbench", init.workbench_id, "--repo", repo, "--json"], env),
    );
    assert.ok(ledger.some((entry) => entry.event.type === "dispatch_started"));
    assert.ok(ledger.some((entry) => entry.event.type === "dispatch_completed"));
    assert.ok(ledger.some((entry) => entry.event.type === "lead_asked_followup"));

    const reset = runHydraJson<{ dispatch_id: string }>(
      [
        "reset",
        "--workbench",
        init.workbench_id,
        "--dispatch",
        "dev",
        "--repo",
        repo,
        "--feedback",
        "Run it again with the same contract",
      ],
      env,
    );
    assert.equal(reset.dispatch_id, "dev");

    const redispatched = runHydraJson<{ dispatch_id: string; status: string }>(
      ["redispatch", "--workbench", init.workbench_id, "--dispatch", "dev", "--repo", repo],
      env,
    );
    assert.equal(redispatched.dispatch_id, "dev");
    assert.equal(redispatched.status, "dispatched");

    const secondDecision = runHydraJson<{ type: string }>(
      [
        "watch",
        "--workbench",
        init.workbench_id,
        "--repo",
        repo,
        "--interval-ms",
        "20",
        "--timeout-ms",
        "5000",
      ],
      env,
    );
    assert.equal(secondDecision.type, "dispatch_completed");

    assert.equal(
      runHydra(
        ["approve", "--workbench", init.workbench_id, "--dispatch", "dev", "--repo", repo],
        env,
      ),
      "Approved.",
    );

    assert.equal(
      runHydra(
        ["complete", "--workbench", init.workbench_id, "--repo", repo, "--summary", "Standalone lifecycle complete"],
        env,
      ),
      "Workbench completed.",
    );

    const listed = runHydra(["list", "--workbenches", "--repo", repo], env);
    assert.match(listed, new RegExp(init.workbench_id));
    assert.match(listed, /\bcompleted\b/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("standalone merge flow succeeds and cleanup removes Hydra-managed dispatch worktrees", () => {
  const repo = initRepo();
  const homeDir = makeTempDir("hydra-standalone-home-");
  const binDir = path.join(homeDir, "bin");
  writeFakeAgentClis(binDir);
  const env = makeStandaloneEnv(homeDir, binDir);

  try {
    const init = runHydraJson<{ workbench_id: string }>(
      ["init", "--intent", "Standalone merge", "--repo", repo, "--worktree", repo],
      env,
    );
    const worktreeA = createManagedWorktree(repo, "merge-a");
    const worktreeB = createManagedWorktree(repo, "merge-b");

    for (const spec of [
      { id: "a", worktree: worktreeA },
      { id: "b", worktree: worktreeB },
    ]) {
      const dispatched = runHydraJson<{ status: string }>(
        [
          "dispatch",
          "--workbench",
          init.workbench_id,
          "--dispatch",
          spec.id,
          "--role",
          "reviewer",
          "--intent",
          `Implement ${spec.id}`,
          "--repo",
          repo,
          "--worktree",
          spec.worktree.worktreePath,
          "--worktree-branch",
          spec.worktree.branch,
        ],
        env,
      );
      assert.equal(dispatched.status, "dispatched");

      const decision = runHydraJson<{ type: string; completed?: { dispatch_id: string } }>(
        [
          "watch",
          "--workbench",
          init.workbench_id,
          "--repo",
          repo,
          "--interval-ms",
          "20",
          "--timeout-ms",
          "5000",
        ],
        env,
      );
      assert.equal(decision.type, "dispatch_completed");
      assert.equal(decision.completed?.dispatch_id, spec.id);
    }

    const merged = runHydraJson<{ status: string; commit_sha: string }>(
      [
        "merge",
        "--workbench",
        init.workbench_id,
        "--dispatches",
        "a,b",
        "--repo",
        repo,
      ],
      env,
    );
    assert.equal(merged.status, "merged");
    assert.ok(merged.commit_sha.length > 0);

    assert.equal(fs.existsSync(path.join(repo, "a.txt")), true);
    assert.equal(fs.existsSync(path.join(repo, "b.txt")), true);

    assert.equal(
      runHydra(
        ["cleanup", "--workbench", init.workbench_id, "--repo", repo, "--force"],
        env,
      ),
      `Cleaned up resources for workbench ${init.workbench_id}. State files preserved.`,
    );

    assert.equal(fs.existsSync(worktreeA.worktreePath), false);
    assert.equal(fs.existsSync(worktreeB.worktreePath), false);
    assert.equal(
      execFileSync("git", ["branch", "--list", worktreeA.branch], {
        cwd: repo,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim(),
      "",
    );
    assert.equal(
      execFileSync("git", ["branch", "--list", worktreeB.branch], {
        cwd: repo,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim(),
      "",
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("standalone spawn flow works without TermCanvas and can be listed and cleaned up", () => {
  const repo = initRepo();
  const homeDir = makeTempDir("hydra-standalone-home-");
  const binDir = path.join(homeDir, "bin");
  writeFakeAgentClis(binDir);
  const env = makeStandaloneEnv(homeDir, binDir);

  try {
    const spawned = runHydraJson<{
      agentId: string;
      branch: string | null;
      worktreePath: string;
    }>(
      ["spawn", "--task", "Standalone spawn", "--repo", repo, "--role", "reviewer"],
      env,
    );

    const listed = runHydra(["list", "--repo", repo], env);
    assert.match(listed, new RegExp(spawned.agentId));

    assert.equal(
      runHydra(["cleanup", spawned.agentId, "--force"], env),
      `Cleaned up ${spawned.agentId}.`,
    );
    assert.equal(fs.existsSync(spawned.worktreePath), false);
    if (spawned.branch) {
      assert.equal(
        execFileSync("git", ["branch", "--list", spawned.branch], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim(),
        "",
      );
    }

    assert.equal(runHydra(["list", "--repo", repo], env), "No agents.");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("standalone workbench can be marked failed without TermCanvas", () => {
  const repo = initRepo();
  const homeDir = makeTempDir("hydra-standalone-home-");
  const binDir = path.join(homeDir, "bin");
  writeFakeAgentClis(binDir);
  const env = makeStandaloneEnv(homeDir, binDir);

  try {
    const init = runHydraJson<{ workbench_id: string }>(
      ["init", "--intent", "Standalone fail", "--repo", repo, "--worktree", repo],
      env,
    );

    assert.equal(
      runHydra(
        ["fail", "--workbench", init.workbench_id, "--repo", repo, "--reason", "Intentional failure"],
        env,
      ),
      "Workbench failed.",
    );

    const status = runHydraJson<{
      workbench: { status: string; failure?: { message?: string } };
    }>(["status", "--workbench", init.workbench_id, "--repo", repo], env);
    assert.equal(status.workbench.status, "failed");
    assert.equal(status.workbench.failure?.message, "Intentional failure");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
