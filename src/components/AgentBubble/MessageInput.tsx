import { useCallback, useEffect, useRef } from "react";

interface MessageInputProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  autoFocus: boolean;
}

export function MessageInput({ onSend, onAbort, streaming, autoFocus }: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [autoFocus]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
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
    <div className="border-t border-[var(--border)] px-3 py-2 bg-[var(--bg)]" style={{ borderRadius: "0 0 var(--radius) var(--radius)" }}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={streaming ? "Generating..." : "Message..."}
          disabled={streaming}
          onKeyDown={handleKeyDown}
          className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] pl-3 pr-10 py-2 text-[13px] text-[var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-50"
        />
        {streaming ? (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--danger,#e55)] transition-colors duration-150 p-1"
            onClick={onAbort}
            aria-label="Stop generating"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors duration-150 p-1"
            onClick={handleSendClick}
            aria-label="Send message"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2L7 9" />
              <path d="M14 2L9.5 14L7 9L2 6.5L14 2Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
