import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskDefinition, TaskMeta } from "./types.ts";

const EVAL_ROOT = join(fileURLToPath(import.meta.url), "../..");
const TASKS_DIR = join(EVAL_ROOT, "tasks");

const HF_API_BASE = "https://datasets-server.huggingface.co";
const PAGE_SIZE = 100;

/** Count files changed in a unified diff patch */
export function countPatchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+?) b\//);
      if (match) {
        files.push(match[1]);
      }
    }
  }
  return files;
}

/** Count total lines changed in a patch */
export function countPatchLines(patch: string): number {
  let lines = 0;
  for (const line of patch.split("\n")) {
    if (
      (line.startsWith("+") || line.startsWith("-")) &&
      !line.startsWith("+++") &&
      !line.startsWith("---")
    ) {
      lines++;
    }
  }
  return lines;
}

/** Derive task metadata from a task definition */
export function taskMeta(task: TaskDefinition): TaskMeta {
  const files = countPatchFiles(task.patch);
  return {
    instance_id: task.instance_id,
    repo: task.repo,
    num_files: files.length,
    files_changed: files,
    num_lines: countPatchLines(task.patch),
  };
}

/** Load tasks from a local JSON file */
export async function loadTasksFromFile(
  filePath: string,
): Promise<TaskDefinition[]> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as TaskDefinition[];
}

/** Fetch SWE-bench dataset from HuggingFace API */
export async function fetchFromHuggingFace(
  dataset: string,
  split: string,
  maxRows?: number,
): Promise<TaskDefinition[]> {
  const tasks: TaskDefinition[] = [];
  let offset = 0;
  const limit = maxRows ?? Infinity;

  while (tasks.length < limit) {
    const batchSize = Math.min(PAGE_SIZE, limit - tasks.length);
    const url = `${HF_API_BASE}/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=${split}&offset=${offset}&length=${batchSize}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `HuggingFace API error: ${resp.status} ${resp.statusText}`,
      );
    }

    const data = (await resp.json()) as {
      rows: Array<{ row: TaskDefinition }>;
    };
    if (data.rows.length === 0) break;

    for (const { row } of data.rows) {
      tasks.push(row);
    }

    offset += data.rows.length;
    if (data.rows.length < batchSize) break;
  }

  return tasks;
}

/** Filter tasks by minimum number of files changed */
export function filterMultiFile(
  tasks: TaskDefinition[],
  minFiles: number = 2,
): TaskDefinition[] {
  return tasks.filter((t) => countPatchFiles(t.patch).length >= minFiles);
}

/** Filter tasks by repository */
export function filterByRepo(
  tasks: TaskDefinition[],
  repo: string,
): TaskDefinition[] {
  return tasks.filter((t) => t.repo === repo);
}

/** Download and cache a filtered task set */
export async function downloadAndFilter(options: {
  dataset: string;
  split: string;
  minFiles?: number;
  repos?: string[];
  maxTasks?: number;
  outputName: string;
}): Promise<TaskDefinition[]> {
  const { dataset, split, minFiles = 2, repos, maxTasks, outputName } = options;

  const outputPath = join(TASKS_DIR, `${outputName}.json`);
  if (existsSync(outputPath)) {
    console.log(`Using cached task set: ${outputPath}`);
    return loadTasksFromFile(outputPath);
  }

  console.log(`Fetching dataset: ${dataset} (split: ${split})`);
  const allTasks = await fetchFromHuggingFace(dataset, split);
  console.log(`Fetched ${allTasks.length} tasks`);

  let filtered = filterMultiFile(allTasks, minFiles);
  console.log(
    `After multi-file filter (>=${minFiles} files): ${filtered.length} tasks`,
  );

  if (repos && repos.length > 0) {
    filtered = filtered.filter((t) => repos.includes(t.repo));
    console.log(
      `After repo filter (${repos.join(", ")}): ${filtered.length} tasks`,
    );
  }

  if (maxTasks && filtered.length > maxTasks) {
    filtered = filtered.slice(0, maxTasks);
  }

  await writeFile(outputPath, JSON.stringify(filtered, null, 2));
  console.log(`Saved ${filtered.length} tasks to ${outputPath}`);

  return filtered;
}

/** Load the default multi-file task set (download if needed) */
export async function loadDefaultTasks(): Promise<TaskDefinition[]> {
  const defaultPath = join(TASKS_DIR, "swe-bench-multi-file.json");
  if (existsSync(defaultPath)) {
    return loadTasksFromFile(defaultPath);
  }

  return downloadAndFilter({
    dataset: "princeton-nlp/SWE-bench",
    split: "test",
    minFiles: 2,
    maxTasks: 50,
    outputName: "swe-bench-multi-file",
  });
}
