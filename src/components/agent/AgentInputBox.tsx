import { useCallback, useRef, useState } from "react";

interface AgentInputBoxProps {
  running: boolean;
  isDark: boolean;
  slashCommands?: string[];
  onSend: (text: string) => void;
  onAbort: () => void;
}

export function AgentInputBox({ running, isDark, slashCommands, onSend, onAbort }: AgentInputBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const submit = useCallback(() => {
    const value = textareaRef.current?.value.trim();
    if (!value) return;
    onSend(value);
    if (textareaRef.current) textareaRef.current.value = "";
    setSuggestions([]);
  }, [onSend]);

  const applySuggestion = useCallback((cmd: string) => {
    if (textareaRef.current) {
      textareaRef.current.value = `/${cmd} `;
      textareaRef.current.focus();
    }
    setSuggestions([]);
  }, []);

  const handleInput = useCallback(() => {
    const value = textareaRef.current?.value ?? "";
    if (value.startsWith("/") && !value.includes(" ") && slashCommands?.length) {
      const query = value.slice(1).toLowerCase();
      const matched = slashCommands.filter((c) => c.toLowerCase().includes(query)).slice(0, 8);
      setSuggestions(matched);
      setSelectedIndex(0);
    } else {
      setSuggestions([]);
    }
  }, [slashCommands]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.nativeEvent.isComposing)) {
          e.preventDefault();
          applySuggestion(suggestions[selectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          setSuggestions([]);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit, suggestions, selectedIndex, applySuggestion],
  );

  return (
    <div className={`shrink-0 border-t px-3 py-2 ${isDark ? "border-zinc-700 bg-zinc-900" : "border-zinc-200 bg-white"}`}>
      <div className="relative">
        {suggestions.length > 0 && (
          <div
            className={`absolute bottom-full left-0 right-0 mb-1 rounded-md border shadow-lg overflow-hidden ${
              isDark ? "bg-zinc-800 border-zinc-700" : "bg-white border-zinc-300"
            }`}
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((cmd, i) => (
              <button
                key={cmd}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors duration-75 ${
                  i === selectedIndex
                    ? isDark ? "bg-zinc-700 text-zinc-100" : "bg-zinc-100 text-zinc-900"
                    : isDark ? "text-zinc-300 hover:bg-zinc-700" : "text-zinc-700 hover:bg-zinc-50"
                }`}
                onClick={() => applySuggestion(cmd)}
              >
                <span className={isDark ? "text-emerald-400" : "text-emerald-600"}>/{cmd}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={running ? "Interject a message..." : "Send a message..."}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          className={`w-full resize-none rounded-md border pl-3 pr-20 py-2 text-sm outline-none transition-colors duration-150 ${
            isDark
              ? "border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-600"
              : "border-zinc-300 bg-zinc-50 text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500"
          }`}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {running && (
            <button
              className={`transition-colors duration-150 p-1 ${isDark ? "text-zinc-500 hover:text-red-400" : "text-zinc-400 hover:text-red-500"}`}
              onClick={onAbort}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Stop"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          )}
          <button
            className={`transition-colors duration-150 p-1 ${isDark ? "text-zinc-500 hover:text-emerald-400" : "text-zinc-400 hover:text-emerald-500"}`}
            onClick={submit}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2L7 9" />
              <path d="M14 2L9.5 14L7 9L2 6.5L14 2Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
