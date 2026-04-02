import { useCallback, useRef } from "react";

interface AgentInputBoxProps {
  running: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}

export function AgentInputBox({ running, onSend, onAbort }: AgentInputBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (running) return;
        const value = textareaRef.current?.value.trim();
        if (value) {
          onSend(value);
          if (textareaRef.current) textareaRef.current.value = "";
        }
      }
    },
    [onSend, running],
  );

  return (
    <div className="shrink-0 border-t border-zinc-700 px-3 py-2 bg-zinc-900">
      <div className="relative">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={running ? "Agent is working..." : "Send a message..."}
          disabled={running}
          onKeyDown={handleKeyDown}
          className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 pl-3 pr-10 py-2 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-500 focus:border-emerald-600 disabled:opacity-50"
        />
        {running ? (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-red-400 transition-colors duration-150 p-1"
            onClick={onAbort}
            aria-label="Stop"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-emerald-400 transition-colors duration-150 p-1"
            onClick={() => {
              const value = textareaRef.current?.value.trim();
              if (value) {
                onSend(value);
                if (textareaRef.current) textareaRef.current.value = "";
              }
            }}
            aria-label="Send"
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
