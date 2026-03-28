import fs from "node:fs";
import type { FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MemoryNode {
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  type: string;
  body: string;
  mtime: number;
  ctime: number;
}

export interface MemoryEdge {
  source: string;
  target: string;
  label: string;
}

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  dirPath: string;
}

export interface MemoryFile {
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  type: string;
  body: string;
  mtime: number;
  ctime: number;
}

export function parseMemoryFile(filePath: string): MemoryFile | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
      return {
        fileName,
        filePath,
        name: fileName.replace(/\.md$/, ""),
        description: "",
        type: "unknown",
        body: raw,
        mtime: stat.mtimeMs,
        ctime: stat.birthtimeMs,
      };
    }

    const frontmatter = fmMatch[1];
    const body = fmMatch[2].trim();

    const get = (key: string): string => {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m ? m[1].trim() : "";
    };

    return {
      fileName,
      filePath,
      name: get("name"),
      description: get("description"),
      type: get("type"),
      body,
      mtime: stat.mtimeMs,
      ctime: stat.birthtimeMs,
    };
  } catch {
    return null;
  }
}

export function scanMemoryDir(dirPath: string): MemoryGraph {
  const empty: MemoryGraph = { nodes: [], edges: [], dirPath };

  if (!fs.existsSync(dirPath)) return empty;

  let entries: string[];
  try {
    entries = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"));
  } catch {
    return empty;
  }

  if (entries.length === 0) return empty;

  const nodes: MemoryNode[] = [];
  const edges: MemoryEdge[] = [];

  for (const entry of entries) {
    const filePath = path.join(dirPath, entry);

    if (entry === "MEMORY.md") {
      let raw: string;
      let stat: fs.Stats;
      try {
        raw = fs.readFileSync(filePath, "utf-8");
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      nodes.push({
        fileName: entry,
        filePath,
        name: "MEMORY",
        description: "",
        type: "index",
        body: raw,
        mtime: stat.mtimeMs,
        ctime: stat.birthtimeMs,
      });

      // Parse markdown links: [Title](file.md)
      const linkRe = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(raw)) !== null) {
        edges.push({
          source: "MEMORY.md",
          target: m[2],
          label: m[1],
        });
      }
    } else {
      const parsed = parseMemoryFile(filePath);
      if (parsed) {
        nodes.push(parsed);
      }
    }
  }

  return { nodes, edges, dirPath };
}

export function getMemoryDirForWorktree(worktreePath: string): string {
  const homeDir = os.homedir();
  const projectId = worktreePath.replace(/[\\/]/g, "-");
  return path.join(homeDir, ".claude", "projects", projectId, "memory");
}

const watchers = new Map<
  string,
  { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null }
>();

export function watchMemoryDir(
  dirPath: string,
  onChange: () => void,
): void {
  unwatchMemoryDir(dirPath);
  if (!fs.existsSync(dirPath)) return;

  const entry: { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null } = {
    watcher: fs.watch(dirPath, () => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(onChange, 500);
    }),
    timer: null,
  };
  watchers.set(dirPath, entry);
}

export function unwatchMemoryDir(dirPath: string): void {
  const existing = watchers.get(dirPath);
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer);
    existing.watcher.close();
    watchers.delete(dirPath);
  }
}
