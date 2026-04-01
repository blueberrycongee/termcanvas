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
      <div className="flex justify-center py-1">
        <span className="text-[11px] text-[var(--text-faint)]">{message.content}</span>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
          isUser
            ? "bg-[var(--accent)] text-white"
            : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-primary)]"
        }`}
        style={isToolRelated ? { fontFamily: '"Geist Mono", monospace', fontSize: 12 } : undefined}
      >
        {message.content}
      </div>
    </div>
  );
}

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentApiKey = usePreferencesStore((s) => s.agentApiKey);
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
          {agentApiKey ? (
            <p className="text-[11px] text-[var(--text-faint)] text-center leading-relaxed">
              Send a message to start an agent task
            </p>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p className="text-[11px] text-[var(--text-faint)] text-center leading-relaxed">
                Configure an API key to get started
              </p>
              <button
                className="text-[11px] text-[var(--accent)] hover:underline"
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
