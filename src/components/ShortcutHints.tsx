import { useT } from "../i18n/useT";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";

export function ShortcutHints() {
  const t = useT();
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  const hints = [
    { key: shortcuts.toggleSidebar, desc: t.shortcut_toggle_sidebar },
    { key: shortcuts.newTerminal, desc: t.shortcut_new_terminal },
    { key: shortcuts.nextTerminal, desc: t.shortcut_next_terminal },
    { key: shortcuts.prevTerminal, desc: t.shortcut_prev_terminal },
    { key: shortcuts.clearFocus, desc: t.shortcut_clear_focus },
    { key: shortcuts.spanDefault, desc: t.shortcut_span_default },
    { key: shortcuts.spanWide, desc: t.shortcut_span_wide },
    { key: shortcuts.spanTall, desc: t.shortcut_span_tall },
    { key: shortcuts.spanLarge, desc: t.shortcut_span_large },
  ];

  return (
    <div
      className="fixed z-50 flex flex-col gap-1.5 pointer-events-none select-none"
      style={{ top: 52, right: platform === "win32" ? 148 : 16 }}
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
