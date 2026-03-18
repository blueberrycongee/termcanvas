import { useEffect, useRef } from "react";
import type { SlashCommand } from "../terminal/slashCommands";

interface Props {
  commands: readonly SlashCommand[];
  selectedIndex: number;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Scroll the selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (commands.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-[240px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[0_-8px_24px_rgba(0,0,0,0.2)] z-10"
    >
      <div className="py-1">
        {commands.map((cmd, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={cmd.command}
              ref={isSelected ? selectedRef : undefined}
              className={`w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors duration-75 ${
                isSelected
                  ? "bg-[var(--accent)]/15 text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--border)]/50 hover:text-[var(--text-primary)]"
              }`}
              style={{ fontFamily: '"Geist Mono", monospace' }}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(cmd.command);
              }}
              onMouseEnter={() => {
                // Let parent handle index via mouse — not needed since
                // we highlight on hover via CSS, but selection on click
                // uses the command directly.
              }}
            >
              <span
                className={`text-[12px] font-medium shrink-0 ${
                  isSelected ? "text-[var(--accent)]" : ""
                }`}
              >
                {cmd.command}
              </span>
              <span className="text-[11px] text-[var(--text-muted)] truncate">
                {cmd.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
