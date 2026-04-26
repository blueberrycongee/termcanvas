import { useCallback } from "react";
import type { CSSProperties } from "react";
import { promptAndAddProjectToScene } from "../canvas/sceneCommands";
import { useT } from "../i18n/useT";
import { formatShortcut, useShortcutStore } from "../stores/shortcutStore";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";

const STAGGER_STYLE: CSSProperties = {
  // Slower than the default 30ms — the cascade is the moment, not a
  // decorative flourish behind a list. Each tier should land deliberately.
  ["--tc-stagger-step" as string]: "60ms",
};

export function CanvasEmptyState() {
  const t = useT();
  const shortcut = useShortcutStore((s) => s.shortcuts.addProject);
  const shortcutLabel = formatShortcut(shortcut, isMac);

  const handleOpen = useCallback(() => {
    void promptAndAddProjectToScene(t);
  }, [t]);

  return (
    <div
      className="absolute inset-0 flex justify-center pointer-events-none select-none"
      style={{ paddingTop: "30vh" }}
    >
      <div
        className="tc-stagger pointer-events-auto"
        style={{ ...STAGGER_STYLE, width: "min(360px, 80vw)" }}
      >
        <div
          className="tc-enter-fade-up tc-eyebrow"
          style={{ color: "var(--text-faint)", marginBottom: 20 }}
        >
          {t.canvas_empty_eyebrow}
        </div>
        <div
          className="tc-enter-fade-up tc-hero"
          style={{ color: "var(--text-secondary)" }}
        >
          {t.canvas_empty_line_lead}
        </div>
        <div
          className="tc-enter-fade-up tc-hero"
          style={{ color: "var(--text-primary)", marginBottom: 32 }}
        >
          {t.canvas_empty_line_call}
        </div>
        <div
          className="tc-enter-fade-up tc-mono flex items-center gap-3"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
          }}
        >
          <span>{t.canvas_empty_drag_hint}</span>
          <span aria-hidden style={{ color: "var(--text-faint)" }}>
            ·
          </span>
          <span>{t.canvas_empty_or}</span>
          <button
            type="button"
            className="tc-kbd"
            onClick={handleOpen}
            aria-label={t.canvas_empty_action}
          >
            {shortcutLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
