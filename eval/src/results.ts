import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  RunResult,
  TaskResult,
  EvalConfig,
  RunSummary,
} from "./types.ts";

const EVAL_ROOT = join(fileURLToPath(import.meta.url), "../..");
const RESULTS_DIR = join(EVAL_ROOT, "results");

/** Compute summary statistics from task results */
export function computeSummary(tasks: TaskResult[]): RunSummary {
  const resolved = tasks.filter((t) => t.pass).length;
  const totalTokens = tasks.reduce((sum, t) => sum + t.tokens, 0);
  const totalCost = tasks.reduce((sum, t) => sum + t.cost_usd, 0);
  const avgDuration =
    tasks.length > 0
      ? tasks.reduce((sum, t) => sum + t.duration_s, 0) / tasks.length
      : 0;

  return {
    total: tasks.length,
    resolved,
    pass_rate: tasks.length > 0 ? resolved / tasks.length : 0,
    total_tokens: totalTokens,
    total_cost_usd: Math.round(totalCost * 100) / 100,
    avg_duration_s: Math.round(avgDuration),
  };
}

/** Save a run result to disk */
export async function saveRunResult(result: RunResult): Promise<string> {
  const runDir = join(RESULTS_DIR, result.run_id);
  await mkdir(runDir, { recursive: true });

  const resultPath = join(runDir, "result.json");
  await writeFile(resultPath, JSON.stringify(result, null, 2));

  // Also save individual task results for easy inspection
  const tasksDir = join(runDir, "tasks");
  await mkdir(tasksDir, { recursive: true });
  for (const task of result.tasks) {
    const taskPath = join(tasksDir, `${task.task_id}.json`);
    await writeFile(taskPath, JSON.stringify(task, null, 2));
  }

  // Save a summary for quick reference
  const summaryPath = join(runDir, "summary.json");
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        run_id: result.run_id,
        config: result.config,
        summary: result.summary,
        started_at: result.started_at,
        completed_at: result.completed_at,
      },
      null,
      2,
    ),
  );

  return resultPath;
}

/** Load a run result from disk */
export async function loadRunResult(runId: string): Promise<RunResult> {
  const resultPath = join(RESULTS_DIR, runId, "result.json");
  const raw = await readFile(resultPath, "utf-8");
  return JSON.parse(raw) as RunResult;
}

/** List all available run IDs */
export async function listRuns(): Promise<string[]> {
  if (!existsSync(RESULTS_DIR)) return [];

  const entries = await readdir(RESULTS_DIR, { withFileTypes: true });
  const runs: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const resultPath = join(RESULTS_DIR, entry.name, "result.json");
      if (existsSync(resultPath)) {
        runs.push(entry.name);
      }
    }
  }

  return runs.sort();
}

/** Load all run results */
export async function loadAllRuns(): Promise<RunResult[]> {
  const runIds = await listRuns();
  return Promise.all(runIds.map(loadRunResult));
}

/** Generate a unique run ID */
export function generateRunId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `run-${date}-${time}-${rand}`;
}
