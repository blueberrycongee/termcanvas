export interface SessionInfo {
  sessionId: string;
  projectDir: string;
  filePath: string;
  isLive: boolean;
  isManaged: boolean;
  status: "idle" | "generating" | "tool_running" | "turn_complete" | "error";
  currentTool?: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  tokenTotal: number;
}

export interface TimelineEvent {
  index: number;
  timestamp: string;
  type: "user_prompt" | "assistant_text" | "thinking" | "tool_use" | "tool_result" | "turn_complete" | "error";
  toolName?: string;
  filePath?: string;
  textPreview: string;
  tokenDelta?: number;
}

export interface ReplayTimeline {
  sessionId: string;
  projectDir: string;
  filePath: string;
  events: TimelineEvent[];
  editIndices: Array<{ index: number; filePath: string }>;
  totalTokens: number;
  startedAt: string;
  endedAt: string;
}
