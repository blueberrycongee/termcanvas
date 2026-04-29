import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";

export type MenuItem =
  | {
      type?: "item";
      label: string;
      active?: boolean;
      danger?: boolean;
      onClick: () => void;
    }
  | { type: "separator" };

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x, y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nx = x;
    let ny = y;
    if (nx + rect.width + VIEWPORT_MARGIN > vw) {
      nx = Math.max(VIEWPORT_MARGIN, vw - rect.width - VIEWPORT_MARGIN);
    }
    if (ny + rect.height + VIEWPORT_MARGIN > vh) {
      ny = Math.max(VIEWPORT_MARGIN, vh - rect.height - VIEWPORT_MARGIN);
    }
    setPos({ x: nx, y: ny });
  }, [x, y, items]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture so the listener fires before React Flow's pane handlers
    // call stopPropagation, which would otherwise leave the menu stuck open.
    window.addEventListener("mousedown", handler, true);
    return () => window.removeEventListener("mousedown", handler, true);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus first menu item on mount
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const first = node.querySelector<HTMLElement>("[role='menuitem']");
    if (first) {
      requestAnimationFrame(() => first.focus());
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const node = ref.current;
    if (!node) return;
    const menuitems = Array.from(
      node.querySelectorAll<HTMLElement>("[role='menuitem']"),
    );
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? menuitems.indexOf(active) : -1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = menuitems[(idx + 1) % menuitems.length];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = menuitems[(idx - 1 + menuitems.length) % menuitems.length];
      prev?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      menuitems[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      menuitems[menuitems.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t.context_menu_aria_label}
      className="fixed z-[100] py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg min-w-[140px]"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, i) =>
        item.type === "separator" ? (
          <div
            key={`sep-${i}`}
            role="separator"
            className="my-1 border-t border-[var(--border)]"
          />
        ) : (
          <button
            key={`${item.label}-${i}`}
            role="menuitem"
            tabIndex={-1}
            className={`w-full px-3 py-1.5 text-left text-[12px] transition-colors duration-quick ${
              item.active
                ? "text-[var(--accent)] bg-[var(--accent)]/10"
                : item.danger
                  ? "text-[var(--red)] hover:text-[var(--red-soft)] hover:bg-[var(--border)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"
            }`}
            style={{ fontFamily: '"Geist Mono", monospace' }}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
