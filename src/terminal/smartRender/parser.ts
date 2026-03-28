import type { Segment, SegmentMeta, SegmentType } from "./types";

const enum State {
  NORMAL,
  CODE_BLOCK,
  THINKING,
  DIFF,
  TOOL_CALL,
}

export class SmartRenderParser {
  private state: State = State.NORMAL;
  private lineBuffer = "";
  private rawLineBuffer = "";
  private blockBuffer = "";
  private rawBlockBuffer = "";
  private currentLine: number;
  private nextSegmentId = 0;
  private blockStartLine = 0;
  private blockMeta: SegmentMeta | undefined;
  private segments: Segment[] = [];
  private segmentMap = new Map<number, Segment>();
  private blockSegmentId = -1;
  private diffLineCount = 0;

  constructor(private initialLineOffset: number = 0) {
    this.currentLine = initialLineOffset;
  }

  feed(stripped: string, raw: string): Segment[] {
    const result: Segment[] = [];

    this.lineBuffer += stripped;
    this.rawLineBuffer += raw;

    // Process complete lines (split on \n but keep the \n)
    while (true) {
      const idx = this.lineBuffer.indexOf("\n");
      if (idx === -1) break;

      const line = this.lineBuffer.slice(0, idx + 1);
      const rawLine = this.rawLineBuffer.slice(0, idx + 1);
      this.lineBuffer = this.lineBuffer.slice(idx + 1);
      this.rawLineBuffer = this.rawLineBuffer.slice(idx + 1);

      const segs = this.processLine(line, rawLine);
      result.push(...segs);
    }

    return result;
  }

  reset(): void {
    this.state = State.NORMAL;
    this.lineBuffer = "";
    this.rawLineBuffer = "";
    this.blockBuffer = "";
    this.rawBlockBuffer = "";
    this.currentLine = this.initialLineOffset;
    this.nextSegmentId = 0;
    this.blockStartLine = 0;
    this.blockMeta = undefined;
    this.segments = [];
    this.segmentMap.clear();
    this.blockSegmentId = -1;
    this.diffLineCount = 0;
  }

  getPendingSegments(): Segment[] {
    return this.segments.filter((s) => s.status === "pending");
  }

  private processLine(line: string, rawLine: string): Segment[] {
    const result: Segment[] = [];
    const trimmed = line.replace(/\n$/, "");

    switch (this.state) {
      case State.NORMAL:
        result.push(...this.processNormalLine(line, rawLine, trimmed));
        break;
      case State.CODE_BLOCK:
        result.push(...this.processCodeBlockLine(line, rawLine, trimmed));
        break;
      case State.THINKING:
        result.push(...this.processThinkingLine(line, rawLine, trimmed));
        break;
      case State.DIFF:
        result.push(...this.processDiffLine(line, rawLine, trimmed));
        break;
      case State.TOOL_CALL:
        result.push(...this.processToolCallLine(line, rawLine, trimmed));
        break;
    }

    this.currentLine++;
    return result;
  }

  private processNormalLine(
    line: string,
    rawLine: string,
    trimmed: string,
  ): Segment[] {
    // Code fence
    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim() || undefined;
      this.state = State.CODE_BLOCK;
      this.blockBuffer = "";
      this.rawBlockBuffer = "";
      this.blockStartLine = this.currentLine;
      this.blockMeta = language ? { language } : undefined;
      this.diffLineCount = 0;

      const seg = this.createSegment(
        "code_block",
        "",
        "",
        this.currentLine,
        0,
        "pending",
        this.blockMeta,
      );
      this.blockSegmentId = seg.id;
      return [seg];
    }

    // Thinking block
    if (trimmed.includes("<thinking>")) {
      this.state = State.THINKING;
      this.blockBuffer = "";
      this.rawBlockBuffer = "";
      this.blockStartLine = this.currentLine;
      this.blockMeta = undefined;

      const seg = this.createSegment(
        "thinking",
        "",
        "",
        this.currentLine,
        0,
        "pending",
      );
      this.blockSegmentId = seg.id;
      return [seg];
    }

    // Diff detection
    if (
      trimmed.startsWith("--- a/") ||
      trimmed.startsWith("+++ b/") ||
      trimmed.startsWith("@@ ")
    ) {
      this.state = State.DIFF;
      this.blockBuffer = line;
      this.rawBlockBuffer = rawLine;
      this.blockStartLine = this.currentLine;
      this.blockMeta = undefined;
      this.diffLineCount = 1;

      const seg = this.createSegment(
        "diff",
        line,
        rawLine,
        this.currentLine,
        1,
        "pending",
      );
      this.blockSegmentId = seg.id;
      return [seg];
    }

    // Tool call markers
    if (
      trimmed.startsWith("⏺ ") ||
      trimmed.startsWith("● ") ||
      trimmed.startsWith("◆ ")
    ) {
      const toolName = trimmed.slice(2).trim() || undefined;
      this.state = State.TOOL_CALL;
      this.blockBuffer = line;
      this.rawBlockBuffer = rawLine;
      this.blockStartLine = this.currentLine;
      this.blockMeta = toolName ? { toolName } : undefined;

      const seg = this.createSegment(
        "tool_call",
        line,
        rawLine,
        this.currentLine,
        1,
        "pending",
        this.blockMeta,
      );
      this.blockSegmentId = seg.id;
      return [seg];
    }

    // Markdown detection
    if (this.isMarkdownLine(trimmed)) {
      return [
        this.createSegment(
          "markdown",
          line,
          rawLine,
          this.currentLine,
          1,
          "complete",
        ),
      ];
    }

    // Plain text
    return [
      this.createSegment(
        "raw",
        line,
        rawLine,
        this.currentLine,
        1,
        "complete",
      ),
    ];
  }

  private processCodeBlockLine(
    line: string,
    rawLine: string,
    trimmed: string,
  ): Segment[] {
    if (trimmed.startsWith("```")) {
      // End of code block
      this.state = State.NORMAL;
      const seg = this.findSegment(this.blockSegmentId);
      if (seg) {
        seg.content = this.blockBuffer;
        seg.rawContent = this.rawBlockBuffer;
        seg.lineCount = this.currentLine - this.blockStartLine + 1;
        seg.status = "complete";
        return [seg];
      }
      return [];
    }

    this.blockBuffer += line;
    this.rawBlockBuffer += rawLine;

    // Update the pending segment
    const seg = this.findSegment(this.blockSegmentId);
    if (seg) {
      seg.content = this.blockBuffer;
      seg.rawContent = this.rawBlockBuffer;
      seg.lineCount = this.currentLine - this.blockStartLine + 1;
    }
    return [];
  }

  private processThinkingLine(
    line: string,
    rawLine: string,
    trimmed: string,
  ): Segment[] {
    if (trimmed.includes("</thinking>")) {
      this.state = State.NORMAL;
      const seg = this.findSegment(this.blockSegmentId);
      if (seg) {
        seg.content = this.blockBuffer;
        seg.rawContent = this.rawBlockBuffer;
        seg.lineCount = this.currentLine - this.blockStartLine + 1;
        seg.status = "complete";
        return [seg];
      }
      return [];
    }

    this.blockBuffer += line;
    this.rawBlockBuffer += rawLine;

    const seg = this.findSegment(this.blockSegmentId);
    if (seg) {
      seg.content = this.blockBuffer;
      seg.rawContent = this.rawBlockBuffer;
      seg.lineCount = this.currentLine - this.blockStartLine + 1;
    }
    return [];
  }

  private processDiffLine(
    line: string,
    rawLine: string,
    trimmed: string,
  ): Segment[] {
    // Exit on blank line if we have enough diff lines
    if (trimmed === "" && this.diffLineCount >= 2) {
      this.state = State.NORMAL;
      const seg = this.findSegment(this.blockSegmentId);
      if (seg) {
        seg.content = this.blockBuffer;
        seg.rawContent = this.rawBlockBuffer;
        seg.lineCount = this.currentLine - this.blockStartLine;
        seg.status = "complete";
        return [seg];
      }
      return [];
    }

    this.blockBuffer += line;
    this.rawBlockBuffer += rawLine;
    this.diffLineCount++;

    const seg = this.findSegment(this.blockSegmentId);
    if (seg) {
      seg.content = this.blockBuffer;
      seg.rawContent = this.rawBlockBuffer;
      seg.lineCount = this.currentLine - this.blockStartLine + 1;
    }
    return [];
  }

  private processToolCallLine(
    line: string,
    rawLine: string,
    trimmed: string,
  ): Segment[] {
    // Exit conditions: blank line, another tool marker, code fence, heading
    if (
      trimmed === "" ||
      trimmed.startsWith("```") ||
      (trimmed.startsWith("#") && trimmed.length > 1 && trimmed[1] === " ") ||
      trimmed.startsWith("⏺ ") ||
      trimmed.startsWith("● ") ||
      trimmed.startsWith("◆ ")
    ) {
      this.state = State.NORMAL;
      const seg = this.findSegment(this.blockSegmentId);
      if (seg) {
        seg.status = "complete";
        seg.lineCount = this.currentLine - this.blockStartLine;
      }

      // Re-process this line in NORMAL state if it's not blank
      if (trimmed !== "") {
        const reprocessed = this.processNormalLine(line, rawLine, trimmed);
        return seg ? [seg, ...reprocessed] : reprocessed;
      }
      return seg ? [seg] : [];
    }

    this.blockBuffer += line;
    this.rawBlockBuffer += rawLine;

    const seg = this.findSegment(this.blockSegmentId);
    if (seg) {
      seg.content = this.blockBuffer;
      seg.rawContent = this.rawBlockBuffer;
      seg.lineCount = this.currentLine - this.blockStartLine + 1;
    }
    return [];
  }

  private isMarkdownLine(trimmed: string): boolean {
    if (trimmed.startsWith("# ")) return true;
    if (/^#{2,6}\s/.test(trimmed)) return true;
    if (trimmed.startsWith("- ")) return true;
    if (trimmed.startsWith("* ")) return true;
    if (trimmed.startsWith("> ")) return true;
    if (trimmed.includes("**")) return true;
    return false;
  }

  private createSegment(
    type: SegmentType,
    content: string,
    rawContent: string,
    startLine: number,
    lineCount: number,
    status: "pending" | "complete",
    meta?: SegmentMeta,
  ): Segment {
    const seg: Segment = {
      id: this.nextSegmentId++,
      type,
      content,
      rawContent,
      startLine,
      lineCount,
      status,
      createdAt: Date.now(),
      ...(meta ? { meta } : {}),
    };
    this.segments.push(seg);
    this.segmentMap.set(seg.id, seg);
    return seg;
  }

  private findSegment(id: number): Segment | undefined {
    return this.segmentMap.get(id);
  }
}
