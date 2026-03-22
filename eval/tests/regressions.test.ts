import { describe, it } from "node:test";
import { strict as a } from "node:assert";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  chmod,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSWEBenchEval } from "../src/evaluator.ts";
import { runEvaluation } from "../src/runner.ts";
import { SingleCodexRunner } from "../src/agents/single.ts";
import { HydraRunner } from "../src/agents/hydra.ts";
import { DEFAULT_MODELS, type EvalConfig, type TaskDefinition } from "../src/types.ts";

const execFileAsync = promisify(execFile);
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = resolve(TESTS_DIR, "..");
const REPO_ROOT = resolve(EVAL_ROOT, "..");
const RESULTS_DIR = join(EVAL_ROOT, "results");

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    instance_id: "task-1",
    repo: "owner/repo",
    base_commit: "",
    problem_statement: "Fix the bug",
    hints_text: "",
    patch: "",
    test_patch: "",
    FAIL_TO_PASS: "[]",
    PASS_TO_PASS: "[]",
    version: "1",
    environment_setup_commit: "",
    created_at: "2026-03-22T00:00:00Z",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<EvalConfig> = {}): EvalConfig {
  return {
    run_id: "run-test",
    mode: "single-codex",
    models: { ...DEFAULT_MODELS },
    prompt_version: "v1",
    benchmark: "swe-bench",
    max_workers: 1,
    ...overrides,
  };
}

async function makeExecutable(
  dir: string,
  name: string,
  contents: string,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents);
  await chmod(path, 0o755);
  return path;
}

async function initGitRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: dir,
  });
  await writeFile(join(dir, "base.txt"), "base\n");
  await execFileAsync("git", ["add", "base.txt"], { cwd: dir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
  });
  return stdout.trim();
}

async function runProcess(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function withPath<T>(binDir: string, fn: () => Promise<T>): Promise<T> {
  const originalPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}:${originalPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

describe("eval regressions", () => {
  it("parses SWE-bench result files named with model and run id", async (t) => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const binDir = join(tempDir, "bin");
    const runId = `parse-${Date.now()}`;
    const predictionsPath = join(tempDir, "predictions.jsonl");
    const runDir = join(RESULTS_DIR, runId);

    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true });
      await rm(runDir, { recursive: true, force: true });
    });

    await mkdir(binDir, { recursive: true });
    await writeFile(predictionsPath, "");
    await makeExecutable(
      binDir,
      "python3",
      `#!/bin/sh
run_id=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--run_id" ]; then
    run_id="$2"
    shift 2
  else
    shift
  fi
done
printf '{"task-parse":{"resolved":true}}' > "fake-model.\${run_id}.json"
`,
    );

    const results = await withPath(binDir, async () =>
      runSWEBenchEval({
        predictionsPath,
        dataset: "SWE-bench/SWE-bench_Verified",
        runId,
        maxWorkers: 1,
      }),
    );

    a.equal(results.get("task-parse"), true);
  });

  it("maps swe-bench variants to the correct dataset names", async (t) => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const binDir = join(tempDir, "bin");
    const captureFile = join(tempDir, "python-args.txt");
    const runIds = [`dataset-pro-${Date.now()}`, `dataset-verified-${Date.now()}`];

    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true });
      for (const runId of runIds) {
        await rm(join(RESULTS_DIR, runId), { recursive: true, force: true });
      }
    });

    await mkdir(binDir, { recursive: true });
    await makeExecutable(
      binDir,
      "python3",
      `#!/bin/sh
printf '%s\n' "$@" > "$CAPTURE_ARGS_FILE"
run_id=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--run_id" ]; then
    run_id="$2"
    shift 2
  else
    shift
  fi
done
printf '{}' > "fake.\${run_id}.json"
`,
    );

    async function captureDataset(benchmark: string, runId: string): Promise<string> {
      return withPath(binDir, async () => {
        const originalCapture = process.env.CAPTURE_ARGS_FILE;
        process.env.CAPTURE_ARGS_FILE = captureFile;
        try {
          await runEvaluation(
            [],
            makeConfig({
              run_id: runId,
              benchmark,
              run_swebench_eval: true,
            }),
          );
        } finally {
          if (originalCapture === undefined) {
            delete process.env.CAPTURE_ARGS_FILE;
          } else {
            process.env.CAPTURE_ARGS_FILE = originalCapture;
          }
        }

        const args = (await readFile(captureFile, "utf-8")).trim().split("\n");
        const datasetIndex = args.indexOf("--dataset_name");
        return args[datasetIndex + 1];
      });
    }

    a.equal(
      await captureDataset("swe-bench-pro", runIds[0]),
      "ScaleAI/SWE-bench_Pro",
    );
    a.equal(
      await captureDataset("swe-bench-verified", runIds[1]),
      "SWE-bench/SWE-bench_Verified",
    );
  });

  it("treats --max-tasks 0 as an empty selection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const tasksPath = join(tempDir, "tasks.json");

    try {
      await writeFile(
        tasksPath,
        JSON.stringify([makeTask()], null, 2),
      );

      const result = await runProcess(
        "node",
        [
          "--experimental-strip-types",
          "--no-warnings",
          join(EVAL_ROOT, "src", "cli.ts"),
          "run",
          "--tasks",
          tasksPath,
          "--max-tasks",
          "0",
        ],
        { cwd: REPO_ROOT, env: process.env },
      );

      a.equal(result.code, 1);
      a.match(result.stderr, /No tasks to run/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("parses cost from the last line of codex JSONL output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const binDir = join(tempDir, "bin");
    const repoDir = join(tempDir, "repo");

    try {
      await mkdir(binDir, { recursive: true });
      await makeExecutable(
        binDir,
        "codex",
        `#!/bin/sh
printf '{"event":"start"}\n'
printf '{"cost_usd":1.75}\n'
`,
      );
      const baseCommit = await initGitRepo(repoDir);
      const runner = new SingleCodexRunner();
      const result = await withPath(binDir, async () =>
        runner.run(
          makeTask({ base_commit: baseCommit }),
          repoDir,
          makeConfig({ mode: "single-codex" }),
        ),
      );

      a.equal(result.cost_usd, 1.75);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("routes gpt orchestrator models through codex", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const binDir = join(tempDir, "bin");
    const codexLog = join(tempDir, "codex.log");
    const claudeLog = join(tempDir, "claude.log");
    const runner = new HydraRunner() as any;

    try {
      await mkdir(binDir, { recursive: true });
      await makeExecutable(
        binDir,
        "codex",
        `#!/bin/sh
printf '%s\n' "$@" > "$CODEX_LOG"
printf '["subtask"]\n'
`,
      );
      await makeExecutable(
        binDir,
        "claude",
        `#!/bin/sh
printf '%s\n' "$@" > "$CLAUDE_LOG"
printf '["subtask"]\n'
`,
      );

      await withPath(binDir, async () => {
        const originalCodexLog = process.env.CODEX_LOG;
        const originalClaudeLog = process.env.CLAUDE_LOG;
        process.env.CODEX_LOG = codexLog;
        process.env.CLAUDE_LOG = claudeLog;
        try {
          const plan = await runner.decompose(
            makeTask(),
            tempDir,
            makeConfig({
              mode: "hydra",
              models: {
                ...DEFAULT_MODELS,
                hydra_orchestrator_model: "gpt-5.4",
              },
            }),
          );

          a.deepEqual(plan, { subtasks: ["subtask"] });
        } finally {
          if (originalCodexLog === undefined) {
            delete process.env.CODEX_LOG;
          } else {
            process.env.CODEX_LOG = originalCodexLog;
          }
          if (originalClaudeLog === undefined) {
            delete process.env.CLAUDE_LOG;
          } else {
            process.env.CLAUDE_LOG = originalClaudeLog;
          }
        }
      });

      a.equal((await readFile(codexLog, "utf-8")).includes("-m"), true);
      await a.rejects(access(claudeLog));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses task-specific worktree paths and branch names for hydra sub-agents", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const binDir = join(tempDir, "bin");
    const repoA = join(tempDir, "task-a");
    const repoB = join(tempDir, "task-b");
    const runner = new HydraRunner() as any;
    let subA:
      | { branch: string | null; worktreePath: string | null; error?: string }
      | undefined;
    let subB:
      | { branch: string | null; worktreePath: string | null; error?: string }
      | undefined;

    try {
      await mkdir(binDir, { recursive: true });
      await makeExecutable(binDir, "codex", "#!/bin/sh\n");
      const baseA = await initGitRepo(repoA);
      const baseB = await initGitRepo(repoB);

      subA = await withPath(binDir, async () =>
        runner.runSubAgent(
          "subtask",
          makeTask({ instance_id: "task-a", base_commit: baseA }),
          repoA,
          "codex",
          makeConfig({ mode: "hydra" }),
          0,
          30,
        ),
      );
      subB = await withPath(binDir, async () =>
        runner.runSubAgent(
          "subtask",
          makeTask({ instance_id: "task-b", base_commit: baseB }),
          repoB,
          "codex",
          makeConfig({ mode: "hydra" }),
          0,
          30,
        ),
      );

      a.equal(subA.error, undefined);
      a.equal(subB.error, undefined);
      a.notEqual(subA.worktreePath, subB.worktreePath);
      a.notEqual(subA.branch, subB.branch);
      a.match(subA.worktreePath ?? "", /task-a/);
      a.match(subB.worktreePath ?? "", /task-b/);
    } finally {
      if (subA?.worktreePath) {
        await execFileAsync("git", ["worktree", "remove", subA.worktreePath, "--force"], {
          cwd: repoA,
        }).catch(() => {});
      }
      if (subA?.branch) {
        await execFileAsync("git", ["branch", "-D", subA.branch], {
          cwd: repoA,
        }).catch(() => {});
      }
      if (subB?.worktreePath) {
        await execFileAsync("git", ["worktree", "remove", subB.worktreePath, "--force"], {
          cwd: repoB,
        }).catch(() => {});
      }
      if (subB?.branch) {
        await execFileAsync("git", ["branch", "-D", subB.branch], {
          cwd: repoB,
        }).catch(() => {});
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skips failed hydra branches and reports merge failures", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const repoDir = join(tempDir, "repo");
    const baseCommit = await initGitRepo(repoDir);
    const runner = new HydraRunner() as any;

    try {
      await execFileAsync("git", ["checkout", "-b", "good-branch"], { cwd: repoDir });
      await writeFile(join(repoDir, "good.txt"), "good\n");
      await execFileAsync("git", ["add", "good.txt"], { cwd: repoDir });
      await execFileAsync("git", ["commit", "-m", "good"], { cwd: repoDir });

      await execFileAsync("git", ["checkout", "main"], { cwd: repoDir });
      await execFileAsync("git", ["checkout", "-b", "bad-branch"], { cwd: repoDir });
      await writeFile(join(repoDir, "bad.txt"), "bad\n");
      await execFileAsync("git", ["add", "bad.txt"], { cwd: repoDir });
      await execFileAsync("git", ["commit", "-m", "bad"], { cwd: repoDir });
      await execFileAsync("git", ["checkout", "main"], { cwd: repoDir });

      runner.decompose = async () => ({
        subtasks: ["good", "bad", "missing"],
      });
      runner.runSubAgent = async (subtask: string) => {
        if (subtask === "good") {
          return { branch: "good-branch", worktreePath: null };
        }
        if (subtask === "bad") {
          return {
            branch: "bad-branch",
            worktreePath: null,
            error: "sub-agent failed",
          };
        }
        return { branch: "missing-branch", worktreePath: null };
      };

      const result = await runner.run(
        makeTask({ base_commit: baseCommit }),
        repoDir,
        makeConfig({ mode: "hydra" }),
      );

      a.equal(result.error, undefined);
      a.match(result.model_patch, /good\.txt/);
      a.doesNotMatch(result.model_patch, /bad\.txt/);
      a.equal(result.merge_failures, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("updates results from harness logs written under the run output directory", async (t) => {
    const runId = `update-${Date.now()}`;
    const runDir = join(RESULTS_DIR, runId);
    const resultPath = join(runDir, "result.json");
    const reportPath = join(
      runDir,
      "swebench-eval",
      "logs",
      "run_evaluation",
      runId,
      "fake-model",
      "task-1",
      "report.json",
    );

    t.after(async () => {
      await rm(runDir, { recursive: true, force: true });
    });

    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          run_id: runId,
          config: makeConfig({ run_id: runId }),
          started_at: "2026-03-22T00:00:00Z",
          completed_at: "2026-03-22T00:01:00Z",
          tasks: [
            {
              task_id: "task-1",
              pass: false,
              model_patch: "patch",
              tokens: 0,
              duration_s: 0,
              cost_usd: 0,
            },
          ],
          summary: {
            total: 1,
            resolved: 0,
            pass_rate: 0,
            total_tokens: 0,
            total_cost_usd: 0,
            avg_duration_s: 0,
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          "task-1": {
            resolved: true,
            patch_successfully_applied: true,
            patch_exists: true,
          },
        },
        null,
        2,
      ),
    );

    const result = await runProcess(
      "python3",
      [join(EVAL_ROOT, "scripts", "update-results-with-swebench.py")],
      { cwd: REPO_ROOT, env: process.env },
    );

    a.equal(result.code, 0);
    const updated = JSON.parse(await readFile(resultPath, "utf-8"));
    a.equal(updated.tasks[0].pass, true);
    a.equal(updated.summary.resolved, 1);
  });

  it("runs SWE-bench evaluation only through the subprocess path", async (t) => {
    const tempDir = await mkdtemp(join(tmpdir(), "eval-regression-"));
    const runId = `script-${Date.now()}`;
    const packageDir = join(tempDir, "swebench", "harness");
    const directMarker = join(tempDir, "direct.txt");
    const subprocessMarker = join(tempDir, "subprocess.txt");
    const runDir = join(RESULTS_DIR, runId);

    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true });
      await rm(runDir, { recursive: true, force: true });
    });

    await mkdir(packageDir, { recursive: true });
    await writeFile(join(tempDir, "swebench", "__init__.py"), "");
    await writeFile(join(packageDir, "__init__.py"), "");
    await writeFile(
      join(packageDir, "run_evaluation.py"),
      `from pathlib import Path
import os

def main(*args, **kwargs):
    Path(os.environ["DIRECT_MARKER"]).write_text("direct")

if __name__ == "__main__":
    Path(os.environ["SUBPROCESS_MARKER"]).write_text("subprocess")
`,
    );
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "result.json"),
      JSON.stringify(
        {
          run_id: runId,
          config: { mode: "single-codex" },
          tasks: [
            {
              task_id: "task-1",
              model_patch: "diff --git a/a b/a\n",
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = await runProcess(
      "python3",
      [join(EVAL_ROOT, "scripts", "run-swebench-eval.py"), runId],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PYTHONPATH: tempDir,
          DIRECT_MARKER: directMarker,
          SUBPROCESS_MARKER: subprocessMarker,
        },
      },
    );

    a.equal(result.code, 0);
    await a.rejects(access(directMarker));
    a.equal(await readFile(subprocessMarker, "utf-8"), "subprocess");
  });
});
