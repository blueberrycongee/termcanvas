import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  Task,
  TaskStatus,
  TaskLink,
  CreateTaskInput,
  UpdateTaskInput,
} from "../shared/task.js";

export type { Task, TaskStatus, TaskLink, CreateTaskInput, UpdateTaskInput };

const VALID_STATUSES: ReadonlySet<TaskStatus> = new Set(["open", "done", "dropped"]);

export class TaskStore extends EventEmitter {
  constructor(private readonly root: string) {
    super();
  }

  list(repo: string): Task[] {
    const dir = this.repoDir(repo);
    if (!fs.existsSync(dir)) return [];
    const tasks: Task[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      const filePath = path.join(dir, entry);
      const task = this.readFile(filePath);
      if (task) tasks.push(task);
    }
    tasks.sort((a, b) => b.updated.localeCompare(a.updated));
    return tasks;
  }

  get(repo: string, id: string): Task | null {
    const filePath = this.taskPath(repo, id);
    if (!fs.existsSync(filePath)) return null;
    return this.readFile(filePath);
  }

  create(input: CreateTaskInput): Task {
    if (!input.title?.trim()) {
      throw new TaskStoreError("title is required", 400);
    }
    if (!input.repo?.trim()) {
      throw new TaskStoreError("repo is required", 400);
    }
    const repo = path.resolve(input.repo);
    const dir = this.repoDir(repo);
    fs.mkdirSync(dir, { recursive: true });

    const id = this.generateId(input.title, dir);
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title: input.title.trim(),
      status: input.status ?? "open",
      repo,
      body: (input.body ?? "").trim(),
      links: input.links ?? [],
      created: now,
      updated: now,
    };
    this.writeFile(this.taskPath(repo, id), task);
    this.emit("task:created", { task, repo: task.repo });
    return task;
  }

  update(repo: string, id: string, patch: UpdateTaskInput): Task {
    const existing = this.get(repo, id);
    if (!existing) throw new TaskStoreError(`Task not found: ${id}`, 404);

    if (patch.status !== undefined && !VALID_STATUSES.has(patch.status)) {
      throw new TaskStoreError(`Invalid status: ${patch.status}`, 400);
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new TaskStoreError("title cannot be empty", 400);
    }

    const next: Task = {
      ...existing,
      title: patch.title?.trim() ?? existing.title,
      status: patch.status ?? existing.status,
      body: patch.body !== undefined ? patch.body.trim() : existing.body,
      links: patch.links ?? existing.links,
      updated: new Date().toISOString(),
    };
    this.writeFile(this.taskPath(repo, id), next);
    this.emit("task:updated", { task: next, repo: path.resolve(repo) });
    return next;
  }

  remove(repo: string, id: string): void {
    const filePath = this.taskPath(repo, id);
    if (!fs.existsSync(filePath)) {
      throw new TaskStoreError(`Task not found: ${id}`, 404);
    }
    fs.unlinkSync(filePath);
    this.emit("task:removed", { id, repo: path.resolve(repo) });
  }

  private repoDir(repo: string): string {
    const resolved = path.resolve(repo);
    const hash = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 12);
    return path.join(this.root, hash);
  }

  private taskPath(repo: string, id: string): string {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new TaskStoreError(`Invalid task id: ${id}`, 400);
    }
    return path.join(this.repoDir(repo), `${id}.md`);
  }

  private generateId(title: string, dir: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task";
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix = crypto.randomBytes(2).toString("hex");
      const id = `${slug}-${suffix}`;
      if (!fs.existsSync(path.join(dir, `${id}.md`))) return id;
    }
    throw new TaskStoreError("Could not allocate unique task id", 500);
  }

  private readFile(filePath: string): Task | null {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) return null;
      const meta = parseFrontmatter(match[1]);
      const body = match[2].trim();
      const status = meta.status as TaskStatus;
      if (!VALID_STATUSES.has(status)) return null;
      return {
        id: meta.id,
        title: meta.title,
        status,
        repo: meta.repo,
        body,
        links: parseLinks(meta.links),
        created: meta.created,
        updated: meta.updated,
      };
    } catch {
      return null;
    }
  }

  private writeFile(filePath: string, task: Task): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const frontmatter = [
      `id: ${task.id}`,
      `title: ${escapeYamlString(task.title)}`,
      `status: ${task.status}`,
      `repo: ${escapeYamlString(task.repo)}`,
      `links: ${JSON.stringify(task.links)}`,
      `created: ${task.created}`,
      `updated: ${task.updated}`,
    ].join("\n");
    const content = `---\n${frontmatter}\n---\n\n${task.body}\n`;
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  }
}

export class TaskStoreError extends Error {
  constructor(message: string, public readonly status: number = 500) {
    super(message);
    this.name = "TaskStoreError";
  }
}

function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = unescapeYamlString(m[2]);
  }
  return out;
}

function parseLinks(raw: string | undefined): TaskLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is TaskLink =>
        l && typeof l.type === "string" && typeof l.url === "string",
    );
  } catch {
    return [];
  }
}

function escapeYamlString(s: string): string {
  if (/^[\w./@:-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

function unescapeYamlString(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}
