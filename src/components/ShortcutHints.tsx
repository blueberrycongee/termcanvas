import { useT } from "../i18n/useT";

const platform = window.termcanvas?.app.platform ?? "darwin";
const mod = platform === "darwin" ? "\u2318" : "Ctrl";

export function ShortcutHints() {
  const t = useT();

  const hints = [
    { keys: `${mod} B`, desc: t.shortcut_toggle_sidebar },
    { keys: `${mod} T`, desc: t.shortcut_new_terminal },
    { keys: `${mod} ]`, desc: t.shortcut_next_terminal },
    { keys: `${mod} [`, desc: t.shortcut_prev_terminal },
    { keys: "Esc", desc: t.shortcut_clear_focus },
  ];

  return (
    <div
      className="fixed z-50 flex flex-col gap-1.5 pointer-events-none select-none"
      style={{ top: 52, right: platform === "win32" ? 148 : 16 }}
    >
      {hints.map((h) => (
        <div
          key={h.keys}
          className="flex items-center gap-2.5 text-[15px]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          <span className="text-[var(--text-secondary)]">{h.keys}</span>
          <span className="text-[var(--text-secondary)] opacity-60">
            {h.desc}
          </span>
        </div>
      ))}
    </div>
  );
}
