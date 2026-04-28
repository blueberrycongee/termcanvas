import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import type {
  Pin,
  PinStatus,
  PinLink,
  CreatePinInput,
  UpdatePinInput,
} from "../shared/pin.js";
import { normalizePinBodyInput } from "../shared/pin.js";

export type { Pin, PinStatus, PinLink, CreatePinInput, UpdatePinInput };

const VALID_STATUSES: ReadonlySet<PinStatus> = new Set([
  "open",
  "done",
  "dropped",
]);
const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export class PinStore extends EventEmitter {
  constructor(private readonly root: string) {
    super();
  }

  list(repo: string): Pin[] {
    const dir = this.repoDir(repo);
    if (!fs.existsSync(dir)) return [];
    const pins: Pin[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      const filePath = path.join(dir, entry);
      try {
        const pin = this.readFile(filePath);
        if (pin) {
          this.populateAttachmentsUrl(pin);
          pins.push(pin);
        }
      } catch (err) {
        console.error(
          "[PinStore] skipping malformed pin file",
          filePath,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    pins.sort((a, b) => b.updated.localeCompare(a.updated));
    return pins;
  }

  get(repo: string, id: string): Pin | null {
    const filePath = this.pinPath(repo, id);
    if (!fs.existsSync(filePath)) return null;
    const pin = this.readFile(filePath);
    if (pin) this.populateAttachmentsUrl(pin);
    return pin;
  }

  create(input: CreatePinInput): Pin {
    if (!input.title?.trim()) {
      throw new PinStoreError("title is required", 400);
    }
    if (!input.repo?.trim()) {
      throw new PinStoreError("repo is required", 400);
    }
    if (input.status !== undefined && !VALID_STATUSES.has(input.status)) {
      throw new PinStoreError(`Invalid status: ${input.status}`, 400);
    }
    const repo = path.resolve(input.repo);
    const dir = this.repoDir(repo);
    fs.mkdirSync(dir, { recursive: true });

    const id = this.generateId(input.title, dir);
    const now = new Date().toISOString();
    const pin: Pin = {
      id,
      title: input.title.trim(),
      status: input.status ?? "open",
      repo,
      body: normalizePinBodyInput(input.body ?? ""),
      links: input.links ?? [],
      created: now,
      updated: now,
    };
    this.writeFile(this.pinPath(repo, id), pin);
    this.populateAttachmentsUrl(pin);
    this.emit("pin:created", { pin, repo: pin.repo });
    return pin;
  }

  update(repo: string, id: string, patch: UpdatePinInput): Pin {
    const existing = this.get(repo, id);
    if (!existing) throw new PinStoreError(`Pin not found: ${id}`, 404);

    if (patch.status !== undefined && !VALID_STATUSES.has(patch.status)) {
      throw new PinStoreError(`Invalid status: ${patch.status}`, 400);
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new PinStoreError("title cannot be empty", 400);
    }

    const next: Pin = {
      ...existing,
      title: patch.title?.trim() ?? existing.title,
      status: patch.status ?? existing.status,
      body:
        patch.body !== undefined
          ? normalizePinBodyInput(patch.body)
          : existing.body,
      links: patch.links ?? existing.links,
      updated: new Date().toISOString(),
    };
    this.writeFile(this.pinPath(repo, id), next);
    this.populateAttachmentsUrl(next);
    this.emit("pin:updated", { pin: next, repo: path.resolve(repo) });
    return next;
  }

  remove(repo: string, id: string): void {
    const filePath = this.pinPath(repo, id);
    if (!fs.existsSync(filePath)) {
      throw new PinStoreError(`Pin not found: ${id}`, 404);
    }
    fs.unlinkSync(filePath);
    const attachDir = path.join(this.repoDir(repo), `${id}.attachments`);
    if (fs.existsSync(attachDir)) {
      fs.rmSync(attachDir, { recursive: true, force: true });
    }
    this.emit("pin:removed", { id, repo: path.resolve(repo) });
  }

  attachmentsDir(repo: string, id: string): string {
    if (!ID_REGEX.test(id)) {
      throw new PinStoreError(`Invalid pin id: ${id}`, 400);
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
    const pinFile = this.pinPath(repo, id);
    if (!fs.existsSync(pinFile)) {
      throw new PinStoreError(`Pin not found: ${id}`, 404);
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
    throw new PinStoreError(
      "Could not allocate unique attachment basename",
      500,
    );
  }

  private populateAttachmentsUrl(pin: Pin): void {
    // Custom protocol so renderer can load these images regardless of its
    // origin (file:// in prod, http://localhost in dev — file:// images would
    // otherwise be blocked by webSecurity in dev). The handler in main.ts
    // re-validates that the resolved disk path stays under the pins root.
    const fileUrl = pathToFileURL(this.attachmentsDir(pin.repo, pin.id));
    pin.attachmentsUrl = `tc-attachment://local${fileUrl.pathname}`;
  }

  private repoDir(repo: string): string {
    const resolved = path.resolve(repo);
    const hash = crypto
      .createHash("sha1")
      .update(resolved)
      .digest("hex")
      .slice(0, 12);
    return path.join(this.root, hash);
  }

  private pinPath(repo: string, id: string): string {
    if (!ID_REGEX.test(id)) {
      throw new PinStoreError(`Invalid pin id: ${id}`, 400);
    }
    return path.join(this.repoDir(repo), `${id}.md`);
  }

  private generateId(title: string, dir: string): string {
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "pin";
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix = crypto.randomBytes(2).toString("hex");
      const id = `${slug}-${suffix}`;
      if (!fs.existsSync(path.join(dir, `${id}.md`))) return id;
    }
    throw new PinStoreError("Could not allocate unique pin id", 500);
  }

  private readFile(filePath: string): Pin | null {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) return null;
      const meta = parseFrontmatter(match[1]);
      const body = normalizePinBodyInput(match[2]);
      const status = meta.status as PinStatus;
      if (!VALID_STATUSES.has(status)) return null;
      if (
        typeof meta.id !== "string" ||
        !ID_REGEX.test(meta.id) ||
        typeof meta.title !== "string" ||
        typeof meta.repo !== "string" ||
        typeof meta.created !== "string" ||
        typeof meta.updated !== "string"
      ) {
        return null;
      }
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

  private writeFile(filePath: string, pin: Pin): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const frontmatter = [
      `id: ${pin.id}`,
      `title: ${escapeYamlString(pin.title)}`,
      `status: ${pin.status}`,
      `repo: ${escapeYamlString(pin.repo)}`,
      `links: ${JSON.stringify(pin.links)}`,
      `created: ${pin.created}`,
      `updated: ${pin.updated}`,
    ].join("\n");
    const content = `---\n${frontmatter}\n---\n\n${pin.body}\n`;
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  }
}

export class PinStoreError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
  ) {
    super(message);
    this.name = "PinStoreError";
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
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
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

function parseLinks(raw: string | undefined): PinLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is PinLink =>
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
