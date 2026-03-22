import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  EvalConfig,
  TaskDefinition,
  TaskResult,
  RunResult,
  AgentRunner,
  SWEBenchPrediction,
} from "./types.ts";
import { SingleClaudeRunner, SingleCodexRunner } from "./agents/single.ts";
import { HydraRunner } from "./agents/hydra.ts";
import {
  setupTaskWorkdir,
  writePredictions,
  runSWEBenchEval,
} from "./evaluator.ts";
import { computeSummary, saveRunResult, generateRunId } from "./results.ts";

/** Create the appropriate agent runner for the config */
function createRunner(config: EvalConfig): AgentRunner {
  switch (config.mode) {
    case "single-claude":
      return new SingleClaudeRunner();
    case "single-codex":
      return new SingleCodexRunner();
    case "hydra":
      return new HydraRunner();
    default:
      throw new Error(`Unknown mode: ${config.mode}`);
  }
}

/** Run a single task and return the result */
async function runTask(
  task: TaskDefinition,
  runner: AgentRunner,
  config: EvalConfig,
  workBaseDir: string,
  taskIndex: number,
  totalTasks: number,
): Promise<TaskResult> {
  console.log(`\n--- [${taskIndex + 1}/${totalTasks}] ${task.instance_id} ---`);
  console.log(`  Repo: ${task.repo}`);

  try {
    console.log(`  Setting up workdir...`);
    const workDir = await setupTaskWorkdir(task, workBaseDir);

    console.log(`  Running agent (mode: ${config.mode})...`);
    const agentResult = await runner.run(task, workDir, config);

    if (agentResult.error) {
      console.log(`  Error: ${agentResult.error}`);
      return {
        task_id: task.instance_id,
        pass: false,
        model_patch: agentResult.model_patch,
        tokens: agentResult.tokens,
        duration_s: agentResult.duration_s,
        cost_usd: agentResult.cost_usd,
        sub_agents: agentResult.sub_agents,
        merge_failures: agentResult.merge_failures,
        error: agentResult.error,
      };
    }

    const hasPatch = agentResult.model_patch.trim().length > 0;
    console.log(
      `  [${taskIndex + 1}/${totalTasks}] ${task.instance_id}: patch_generated=${hasPatch}`,
    );

    // pass/fail is determined later by SWE-bench Docker evaluation
    // (run scripts/run-swebench-eval.py after the run completes)
    return {
      task_id: task.instance_id,
      pass: false, // placeholder — real verdict from SWE-bench Docker
      model_patch: agentResult.model_patch,
      tokens: agentResult.tokens,
      duration_s: agentResult.duration_s,
      cost_usd: agentResult.cost_usd,
      sub_agents: agentResult.sub_agents,
      merge_failures: agentResult.merge_failures,
      eval_detail: {
        applied: hasPatch,
        tests_passed: false, // set by update-results-with-swebench.py
        eval_method: "pending-docker-eval",
      },
    };
  } catch (error) {
    console.error(
      `  [${taskIndex + 1}/${totalTasks}] ${task.instance_id}: FAILED - ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      task_id: task.instance_id,
      pass: false,
      model_patch: "",
      tokens: 0,
      duration_s: 0,
      cost_usd: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Run tasks with concurrency limit */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<unknown>,
): Promise<void> {
  const queue = items.map((item, i) => ({ item, index: i }));
  const active: Promise<void>[] = [];

  for (const { item, index } of queue) {
    const task = fn(item, index)
      .catch((err) => {
        console.error(`Task ${index} failed unexpectedly:`, err);
      })
      .then(() => {
        active.splice(active.indexOf(task), 1);
      });
    active.push(task);
    if (active.length >= concurrency) {
      await Promise.race(active);
    }
  }

  await Promise.all(active);
}

/** Main evaluation runner */
export async function runEvaluation(
  tasks: TaskDefinition[],
  config: EvalConfig,
): Promise<RunResult> {
  const runId = config.run_id ?? generateRunId();
  const updatedConfig = { ...config, run_id: runId };
  const maxWorkers = config.max_workers ?? 1;

  console.log(`\n========================================`);
  console.log(`Evaluation Run: ${runId}`);
  console.log(`Mode: ${config.mode}`);
  console.log(`Prompt Version: ${config.prompt_version}`);
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Workers: ${maxWorkers}`);
  if (config.mode === "single-claude") {
    console.log(`Model: ${config.models.claude_model}`);
  } else if (config.mode === "single-codex") {
    console.log(`Model: ${config.models.codex_model ?? "(codex default)"}`);
  } else if (config.mode === "hydra") {
    console.log(`Orchestrator: ${config.models.hydra_orchestrator_model}`);
    console.log(`Sub-agents: claude=${config.models.hydra_sub_claude_model}, codex=${config.models.hydra_sub_codex_model ?? "(default)"}`);
  }
  console.log(`========================================\n`);

  const runner = createRunner(config);
  const workBaseDir = join(tmpdir(), "eval-workdirs", runId);
  await mkdir(workBaseDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const taskResults: TaskResult[] = new Array(tasks.length);

  if (maxWorkers <= 1) {
    // Sequential execution
    for (let i = 0; i < tasks.length; i++) {
      const result = await runTask(
        tasks[i],
        runner,
        updatedConfig,
        workBaseDir,
        i,
        tasks.length,
      );
      taskResults[i] = result;

      const completed = taskResults.filter(Boolean);
      const resolved = completed.filter((t) => t.pass).length;
      console.log(
        `  Progress: ${resolved}/${completed.length} resolved (${((resolved / completed.length) * 100).toFixed(0)}%)`,
      );
    }
  } else {
    // Parallel execution with concurrency limit
    console.log(`Running ${tasks.length} tasks with ${maxWorkers} workers...\n`);
    await runWithConcurrency(tasks, maxWorkers, async (task, index) => {
      const result = await runTask(
        task,
        runner,
        updatedConfig,
        workBaseDir,
        index,
        tasks.length,
      );
      taskResults[index] = result;
    });
  }

  const completedAt = new Date().toISOString();

  // Optionally run SWE-bench Docker evaluation
  if (config.run_swebench_eval) {
    console.log("\nRunning SWE-bench Docker evaluation...");

    const predictions: SWEBenchPrediction[] = taskResults
      .filter((t) => t.model_patch)
      .map((t) => ({
        instance_id: t.task_id,
        model_name_or_path: `termcanvas-eval-${config.mode}`,
        model_patch: t.model_patch,
      }));

    const predictionsPath = join(workBaseDir, "predictions.jsonl");
    await writePredictions(predictions, predictionsPath);

    const swebenchResults = await runSWEBenchEval({
      predictionsPath,
      dataset:
        config.benchmark === "swe-bench-lite"
          ? "SWE-bench/SWE-bench_Lite"
          : config.benchmark === "swe-bench-pro"
            ? "ScaleAI/SWE-bench_Pro"
            : config.benchmark === "swe-bench-verified"
              ? "SWE-bench/SWE-bench_Verified"
              : "princeton-nlp/SWE-bench",
      runId,
    });

    for (const task of taskResults) {
      const swebenchPass = swebenchResults.get(task.task_id);
      if (swebenchPass !== undefined) {
        task.pass = swebenchPass;
        if (task.eval_detail) {
          task.eval_detail.tests_passed = swebenchPass;
        }
      }
    }
  }

  const result: RunResult = {
    run_id: runId,
    config: updatedConfig,
    started_at: startedAt,
    completed_at: completedAt,
    tasks: taskResults,
    summary: computeSummary(taskResults),
  };

  const savedPath = await saveRunResult(result);
  console.log(`\n========================================`);
  console.log(`Run complete: ${runId}`);
  console.log(`Results saved to: ${savedPath}`);
  console.log(`Summary:`);
  console.log(`  Total: ${result.summary.total}`);
  console.log(`  Resolved: ${result.summary.resolved}`);
  console.log(`  Pass Rate: ${(result.summary.pass_rate * 100).toFixed(1)}%`);
  console.log(`  Total Tokens: ${result.summary.total_tokens.toLocaleString()}`);
  console.log(`  Total Cost: $${result.summary.total_cost_usd.toFixed(2)}`);
  console.log(`  Avg Duration: ${result.summary.avg_duration_s}s`);
  console.log(`========================================\n`);

  return result;
}
