export type SegmentType = "raw" | "code_block" | "markdown" | "diff" | "thinking" | "tool_call";

export interface SegmentMeta {
  language?: string;
  toolName?: string;
}

export interface Segment {
  id: number;
  type: SegmentType;
  content: string;
  rawContent: string;
  startLine: number;
  lineCount: number;
  status: "pending" | "complete";
  createdAt: number;
  meta?: SegmentMeta;
}

export interface PipelineState {
  segments: Segment[];
  currentLine: number;
}
