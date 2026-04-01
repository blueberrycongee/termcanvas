export interface BubbleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  type?: "text" | "tool_call" | "tool_result" | "status";
}

export interface AgentBubbleProps {
  onSendMessage: (text: string) => void;
  messages: BubbleMessage[];
  activeTaskCount: number;
}
