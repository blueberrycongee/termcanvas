import { useEffect, useRef } from "react";
import type { TerminalType } from "../types";

interface MenuItem {
  type: TerminalType;
  label: string;
}

const ITEMS: MenuItem[] = [
  { type: "shell", label: "Shell" },
  { type: "claude", label: "Claude" },
  { type: "codex", label: "Codex" },
  { type: "gemini", label: "Gemini" },
  { type: "lazygit", label: "Lazygit" },
];

export interface CanvasContextMenuProps {
  clientX: number;
  clientY: number;
  onPick: (type: TerminalType) => void;
  onClose: () => void;
}

export function CanvasContextMenu({
  clientX,
  clientY,
  onPick,
  onClose,
}: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleAway(event: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleAway);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleAway);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-md border border-[var(--border)] bg-[var(--panel-bg)] shadow-xl py-1"
      style={{ left: clientX, top: clientY }}
    >
      <div className="px-3 py-1 text-xs uppercase tracking-wider text-[var(--text-muted)]">
        New Terminal
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.type}
          type="button"
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--button-bg-hover)] text-[var(--text)]"
          onClick={() => {
            onPick(item.type);
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
