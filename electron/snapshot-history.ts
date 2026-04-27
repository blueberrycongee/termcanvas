import fs from "fs";
import path from "path";
import { TERMCANVAS_DIR } from "./state-persistence";

const SNAPSHOTS_DIR = path.join(TERMCANVAS_DIR, "snapshots");

export interface SnapshotHistoryEntryMeta {
  id: string;
  savedAt: number;
  terminalCount: number;
  projectCount: number;
  label?: string;
}

interface AppendArgs {
  savedAt: number;
  terminalCount: number;
  projectCount: number;
  label?: string;
  body: unknown;
}

const MAX_RETAINED = 20;

const ENTRY_FILENAME_PATTERN = /^entry-(\d+)\.json$/;

function ensureDir() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

function entryPath(id: string): string {
  return path.join(SNAPSHOTS_DIR, `entry-${id}.json`);
}

function safeReadEntry(file: string): SnapshotHistoryEntryMeta | null {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<{
      id: unknown;
      savedAt: unknown;
      terminalCount: unknown;
      projectCount: unknown;
      label: unknown;
    }>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.savedAt !== "number" ||
      typeof parsed.terminalCount !== "number" ||
      typeof parsed.projectCount !== "number"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      savedAt: parsed.savedAt,
      terminalCount: parsed.terminalCount,
      projectCount: parsed.projectCount,
      label: typeof parsed.label === "string" ? parsed.label : undefined,
    };
  } catch (err) {
    console.warn(
      `[snapshotHistory] failed to read entry ${path.basename(file)}:`,
      err,
    );
    return null;
  }
}

function listEntryFiles(): { id: string; file: string }[] {
  ensureDir();
  return fs
    .readdirSync(SNAPSHOTS_DIR)
    .flatMap((name) => {
      const match = name.match(ENTRY_FILENAME_PATTERN);
      if (!match) return [];
      return [{ id: match[1], file: path.join(SNAPSHOTS_DIR, name) }];
    })
    .sort((a, b) => Number(b.id) - Number(a.id));
}

export class SnapshotHistory {
  list(): SnapshotHistoryEntryMeta[] {
    return listEntryFiles().flatMap(({ file }) => {
      const meta = safeReadEntry(file);
      return meta ? [meta] : [];
    });
  }

  read(id: string): unknown | null {
    if (!/^[0-9]+$/.test(id)) return null;
    const file = entryPath(id);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw) as { body?: unknown };
      return parsed.body ?? null;
    } catch (err) {
      console.error(`[snapshotHistory] failed to read body for ${id}:`, err);
      return null;
    }
  }

  append(args: AppendArgs): SnapshotHistoryEntryMeta {
    ensureDir();
    const id = String(args.savedAt);
    const entry = {
      id,
      savedAt: args.savedAt,
      terminalCount: args.terminalCount,
      projectCount: args.projectCount,
      label: args.label,
      body: args.body,
    };

    const file = entryPath(id);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(entry), "utf-8");
    fs.renameSync(tmp, file);

    this.prune();

    return {
      id,
      savedAt: args.savedAt,
      terminalCount: args.terminalCount,
      projectCount: args.projectCount,
      label: args.label,
    };
  }

  prune() {
    const files = listEntryFiles();
    if (files.length <= MAX_RETAINED) return;
    for (const { file } of files.slice(MAX_RETAINED)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.warn(
          `[snapshotHistory] failed to evict ${path.basename(file)}:`,
          err,
        );
      }
    }
  }
}
