#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadTasksFromFile, loadDefaultTasks, downloadAndFilter, taskMeta } from "./dataset.ts";
import { runEvaluation } from "./runner.ts";
import { listRuns, loadRunResult, generateRunId } from "./results.ts";
import { compareRuns, formatComparison } from "./compare.ts";
import type { EvalConfig, AgentMode, ModelConfig } from "./types.ts";
import { DEFAULT_MODELS } from "./types.ts";

const USAGE = `
eval - Hydra evaluation framework

Usage:
  eval run [options]       Run an evaluation
  eval compare <a> <b>     Compare two runs
  eval list                List all runs
  eval report <run_id>     Show run report
  eval download [options]  Download task set
  eval tasks <file>        Show task metadata

Run Options:
  --mode <mode>            Agent mode: single-claude, single-codex, hydra (default: single-claude)
  --tasks <file>           Task file path (default: auto-download SWE-bench multi-file)
  --prompt-version <ver>   Prompt version tag (default: v1)
  --run-id <id>            Custom run ID (default: auto-generated)
  --sub-agents <types>     Hydra sub-agent types, comma-separated (default: claude,codex)
  --timeout <seconds>      Per-task timeout (default: 600)
  --max-tasks <n>          Max tasks to run (for quick tests)
  --swebench-eval          Run SWE-bench Docker evaluation
  --benchmark <name>       Benchmark name (default: swe-bench)

Model Options:
  --claude-model <model>   Claude model for single-claude mode (default: sonnet)
  --codex-model <model>    Codex model for single-codex mode (default: codex config.toml)
  --orchestrator-model <m> Hydra orchestrator model (default: sonnet)
  --sub-claude-model <m>   Hydra sub-agent Claude model (default: sonnet)
  --sub-codex-model <m>    Hydra sub-agent Codex model (default: codex config.toml)

Download Options:
  --dataset <id>           HuggingFace dataset ID (default: princeton-nlp/SWE-bench)
  --split <split>          Dataset split (default: test)
  --min-files <n>          Minimum files changed (default: 2)
  --max-tasks <n>          Maximum tasks to download (default: 50)
  --output <name>          Output file name (without extension)

Examples:
  eval run --mode single-claude --max-tasks 5
  eval run --mode hydra --orchestrator claude --prompt-version v2
  eval compare run-20260322-001 run-20260322-002
  eval download --min-files 3 --max-tasks 20 --output swe-bench-complex
`;

const VALID_MODES: AgentMode[] = ["single-claude", "single-codex", "hydra"];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const rest = args.slice(1);

  switch (command) {
    case "run":
      await handleRun(rest);
      break;
    case "compare":
      await handleCompare(rest);
      break;
    case "list":
      await handleList();
      break;
    case "report":
      await handleReport(rest);
      break;
    case "download":
      await handleDownload(rest);
      break;
    case "tasks":
      await handleTasks(rest);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

async function handleRun(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      mode: { type: "string", default: "single-claude" },
      tasks: { type: "string" },
      "prompt-version": { type: "string", default: "v1" },
      "run-id": { type: "string" },
      "sub-agents": { type: "string", default: "claude,codex" },
      timeout: { type: "string", default: "600" },
      "max-tasks": { type: "string" },
      "max-workers": { type: "string", default: "1" },
      "swebench-eval": { type: "boolean", default: false },
      benchmark: { type: "string", default: "swe-bench" },
      // Model options
      "claude-model": { type: "string" },
      "codex-model": { type: "string" },
      "orchestrator-model": { type: "string" },
      "sub-claude-model": { type: "string" },
      "sub-codex-model": { type: "string" },
    },
  });

  const mode = values.mode as AgentMode;
  if (!VALID_MODES.includes(mode)) {
    console.error(
      `Invalid mode: ${mode}. Must be one of: ${VALID_MODES.join(", ")}`,
    );
    process.exit(1);
  }

  // Load tasks
  let tasks;
  if (values.tasks) {
    tasks = await loadTasksFromFile(values.tasks);
  } else {
    tasks = await loadDefaultTasks();
  }

  const maxTasks = values["max-tasks"]
    ? parseInt(values["max-tasks"], 10)
    : undefined;
  if (maxTasks !== undefined) {
    tasks = tasks.slice(0, maxTasks);
  }

  if (tasks.length === 0) {
    console.error("No tasks to run. Use --tasks or download a task set first.");
    process.exit(1);
  }

  const models: ModelConfig = {
    ...DEFAULT_MODELS,
    ...(values["claude-model"] && { claude_model: values["claude-model"] }),
    ...(values["codex-model"] && { codex_model: values["codex-model"] }),
    ...(values["orchestrator-model"] && { hydra_orchestrator_model: values["orchestrator-model"] }),
    ...(values["sub-claude-model"] && { hydra_sub_claude_model: values["sub-claude-model"] }),
    ...(values["sub-codex-model"] && { hydra_sub_codex_model: values["sub-codex-model"] }),
  };

  const config: EvalConfig = {
    run_id: values["run-id"] ?? generateRunId(),
    mode,
    models,
    sub_agent_types:
      mode === "hydra" ? values["sub-agents"]?.split(",") : undefined,
    prompt_version: values["prompt-version"] ?? "v1",
    benchmark: values.benchmark ?? "swe-bench",
    timeout_per_task_s: parseInt(values.timeout ?? "600", 10),
    max_workers: parseInt(values["max-workers"] ?? "1", 10),
    run_swebench_eval: values["swebench-eval"],
  };

  await runEvaluation(tasks, config);
}

async function handleCompare(args: string[]): Promise<void> {
  const [runA, runB] = args;
  if (!runA || !runB) {
    console.error("Usage: eval compare <run_id_a> <run_id_b>");
    process.exit(1);
  }

  const comparison = await compareRuns(runA, runB);
  console.log(formatComparison(comparison));
}

async function handleList(): Promise<void> {
  const runs = await listRuns();
  if (runs.length === 0) {
    console.log("No evaluation runs found.");
    return;
  }

  console.log("Available runs:\n");
  for (const runId of runs) {
    try {
      const result = await loadRunResult(runId);
      const { summary, config } = result;
      console.log(
        `  ${runId}  mode=${config.mode}  prompt=${config.prompt_version}  ` +
          `pass=${(summary.pass_rate * 100).toFixed(0)}%  ` +
          `tasks=${summary.total}  cost=$${summary.total_cost_usd.toFixed(2)}`,
      );
    } catch {
      console.log(`  ${runId}  (error loading result)`);
    }
  }
}

async function handleReport(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) {
    console.error("Usage: eval report <run_id>");
    process.exit(1);
  }

  const result = await loadRunResult(runId);
  const { config, summary, tasks } = result;

  console.log(`# Evaluation Report: ${result.run_id}`);
  console.log();
  console.log("## Configuration");
  console.log(`- Mode: ${config.mode}`);
  console.log(`- Prompt Version: ${config.prompt_version}`);
  console.log(`- Benchmark: ${config.benchmark}`);
  if (config.mode === "hydra") {
    console.log(`- Orchestrator: ${config.models.hydra_orchestrator_model}`);
  }
  if (config.sub_agent_types) {
    console.log(`- Sub-agents: ${config.sub_agent_types.join(", ")}`);
  }
  console.log(`- Started: ${result.started_at}`);
  console.log(`- Completed: ${result.completed_at}`);
  console.log();
  console.log("## Summary");
  console.log(`- Total Tasks: ${summary.total}`);
  console.log(`- Resolved: ${summary.resolved}`);
  console.log(`- Pass Rate: ${(summary.pass_rate * 100).toFixed(1)}%`);
  console.log(`- Total Tokens: ${summary.total_tokens.toLocaleString()}`);
  console.log(`- Total Cost: $${summary.total_cost_usd.toFixed(2)}`);
  console.log(`- Avg Duration: ${summary.avg_duration_s}s`);
  console.log();
  console.log("## Tasks");
  console.log();
  console.log("| Task | Pass | Tokens | Duration | Cost |");
  console.log("|------|------|--------|----------|------|");
  for (const task of tasks) {
    console.log(
      `| ${task.task_id} | ${task.pass ? "PASS" : "FAIL"} | ${task.tokens.toLocaleString()} | ${task.duration_s}s | $${task.cost_usd.toFixed(2)} |`,
    );
    if (task.error) {
      console.log(`| | Error: ${task.error.slice(0, 80)} | | | |`);
    }
  }
}

async function handleDownload(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      dataset: { type: "string", default: "princeton-nlp/SWE-bench" },
      split: { type: "string", default: "test" },
      "min-files": { type: "string", default: "2" },
      "max-tasks": { type: "string", default: "50" },
      output: { type: "string", default: "swe-bench-multi-file" },
    },
  });

  await downloadAndFilter({
    dataset: values.dataset ?? "princeton-nlp/SWE-bench",
    split: values.split ?? "test",
    minFiles: parseInt(values["min-files"] ?? "2", 10),
    maxTasks: parseInt(values["max-tasks"] ?? "50", 10),
    outputName: values.output ?? "swe-bench-multi-file",
  });
}

async function handleTasks(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error("Usage: eval tasks <file>");
    process.exit(1);
  }

  const tasks = await loadTasksFromFile(filePath);
  console.log(`Tasks in ${filePath}: ${tasks.length}\n`);
  console.log("| # | Instance ID | Repo | Files | Lines |");
  console.log("|---|-------------|------|-------|-------|");

  for (let i = 0; i < tasks.length; i++) {
    const meta = taskMeta(tasks[i]);
    console.log(
      `| ${i + 1} | ${meta.instance_id} | ${meta.repo} | ${meta.num_files} | ${meta.num_lines} |`,
    );
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
