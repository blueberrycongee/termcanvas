import { stripAnsi } from "./ansiStripper";
import { SmartRenderParser } from "./parser";
import type { Segment } from "./types";

const PENDING_TIMEOUT_MS = 10_000;

export class SmartRenderPipeline {
  private parser: SmartRenderParser;
  private segments: Segment[] = [];

  constructor(initialLineOffset = 0) {
    this.parser = new SmartRenderParser(initialLineOffset);
  }

  feed(data: string): Segment[] {
    const stripped = stripAnsi(data);
    const newSegments = this.parser.feed(stripped, data);

    for (const segment of newSegments) {
      const existing = this.segments.findIndex((s) => s.id === segment.id);
      if (existing >= 0) {
        this.segments[existing] = segment;
      } else {
        this.segments.push(segment);
      }
    }

    return newSegments;
  }

  checkTimeouts(): Segment[] {
    const now = Date.now();
    const flushed: Segment[] = [];

    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i];
      if (
        segment.status === "pending" &&
        now - segment.createdAt > PENDING_TIMEOUT_MS
      ) {
        const converted: Segment = {
          ...segment,
          type: "raw",
          status: "complete",
        };
        this.segments[i] = converted;
        flushed.push(converted);
      }
    }

    return flushed;
  }

  getSegments(): readonly Segment[] {
    return this.segments;
  }

  reset(): void {
    this.parser.reset();
    this.segments = [];
  }
}
