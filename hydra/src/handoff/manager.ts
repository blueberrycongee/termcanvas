/**
 * Handoff Manager - 管理 agent 间的文件交接
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Handoff, HandoffStatus } from "./types.ts";

export class HandoffManager {
  private handoffsDir: string;

  constructor(workspaceRoot: string) {
    this.handoffsDir = path.join(workspaceRoot, ".hydra", "handoffs");
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    fs.mkdirSync(this.handoffsDir, { recursive: true });
  }

  generateHandoffId(): string {
    return `handoff-${crypto.randomBytes(6).toString("hex")}`;
  }

  getHandoffPath(handoffId: string): string {
    return path.join(this.handoffsDir, `${handoffId}.json`);
  }

  create(
    handoff: Omit<Handoff, "id" | "created_at" | "status" | "retry_count"> & Partial<Pick<Handoff, "id">>,
  ): Handoff {
    const fullHandoff: Handoff = {
      ...handoff,
      id: handoff.id ?? this.generateHandoffId(),
      created_at: new Date().toISOString(),
      status: "pending",
      retry_count: 0,
    };

    this.save(fullHandoff);
    return fullHandoff;
  }

  save(handoff: Handoff): void {
    const filePath = this.getHandoffPath(handoff.id);
    fs.writeFileSync(filePath, JSON.stringify(handoff, null, 2), "utf-8");
  }

  load(handoffId: string): Handoff | null {
    const filePath = this.getHandoffPath(handoffId);
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Handoff;
  }

  updateStatus(handoffId: string, status: HandoffStatus): void {
    const handoff = this.load(handoffId);
    if (!handoff) throw new Error(`Handoff not found: ${handoffId}`);

    handoff.status = status;
    this.save(handoff);
  }

  listPending(): Handoff[] {
    const files = fs.readdirSync(this.handoffsDir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const id = f.replace(".json", "");
        return this.load(id);
      })
      .filter((h): h is Handoff => h !== null && h.status === "pending");
  }

  complete(handoffId: string, result: NonNullable<Handoff["result"]>): void {
    const handoff = this.load(handoffId);
    if (!handoff) throw new Error(`Handoff not found: ${handoffId}`);

    handoff.status = "completed";
    handoff.result = {
      ...result,
      completed_at: new Date().toISOString(),
    };
    this.save(handoff);
  }
}
