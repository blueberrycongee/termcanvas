import { useEffect, useRef } from "react";
import type { BubbleMessage } from "./types";
import { usePreferencesStore } from "../../stores/preferencesStore";
import { useSettingsModalStore } from "../../stores/settingsModalStore";

interface MessageListProps {
  messages: BubbleMessage[];
}

function MessageBubble({ message }: { message: BubbleMessage }) {
  const isUser = message.role === "user";
  const isToolRelated = message.type === "tool_call" || message.type === "tool_result";
  const isStatus = message.type === "status";

  if (isStatus) {
    return (
      <div className="flex justify-center py-1.5">
        <span className="tc-caption" style={{ color: "var(--text-faint)" }}>
          {message.content}
        </span>
      </div>
    );
  }

  if (isToolRelated) {
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className="tc-mono max-w-[88%] rounded-md px-2.5 py-1.5"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontSize: "11.5px",
            lineHeight: "var(--leading-relaxed)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="tc-body-sm max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap"
        style={
          isUser
            ? {
                background: "var(--accent)",
                color: "white",
              }
            : {
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }
        }
      >
        {message.content}
      </div>
    </div>
  );
}

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentApiKey = usePreferencesStore((s) => s.agentConfig.apiKey);
  const apiKeyReady = usePreferencesStore((s) => s.apiKeyReady);
  const openSettings = useSettingsModalStore((s) => s.openSettings);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full px-6">
          {!apiKeyReady ? null : agentApiKey ? (
            <p className="tc-label text-center" style={{ color: "var(--text-faint)" }}>
              Send a message to start an agent task
            </p>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p className="tc-label text-center" style={{ color: "var(--text-faint)" }}>
                Configure an API key to get started
              </p>
              <button
                className="tc-ui hover:underline"
                style={{ color: "var(--accent)" }}
                onClick={() => openSettings("general")}
              >
                Open Settings
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3 pb-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}
