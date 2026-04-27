import { useEffect, useRef } from "react";
import type { BubbleMessage } from "./types";
import { usePreferencesStore } from "../../stores/preferencesStore";
import { useSettingsModalStore } from "../../stores/settingsModalStore";

interface MessageListProps {
  messages: BubbleMessage[];
}

function MessageRow({ message }: { message: BubbleMessage }) {
  const isUser = message.role === "user";
  const isToolRelated = message.type === "tool_call" || message.type === "tool_result";
  const isStatus = message.type === "status";

  if (isStatus) {
    return (
      <div className="flex justify-center py-1">
        <span className="tc-caption" style={{ color: "var(--text-faint)" }}>
          {message.content}
        </span>
      </div>
    );
  }

  /* Tool messages: deeper indent, muted mono — same vocabulary as
     the in-tile ToolCard so the two surfaces feel native. No
     bordered container. */
  if (isToolRelated) {
    return (
      <div className="pl-6 pr-1 py-0.5">
        <span
          className="tc-mono whitespace-pre-wrap break-words"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {message.content}
        </span>
      </div>
    );
  }

  /* User: right-aligned neutral bubble using --bubble-bg, never the
     accent fill — matches the SessionReplayView convention. */
  if (isUser) {
    return (
      <div className="flex justify-end tc-enter-fade-up-quick">
        <div
          className="tc-body-sm rounded-xl px-3 py-1.5 whitespace-pre-wrap max-w-[85%]"
          style={{
            background: "var(--bubble-bg)",
            color: "var(--text-primary)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  /* Assistant: indented prose, no chrome. The indent is the speaker
     mark; no eyebrow, no avatar, no role badge. */
  return (
    <div className="pl-3 pr-1 tc-enter-fade-quick">
      <div
        className="tc-body-sm whitespace-pre-wrap break-words"
        style={{
          color: "var(--text-primary)",
          lineHeight: "var(--leading-relaxed)",
        }}
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
                onClick={() => openSettings("agent")}
              >
                Open Settings
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 px-3 py-3">
          {messages.map((msg) => (
            <MessageRow key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}
