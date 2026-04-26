import { useCallback, useEffect, useMemo, useRef } from "react";

import { useT } from "../../i18n/useT";
import { useCommandPaletteStore } from "../../stores/commandPaletteStore";
import { fuzzyScore } from "../../utils/fuzzyScore";
import {
  buildCommands,
  SECTION_GLYPH,
  SECTION_LABEL,
  SECTION_ORDER,
  type CommandSection,
  type PaletteCommand,
} from "./commandRegistry";

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;

const SECTION_BOOST: Record<CommandSection, number> = {
  // "Open settings" / "Toggle theme" should win over "Toggle Files" tab
  // when ambiguous; concrete navigation (terminals, projects) sits in
  // the middle; waypoints below them because they're modal-state.
  action: 1.15,
  terminal: 1.1,
  project: 1.0,
  waypoint: 0.9,
};

interface ScoredCommand {
  command: PaletteCommand;
  score: number;
}

function IconCommand({ size = 14 }: { size?: number }) {
  // The keyboard "command" glyph rendered as an outlined square with four
  // small lobes. Stays in stroke (not fill) so it inherits --text-muted
  // and lifts to --text-secondary when the input has focus.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="4.5" width="7" height="7" rx="0.5" />
      <path d="M4.5 4.5h-1.5a1.5 1.5 0 1 1 1.5-1.5z" />
      <path d="M11.5 4.5h1.5a1.5 1.5 0 1 0-1.5-1.5z" />
      <path d="M4.5 11.5h-1.5a1.5 1.5 0 1 0 1.5 1.5z" />
      <path d="M11.5 11.5h1.5a1.5 1.5 0 1 1-1.5 1.5z" />
    </svg>
  );
}

function detectIsMac(): boolean {
  if (typeof window === "undefined") return false;
  if (window.termcanvas?.app.platform) {
    return window.termcanvas.app.platform === "darwin";
  }
  return /Mac|iPhone|iPad/.test(window.navigator.userAgent);
}

export function CommandPalette() {
  const t = useT();
  const open = useCommandPaletteStore((s) => s.open);
  const query = useCommandPaletteStore((s) => s.query);
  const selectedIndex = useCommandPaletteStore((s) => s.selectedIndex);
  const hasOpenedOnce = useCommandPaletteStore((s) => s.hasOpenedOnce);
  const closePalette = useCommandPaletteStore((s) => s.closePalette);
  const setQuery = useCommandPaletteStore((s) => s.setQuery);
  const setSelectedIndex = useCommandPaletteStore((s) => s.setSelectedIndex);
  const selectNext = useCommandPaletteStore((s) => s.selectNext);
  const selectPrev = useCommandPaletteStore((s) => s.selectPrev);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const prevFocusRef = useRef<Element | null>(null);

  const isMac = useMemo(detectIsMac, []);

  // Build the command list every render while open. Cheap (O(commands)
  // and bounded by static + N visible terminals/projects). Closing the
  // palette short-circuits early so we don't pay for it at rest.
  const commands = useMemo<PaletteCommand[]>(() => {
    if (!open) return [];
    return buildCommands({ t, isMac });
  }, [open, t, isMac]);

  const filtered = useMemo<ScoredCommand[]>(() => {
    if (!open) return [];
    const trimmed = query.trim();

    if (!trimmed) {
      // No query: show all commands in registry order, action-first.
      return commands.map((command) => ({ command, score: 1 }));
    }

    const scored: ScoredCommand[] = [];
    for (const command of commands) {
      const text = command.subtitle
        ? `${command.title} ${command.subtitle}`
        : command.title;
      const raw = fuzzyScore(text, trimmed, command.keywords);
      if (raw <= 0) continue;
      scored.push({
        command,
        score: raw * SECTION_BOOST[command.section],
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }, [commands, query, open]);

  const grouped = useMemo(() => {
    if (query.trim()) {
      // Query mode: a single ranked list, no section headers. Score
      // dominates; categorisation would just push the user's likely
      // pick below a header line.
      return null;
    }
    const bySection = new Map<CommandSection, PaletteCommand[]>();
    for (const { command } of filtered) {
      const arr = bySection.get(command.section) ?? [];
      arr.push(command);
      bySection.set(command.section, arr);
    }
    const groups: Array<{
      section: CommandSection;
      commands: PaletteCommand[];
    }> = [];
    for (const section of SECTION_ORDER) {
      const items = bySection.get(section);
      if (items && items.length > 0) groups.push({ section, commands: items });
    }
    return groups;
  }, [filtered, query]);

  // Flat list for keyboard nav. In grouped mode this matches the order
  // children render in; in ranked mode it's the score-sorted slice.
  const flatList = useMemo<PaletteCommand[]>(() => {
    if (grouped) {
      return grouped.flatMap((g) => g.commands);
    }
    return filtered.map((s) => s.command);
  }, [grouped, filtered]);

  const safeSelectedIndex = Math.min(
    selectedIndex,
    Math.max(0, flatList.length - 1),
  );

  // Restore focus to whatever held it before the palette took over.
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      if (prevFocusRef.current instanceof HTMLElement) {
        prevFocusRef.current.focus();
      }
    }
  }, [open]);

  // Keep the highlighted row visible as ↑/↓ moves selection beyond the
  // viewport. `block: "nearest"` matches SearchModal's behaviour and
  // avoids snap-jumps when the row is already on screen.
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const selected = container.querySelector("[data-selected='true']");
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }, [safeSelectedIndex, flatList.length]);

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      // Close BEFORE the perform thunk runs. Some perform thunks open
      // another modal (Settings, project picker) and the palette must
      // be out of the way for that surface to receive focus cleanly.
      closePalette();
      try {
        command.perform();
      } catch (err) {
        console.error("[CommandPalette] perform threw:", err);
      }
    },
    [closePalette],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (composingRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectNext(flatList.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectPrev(flatList.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const command = flatList[safeSelectedIndex];
        if (command) runCommand(command);
        return;
      }
    },
    [
      closePalette,
      selectNext,
      selectPrev,
      flatList,
      safeSelectedIndex,
      runCommand,
    ],
  );

  if (!open) return null;

  // Stagger only on the first open per session; later opens snap in
  // because the user is now using the palette, not discovering it.
  const enableStagger = !hasOpenedOnce;

  const renderRow = (
    command: PaletteCommand,
    globalIndex: number,
    sectionGlyph: string,
  ) => {
    const isSelected = globalIndex === safeSelectedIndex;
    return (
      <button
        key={command.id}
        data-selected={isSelected}
        type="button"
        className={
          "tc-cmd-row flex w-full items-center gap-3 px-4 py-2 text-left" +
          (enableStagger ? " tc-enter-fade-up-quick" : "")
        }
        style={{
          backgroundColor: isSelected
            ? "color-mix(in srgb, var(--accent) 12%, transparent)"
            : undefined,
        }}
        onMouseEnter={() => setSelectedIndex(globalIndex)}
        onClick={() => runCommand(command)}
      >
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold"
          style={{
            ...MONO_STYLE,
            color: isSelected ? "var(--accent)" : "var(--text-muted)",
            backgroundColor: isSelected
              ? "color-mix(in srgb, var(--accent) 16%, transparent)"
              : "color-mix(in srgb, var(--text-muted) 10%, transparent)",
            transition:
              "color var(--duration-quick) var(--ease-out-soft), background-color var(--duration-quick) var(--ease-out-soft)",
          }}
        >
          {sectionGlyph}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[13px]"
            style={{
              color: "var(--text-primary)",
              fontWeight: isSelected ? 500 : 400,
            }}
          >
            {command.title}
          </div>
          {command.subtitle && (
            <div
              className="truncate text-[11px]"
              style={{ color: "var(--text-faint)" }}
            >
              {command.subtitle}
            </div>
          )}
        </div>
        {command.hint && (
          <span
            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
            style={{
              ...MONO_STYLE,
              borderColor: "var(--border)",
              color: isSelected ? "var(--text-secondary)" : "var(--text-faint)",
            }}
          >
            {command.hint}
          </span>
        )}
        {isSelected && !command.hint && (
          <span
            className="shrink-0 text-[10px]"
            style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
          >
            Enter
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ backgroundColor: "var(--scrim)" }}
      onClick={(e) => {
        if (e.target === backdropRef.current) closePalette();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="tc-enter-fade-up w-full max-w-xl mx-4 overflow-hidden rounded-lg border shadow-2xl"
        style={{
          backgroundColor: "var(--bg)",
          borderColor: "var(--border)",
        }}
      >
        {/* Input */}
        <div
          className="flex items-center gap-2.5 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            <IconCommand />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            placeholder="Run a command, jump to a terminal…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
            style={MONO_STYLE}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd
            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
            style={{
              ...MONO_STYLE,
              borderColor: "var(--border)",
              color: "var(--text-faint)",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={resultsRef}
          className={
            "max-h-[55vh] overflow-auto" +
            (enableStagger ? " tc-stagger" : "")
          }
        >
          {flatList.length === 0 ? (
            <div
              className="px-4 py-10 text-center text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              {query.trim()
                ? "No matching commands"
                : "Type a command or location"}
            </div>
          ) : grouped ? (
            (() => {
              let runningIndex = 0;
              return grouped.map(({ section, commands: items }) => {
                const sectionStartIndex = runningIndex;
                runningIndex += items.length;
                return (
                  <div key={section}>
                    <div
                      className="sticky top-0 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        ...MONO_STYLE,
                        color: "var(--text-muted)",
                        backgroundColor: "var(--bg)",
                        letterSpacing: "var(--tracking-eyebrow)",
                      }}
                    >
                      {SECTION_LABEL[section]}
                    </div>
                    {items.map((command, i) =>
                      renderRow(
                        command,
                        sectionStartIndex + i,
                        SECTION_GLYPH[section],
                      ),
                    )}
                  </div>
                );
              });
            })()
          ) : (
            // Query mode: ranked flat list, no section headers.
            flatList.map((command, i) =>
              renderRow(command, i, SECTION_GLYPH[command.section]),
            )
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-3 py-2 text-[10px]"
          style={{
            ...MONO_STYLE,
            borderColor: "var(--border)",
            color: "var(--text-faint)",
          }}
        >
          <div className="flex items-center gap-3">
            <span>
              <kbd
                className="rounded border px-1 py-0.5"
                style={{ borderColor: "var(--border)" }}
              >
                ↵
              </kbd>
              <span className="ml-1">run</span>
            </span>
            <span>
              <kbd
                className="rounded border px-1 py-0.5"
                style={{ borderColor: "var(--border)" }}
              >
                ↑↓
              </kbd>
              <span className="ml-1">navigate</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">
              {flatList.length}{" "}
              {flatList.length === 1 ? "match" : "matches"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
