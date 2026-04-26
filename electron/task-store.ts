import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
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
const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;

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
      if (task) {
        this.populateAttachmentsUrl(task);
        tasks.push(task);
      }
    }
    tasks.sort((a, b) => b.updated.localeCompare(a.updated));
    return tasks;
  }

  get(repo: string, id: string): Task | null {
    const filePath = this.taskPath(repo, id);
    if (!fs.existsSync(filePath)) return null;
    const task = this.readFile(filePath);
    if (task) this.populateAttachmentsUrl(task);
    return task;
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
    this.populateAttachmentsUrl(task);
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
    this.populateAttachmentsUrl(next);
    this.emit("task:updated", { task: next, repo: path.resolve(repo) });
    return next;
  }

  remove(repo: string, id: string): void {
    const filePath = this.taskPath(repo, id);
    if (!fs.existsSync(filePath)) {
      throw new TaskStoreError(`Task not found: ${id}`, 404);
    }
    fs.unlinkSync(filePath);
    const attachDir = path.join(this.repoDir(repo), `${id}.attachments`);
    if (fs.existsSync(attachDir)) {
      fs.rmSync(attachDir, { recursive: true, force: true });
    }
    this.emit("task:removed", { id, repo: path.resolve(repo) });
  }

  attachmentsDir(repo: string, id: string): string {
    if (!ID_REGEX.test(id)) {
      throw new TaskStoreError(`Invalid task id: ${id}`, 400);
    }
    return path.join(this.repoDir(repo), `${id}.attachments`);
  }

  // TODO(v1.5): enforce a size cap; today a 50MB paste writes 50MB.
  saveAttachment(
    repo: string,
    id: string,
    fileName: string,
    data: Buffer,
  ): { relativePath: string; absolutePath: string } {
    const taskFile = this.taskPath(repo, id);
    if (!fs.existsSync(taskFile)) {
      throw new TaskStoreError(`Task not found: ${id}`, 404);
    }

    const dir = this.attachmentsDir(repo, id);
    fs.mkdirSync(dir, { recursive: true });

    const ext = deriveExtension(fileName, data);

    for (let attempt = 0; attempt < 8; attempt++) {
      const basename = `${crypto.randomBytes(3).toString("hex")}.${ext}`;
      const absolutePath = path.join(dir, basename);
      if (fs.existsSync(absolutePath)) continue;

      const tmpPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
      const fd = fs.openSync(tmpPath, "w");
      try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, absolutePath);

      return {
        relativePath: `./${id}.attachments/${basename}`,
        absolutePath,
      };
    }
    throw new TaskStoreError("Could not allocate unique attachment basename", 500);
  }

  private populateAttachmentsUrl(task: Task): void {
    // Custom protocol so renderer can load these images regardless of its
    // origin (file:// in prod, http://localhost in dev — file:// images would
    // otherwise be blocked by webSecurity in dev). The handler in main.ts
    // re-validates that the resolved disk path stays under the tasks root.
    const fileUrl = pathToFileURL(this.attachmentsDir(task.repo, task.id));
    task.attachmentsUrl = `tc-attachment://local${fileUrl.pathname}`;
  }

  private repoDir(repo: string): string {
    const resolved = path.resolve(repo);
    const hash = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 12);
    return path.join(this.root, hash);
  }

  private taskPath(repo: string, id: string): string {
    if (!ID_REGEX.test(id)) {
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

function deriveExtension(fileName: string, data: Buffer): string {
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx > 0 && dotIdx < fileName.length - 1) {
    const ext = fileName.slice(dotIdx + 1).toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
  }
  return detectImageExtension(data);
}

function detectImageExtension(data: Buffer): string {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  )
    return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "jpg";
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38
  )
    return "gif";
  if (
    data.length >= 12 &&
    data.slice(0, 4).toString("ascii") === "RIFF" &&
    data.slice(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  return "png";
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
