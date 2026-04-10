import { useState, useEffect } from "react";
import { useT } from "../i18n/useT";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";
import { useCanvasStore, RIGHT_PANEL_WIDTH, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { shouldIgnoreShortcutTarget } from "../hooks/shortcutTarget";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";

export function ShortcutHints() {
  const t = useT();
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.repeat && !shouldIgnoreShortcutTarget(e)) {
        setVisible(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "?") {
        setVisible(false);
      }
    };
    const onBlur = () => setVisible(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const hints = [
    { key: shortcuts.addProject, desc: t.shortcut_add_project },
    { key: shortcuts.cycleFocusLevel, desc: t.shortcut_cycle_focus_level },
    { key: shortcuts.toggleRightPanel, desc: t.shortcut_toggle_right_panel },
    { key: shortcuts.newTerminal, desc: t.shortcut_new_terminal },
    { key: shortcuts.renameTerminalTitle, desc: t.shortcut_rename_terminal_title },
    { key: shortcuts.closeFocused, desc: t.shortcut_close_focused },
    { key: shortcuts.toggleStarFocused, desc: t.shortcut_toggle_star_focused },
    { key: shortcuts.nextTerminal, desc: t.shortcut_next_terminal },
    { key: shortcuts.prevTerminal, desc: t.shortcut_prev_terminal },
    { key: shortcuts.clearFocus, desc: t.shortcut_clear_focus },
    { key: shortcuts.spanDefault, desc: t.shortcut_span_default },
    { key: shortcuts.spanWide, desc: t.shortcut_span_wide },
    { key: shortcuts.spanTall, desc: t.shortcut_span_tall },
    { key: shortcuts.spanLarge, desc: t.shortcut_span_large },
  ];

  const rightOffset = (rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH) + 16;

  return (
    <div
      className="fixed z-50 flex flex-col gap-1.5 pointer-events-none select-none transition-opacity duration-150"
      style={{
        top: 52,
        right: platform === "win32" ? rightOffset + 132 : rightOffset,
        opacity: visible ? 1 : 0,
      }}
    >
      {hints.map((h) => (
        <div
          key={h.key}
          className="flex items-center gap-2.5 text-[15px]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          <span className="text-[var(--text-secondary)]">
            {formatShortcut(h.key, isMac)}
          </span>
          <span className="text-[var(--text-secondary)] opacity-60">
            {h.desc}
          </span>
        </div>
      ))}
    </div>
  );
}
