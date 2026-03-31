import fs from "node:fs";

interface WatchEntry {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
}

export class FileTreeWatcher {
  private watchers = new Map<string, WatchEntry>();

  constructor(
    private hiddenDirs: Set<string>,
    private onChange: (dirPath: string) => void,
  ) {}

  watch(dirPath: string): void {
    if (this.watchers.has(dirPath)) return;

    try {
      const watcher = fs.watch(dirPath, (_eventType, filename) => {
        if (typeof filename === "string") {
          if (filename.startsWith(".") || this.hiddenDirs.has(filename)) return;
        }
        this.scheduleChange(dirPath);
      });

      watcher.on("error", () => {
        this.closeEntry(dirPath);
        this.onChange(dirPath);
      });

      this.watchers.set(dirPath, { watcher, timer: null });
    } catch {
      // directory may not exist
    }
  }

  unwatch(dirPath: string): void {
    this.closeEntry(dirPath);
  }

  unwatchAll(): void {
    for (const dirPath of [...this.watchers.keys()]) {
      this.closeEntry(dirPath);
    }
  }

  getWatchedDirs(): string[] {
    return [...this.watchers.keys()];
  }

  private scheduleChange(dirPath: string): void {
    const entry = this.watchers.get(dirPath);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.onChange(dirPath);
    }, 300);
  }

  private closeEntry(dirPath: string): void {
    const entry = this.watchers.get(dirPath);
    if (!entry) return;
    entry.watcher.close();
    if (entry.timer) clearTimeout(entry.timer);
    this.watchers.delete(dirPath);
  }
}
