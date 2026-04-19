import { useCallback, useRef, useState } from "react";

interface AgentInputBoxProps {
  running: boolean;
  isDark: boolean;
  slashCommands?: string[];
  onSend: (text: string) => void;
  onAbort: () => void;
}

export function AgentInputBox({ running, slashCommands, onSend, onAbort }: AgentInputBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focused, setFocused] = useState(false);

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
    <div
      className="shrink-0 px-3 py-2.5"
      style={{
        background: "var(--bg)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div className="relative">
        {suggestions.length > 0 && (
          <div
            className="absolute bottom-full left-0 right-0 mb-1.5 rounded-md overflow-hidden shadow-lg"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((cmd, i) => (
              <button
                key={cmd}
                className="w-full text-left px-3 py-1.5 tc-body-sm transition-colors duration-75"
                style={{
                  background: i === selectedIndex ? "var(--surface-hover)" : "transparent",
                  color: i === selectedIndex ? "var(--text-primary)" : "var(--text-secondary)",
                }}
                onClick={() => applySuggestion(cmd)}
              >
                <span className="tc-mono" style={{ color: "var(--accent)" }}>/{cmd}</span>
              </button>
            ))}
          </div>
        )}
        <div
          className="rounded-md transition-all"
          style={{
            background: "var(--surface)",
            border: `1px solid ${focused ? "var(--accent)" : "var(--border)"}`,
            boxShadow: focused ? "0 0 0 3px var(--accent-soft)" : "none",
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={running ? "Interject a message…" : "Send a message"}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="tc-body w-full resize-none bg-transparent pl-3 pr-20 py-2 outline-none placeholder:opacity-60"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {running && (
            <button
              className="transition-colors duration-150 p-1.5 rounded-md hover:bg-[var(--surface-hover)]"
              style={{ color: "var(--text-muted)" }}
              onClick={onAbort}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Stop"
              title="Stop generation"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          )}
          <button
            className="transition-colors duration-150 p-1.5 rounded-md hover:bg-[var(--accent-soft)]"
            style={{ color: focused ? "var(--accent)" : "var(--text-muted)" }}
            onClick={submit}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Send"
            title="Send (Enter)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2L7 9" />
              <path d="M14 2L9.5 14L7 9L2 6.5L14 2Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
