/**
 * JSONL session persistence — append-only transcript with resume support.
 *
 * Each message is appended as a single JSON line. Cost snapshots and
 * compaction markers are interspersed. Resume reads from the last
 * compaction marker and deduplicates by message UUID.
 */

import { randomUUID } from "node:crypto";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "./types.ts";
import type { CostState } from "./cost-tracker.ts";
import type { CompactionState } from "./compaction.ts";

export interface SessionConfig {
  sessionId?: string;
  persistDir: string;
  resumeFromId?: string;
}

export type TranscriptEntry =
  | { type: "message"; uuid: string; message: Message; timestamp: number }
  | { type: "cost_snapshot"; costState: CostState; timestamp: number }
  | { type: "compaction_marker"; boundary: number; timestamp: number };

export interface ResumedSession {
  messages: Message[];
  costState: CostState | undefined;
  compactionState: CompactionState;
}

export function generateSessionId(): string {
  return randomUUID();
}

export class SessionWriter {
  private filePath: string;
  private ready: Promise<void>;

  constructor(sessionId: string, persistDir: string) {
    this.filePath = join(persistDir, `${sessionId}.jsonl`);
    this.ready = mkdir(persistDir, { recursive: true }).then(() => {});
  }

  async appendMessage(msg: Message, uuid?: string): Promise<string> {
    await this.ready;
    const id = uuid ?? randomUUID();
    const entry: TranscriptEntry = {
      type: "message",
      uuid: id,
      message: msg,
      timestamp: Date.now(),
    };
    await appendFile(this.filePath, JSON.stringify(entry) + "\n");
    return id;
  }

  async appendCostSnapshot(costState: CostState): Promise<void> {
    await this.ready;
    const entry: TranscriptEntry = {
      type: "cost_snapshot",
      costState,
      timestamp: Date.now(),
    };
    await appendFile(this.filePath, JSON.stringify(entry) + "\n");
  }

  async appendCompactionMarker(boundary: number): Promise<void> {
    await this.ready;
    const entry: TranscriptEntry = {
      type: "compaction_marker",
      boundary,
      timestamp: Date.now(),
    };
    await appendFile(this.filePath, JSON.stringify(entry) + "\n");
  }
}

export async function resumeSession(
  sessionId: string,
  persistDir: string,
): Promise<ResumedSession> {
  const filePath = join(persistDir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return {
      messages: [],
      costState: undefined,
      compactionState: { consecutiveFailures: 0, lastCompactionTurn: 0, disabled: false },
    };
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  const entries: TranscriptEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      continue;
    }
  }

  let lastCompactionIdx = -1;
  let lastCostState: CostState | undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type === "compaction_marker") {
      lastCompactionIdx = i;
    }
    if (entry.type === "cost_snapshot") {
      lastCostState = entry.costState;
    }
  }

  const startIdx = lastCompactionIdx >= 0 ? lastCompactionIdx + 1 : 0;
  const messages: Message[] = [];
  for (let i = startIdx; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type === "message") {
      messages.push(entry.message);
    }
  }

  return {
    messages,
    costState: lastCostState,
    compactionState: {
      consecutiveFailures: 0,
      lastCompactionTurn: lastCompactionIdx >= 0 ? 1 : 0,
      disabled: false,
    },
  };
}
