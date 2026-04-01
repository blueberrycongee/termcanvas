export interface BubbleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  type?: "text" | "tool_call" | "tool_result" | "status";
}

export interface BubbleSession {
  id: string;
  title: string;
  messages: BubbleMessage[];
  createdAt: number;
}

export interface AgentBubbleProps {
  onSendMessage: (text: string) => void;
  messages: BubbleMessage[];
  activeTaskCount: number;
}
