import { useCallback, useEffect, useRef, useState } from "react";

interface MessageInputProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  autoFocus: boolean;
}

export function MessageInput({ onSend, onAbort, streaming, autoFocus }: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [autoFocus]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (streaming) return;
        const value = textareaRef.current?.value.trim();
        if (value) {
          onSend(value);
          if (textareaRef.current) textareaRef.current.value = "";
        }
      }
    },
    [onSend, streaming],
  );

  const handleSendClick = useCallback(() => {
    if (streaming) return;
    const value = textareaRef.current?.value.trim();
    if (value) {
      onSend(value);
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.focus();
      }
    }
  }, [onSend, streaming]);

  return (
    <div
      className="shrink-0 px-3 py-2.5"
      style={{
        background: "var(--bg)",
        borderTop: "1px solid var(--border)",
        borderRadius: "0 0 var(--radius) var(--radius)",
      }}
    >
      <div className="relative">
        <div
          className="rounded-md"
          style={{
            background: "var(--surface)",
            border: `1px solid ${focused ? "var(--accent)" : "var(--border)"}`,
            boxShadow: focused ? "0 0 0 3px var(--accent-soft)" : "none",
            transition:
              "border-color var(--duration-quick) var(--ease-out-soft), box-shadow var(--duration-quick) var(--ease-out-soft)",
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={streaming ? "Generating…" : "Send a message"}
            disabled={streaming}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="tc-body-sm w-full resize-none bg-transparent pl-3 pr-10 py-2 outline-none placeholder:opacity-60 disabled:opacity-60"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        {streaming ? (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md"
            style={{
              color: "var(--text-muted)",
              transition:
                "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "var(--surface-hover)";
              el.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "transparent";
              el.style.color = "var(--text-muted)";
            }}
            onClick={onAbort}
            aria-label="Stop generating"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md"
            style={{
              color: focused ? "var(--accent)" : "var(--text-muted)",
              transition:
                "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--accent-soft)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
            onClick={handleSendClick}
            aria-label="Send message"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2L7 9" />
              <path d="M14 2L9.5 14L7 9L2 6.5L14 2Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
