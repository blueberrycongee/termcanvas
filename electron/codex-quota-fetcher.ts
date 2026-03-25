import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { QuotaData, QuotaFetchResult } from "../src/types/index.ts";

interface CodexRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface CodexRateLimits {
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
}

function toQuotaWindow(window: CodexRateLimitWindow | undefined): { utilization: number; resetsAt: string } | null {
  if (
    typeof window?.used_percent !== "number"
    || typeof window.resets_at !== "number"
  ) {
    return null;
  }

  return {
    utilization: Math.max(0, Math.min(1, window.used_percent / 100)),
    resetsAt: new Date(window.resets_at * 1000).toISOString(),
  };
}

export function parseCodexQuotaFromContent(content: string): QuotaData | null {
  const lines = content.split("\n");

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type !== "event_msg") continue;
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (payload?.type !== "token_count") continue;

    const rateLimits = payload.rate_limits as CodexRateLimits | undefined;
    const fiveHour = toQuotaWindow(rateLimits?.primary);
    const sevenDay = toQuotaWindow(rateLimits?.secondary);
    if (!fiveHour || !sevenDay) continue;

    return {
      fiveHour,
      sevenDay,
      fetchedAt: Date.now(),
    };
  }

  return null;
}

function walkCodexSessionFiles(dirPath: string, files: string[]): void {
  if (!fs.existsSync(dirPath)) return;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkCodexSessionFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
}

function listRecentCodexSessionFiles(): string[] {
  const codexDir = path.join(os.homedir(), ".codex");
  const files: string[] = [];

  walkCodexSessionFiles(path.join(codexDir, "sessions"), files);
  walkCodexSessionFiles(path.join(codexDir, "archived_sessions"), files);

  return files.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
}

export async function fetchCodexQuota(): Promise<QuotaFetchResult> {
  for (const filePath of listRecentCodexSessionFiles()) {
    try {
      const quota = parseCodexQuotaFromContent(fs.readFileSync(filePath, "utf-8"));
      if (quota) {
        return { ok: true, data: quota };
      }
    } catch {
      // Skip unreadable files and continue scanning older sessions.
    }
  }

  return { ok: false, rateLimited: false };
}
