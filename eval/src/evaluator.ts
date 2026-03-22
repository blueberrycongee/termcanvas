import { execFile } from "node:child_process";
import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { TaskDefinition, SWEBenchPrediction } from "./types.ts";

const EVAL_ROOT = join(fileURLToPath(import.meta.url), "../..");
const REPO_CACHE_DIR = join(tmpdir(), "eval-repo-cache");

/** Run a command and return stdout */
function exec(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: options.cwd,
        timeout: (options.timeout ?? 600) * 1000,
        maxBuffer: 50 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(error);
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      },
    );
  });
}

/** Write predictions to JSONL for SWE-bench evaluation */
export async function writePredictions(
  predictions: SWEBenchPrediction[],
  outputPath: string,
): Promise<void> {
  const lines = predictions.map((p) => JSON.stringify(p)).join("\n") + "\n";
  await writeFile(outputPath, lines);
}

/** Run SWE-bench Docker evaluation on predictions */
export async function runSWEBenchEval(options: {
  predictionsPath: string;
  dataset: string;
  runId: string;
  maxWorkers?: number;
}): Promise<Map<string, boolean>> {
  const { predictionsPath, dataset, runId, maxWorkers = 4 } = options;

  const outputDir = join(EVAL_ROOT, "results", runId, "swebench-eval");
  await mkdir(outputDir, { recursive: true });

  try {
    const { stdout, stderr } = await exec(
      "python3",
      [
        "-m",
        "swebench.harness.run_evaluation",
        "--dataset_name",
        dataset,
        "--predictions_path",
        predictionsPath,
        "--max_workers",
        String(maxWorkers),
        "--run_id",
        runId,
        "--cache_level",
        "env",
      ],
      { cwd: outputDir, timeout: 3600 },
    );

    console.log("SWE-bench evaluation output:", stdout);
    if (stderr) console.error("SWE-bench stderr:", stderr);

    return parseSWEBenchResults(outputDir, runId);
  } catch (error) {
    console.error("SWE-bench evaluation failed:", error);
    console.log("Falling back to patch-based evaluation");
    return new Map();
  }
}

/** Parse SWE-bench evaluation results from output directory */
async function parseSWEBenchResults(
  outputDir: string,
  runId: string,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  const resultsFile = (await readdir(outputDir)).find((file) =>
    file.endsWith(`.${runId}.json`),
  );
  if (resultsFile) {
    const resultsPath = join(outputDir, resultsFile);
    const raw = await readFile(resultsPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, { resolved: boolean }>;
    for (const [instanceId, result] of Object.entries(data)) {
      results.set(instanceId, result.resolved);
    }
  }

  return results;
}

/** Simple patch-based evaluation (fallback when SWE-bench Docker not available) */
export function evaluatePatchSimple(
  modelPatch: string,
  goldPatch: string,
): { applied: boolean; similarity: number } {
  if (!modelPatch.trim()) {
    return { applied: false, similarity: 0 };
  }

  const modelFiles = extractPatchFiles(modelPatch);
  const goldFiles = extractPatchFiles(goldPatch);

  const modelFileSet = new Set(modelFiles);
  const goldFileSet = new Set(goldFiles);
  const intersection = new Set(
    [...modelFileSet].filter((f) => goldFileSet.has(f)),
  );

  const fileOverlap =
    goldFileSet.size > 0 ? intersection.size / goldFileSet.size : 0;

  const modelLines = extractChangedLines(modelPatch);
  const goldLines = extractChangedLines(goldPatch);
  const lineOverlap = computeLineOverlap(modelLines, goldLines);

  const similarity = fileOverlap * 0.4 + lineOverlap * 0.6;

  return {
    applied: modelPatch.trim().length > 0,
    similarity,
  };
}

/** Extract file paths from a unified diff */
function extractPatchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+?) b\//);
      if (match) files.push(match[1]);
    }
  }
  return files;
}

/** Extract added/removed lines from a patch */
function extractChangedLines(patch: string): Set<string> {
  const lines = new Set<string>();
  for (const line of patch.split("\n")) {
    if (
      (line.startsWith("+") || line.startsWith("-")) &&
      !line.startsWith("+++") &&
      !line.startsWith("---") &&
      !line.startsWith("diff ")
    ) {
      lines.add(line.slice(1).trim());
    }
  }
  return lines;
}

/** Compute overlap between two sets of lines */
function computeLineOverlap(a: Set<string>, b: Set<string>): number {
  if (b.size === 0) return 0;
  const intersection = new Set([...a].filter((line) => b.has(line)));
  return intersection.size / b.size;
}

/** Get or create a cached bare clone of a repository */
async function getRepoCachePath(repo: string): Promise<string> {
  await mkdir(REPO_CACHE_DIR, { recursive: true });
  const safeRepo = repo.replace(/\//g, "__");
  const cachePath = join(REPO_CACHE_DIR, safeRepo);

  if (existsSync(cachePath)) {
    // Update the cache
    console.log(`  Using cached repo: ${repo}`);
    await exec("git", ["fetch", "--all"], {
      cwd: cachePath,
      timeout: 120,
    }).catch(() => {});
    return cachePath;
  }

  console.log(`  Cloning repo (first time): ${repo}`);
  const repoUrl = `https://github.com/${repo}.git`;
  await exec("git", ["clone", "--bare", repoUrl, cachePath], {
    timeout: 600,
  });

  return cachePath;
}

/** Setup a task's working directory using repo cache */
export async function setupTaskWorkdir(
  task: TaskDefinition,
  baseDir: string,
): Promise<string> {
  const safeId = task.instance_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const workDir = join(baseDir, safeId);

  if (existsSync(workDir)) {
    // Reset to base commit
    await exec("git", ["checkout", "-f", task.base_commit], {
      cwd: workDir,
      timeout: 60,
    });
    await exec("git", ["clean", "-fd"], { cwd: workDir, timeout: 30 });
    return workDir;
  }

  // Clone from cache
  const cachePath = await getRepoCachePath(task.repo);
  await exec("git", ["clone", cachePath, workDir], { timeout: 300 });

  // Add the original remote for proper diff headers
  await exec(
    "git",
    ["remote", "set-url", "origin", `https://github.com/${task.repo}.git`],
    { cwd: workDir, timeout: 10 },
  );

  await exec("git", ["checkout", "-f", task.base_commit], {
    cwd: workDir,
    timeout: 60,
  });

  return workDir;
}
