import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Terminal as WtermTerminal,
  type TerminalCore,
  type TerminalHandle,
} from "@wterm/react";
import { GhosttyCore } from "@wterm/ghostty";
import type { TerminalData } from "../types";
import { useResolvedTerminalRuntimeState } from "../stores/terminalRuntimeStateStore";
import { getTerminalRuntimePreviewAnsi } from "./terminalRuntimeStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useThemeStore, XTERM_THEMES } from "../stores/themeStore";
import { buildFontFamily } from "./fontRegistry";
import type { CSSProperties } from "react";

const TERMINAL_LINE_HEIGHT = 1.4;
const SCROLLBACK_LIMIT = 50_000;

let coreLoadPromise: Promise<TerminalCore> | null = null;

function getGhosttyCore(): Promise<TerminalCore> {
  if (!coreLoadPromise) {
    coreLoadPromise = GhosttyCore.load({
      scrollbackLimit: SCROLLBACK_LIMIT,
    }).catch((err) => {
      coreLoadPromise = null;
      throw err;
    });
  }
  return coreLoadPromise;
}

// xterm's ITheme exposes 16 ANSI colors via separate fields. wterm reads
// them off CSS vars. Bridge the two so the wterm path inherits the same
// palette we ship for xterm — otherwise wterm falls back to its built-in
// VS Code blue/purple defaults and TermCanvas turns into two visually
// disjoint terminals depending on which engine is on.
function buildPaletteVars(themeName: "dark" | "light"): CSSProperties {
  const t = XTERM_THEMES[themeName];
  return {
    "--term-fg": t.foreground,
    "--term-bg": t.background,
    "--term-cursor": t.cursor,
    "--term-color-0": t.black,
    "--term-color-1": t.red,
    "--term-color-2": t.green,
    "--term-color-3": t.yellow,
    "--term-color-4": t.blue,
    "--term-color-5": t.magenta,
    "--term-color-6": t.cyan,
    "--term-color-7": t.white,
    "--term-color-8": t.brightBlack,
    "--term-color-9": t.brightRed,
    "--term-color-10": t.brightGreen,
    "--term-color-11": t.brightYellow,
    "--term-color-12": t.brightBlue,
    "--term-color-13": t.brightMagenta,
    "--term-color-14": t.brightCyan,
    "--term-color-15": t.brightWhite,
  } as CSSProperties;
}

interface Props {
  terminal: TerminalData;
}

export function WtermTile({ terminal }: Props) {
  const handleRef = useRef<TerminalHandle>(null);
  const liveRuntimeState = useResolvedTerminalRuntimeState(terminal);
  const ptyId = liveRuntimeState.ptyId ?? terminal.ptyId ?? null;
  const fontSize = usePreferencesStore((s) => s.terminalFontSize);
  const fontFamilyId = usePreferencesStore((s) => s.terminalFontFamily);
  const theme = useThemeStore((s) => s.theme);

  const [core, setCore] = useState<TerminalCore | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const replayedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    getGhosttyCore()
      .then((c) => {
        if (mounted) setCore(c);
      })
      .catch((err) => {
        if (mounted) {
          setCoreError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!core || ptyId === null) return;

    const handle = handleRef.current;
    if (handle && !replayedRef.current) {
      const preview = getTerminalRuntimePreviewAnsi(terminal.id);
      if (preview) handle.write(preview);
      replayedRef.current = true;
    }

    return window.termcanvas.terminal.onOutput((id, data) => {
      if (id !== ptyId) return;
      handleRef.current?.write(data);
    });
  }, [core, ptyId, terminal.id]);

  useEffect(() => {
    if (terminal.focused) {
      handleRef.current?.focus();
    }
  }, [terminal.focused]);

  const handleData = useCallback(
    (data: string) => {
      if (ptyId === null) return;
      window.termcanvas.terminal.input(ptyId, data);
    },
    [ptyId],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (ptyId === null) return;
      window.termcanvas.terminal.resize(ptyId, cols, rows);
    },
    [ptyId],
  );

  // Wterm reads font-family/size/line-height/row-height off CSS vars.
  // Setting them inline overrides the package's built-in defaults
  // (Menlo/14px/1.2/17px) so cell metrics match what xterm computes from
  // the same preferences. Row-height has to be an integer pixel value or
  // wterm's resize math drifts row-by-row.
  const containerStyle = useMemo<CSSProperties>(() => {
    const family = buildFontFamily(fontFamilyId);
    const rowHeight = Math.round(fontSize * TERMINAL_LINE_HEIGHT);
    return {
      width: "100%",
      height: "100%",
      padding: 0,
      borderRadius: 0,
      boxShadow: "none",
      "--term-font-family": family,
      "--term-font-size": `${fontSize}px`,
      "--term-line-height": `${rowHeight}px`,
      "--term-row-height": `${rowHeight}px`,
      ...buildPaletteVars(theme),
    } as CSSProperties;
  }, [fontFamilyId, fontSize, theme]);

  if (coreError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-3 text-center text-[11px] text-[var(--red)]">
        {`wterm core failed: ${coreError}`}
      </div>
    );
  }

  if (!core) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--text-faint)]">
        Loading wterm…
      </div>
    );
  }

  return (
    <WtermTerminal
      ref={handleRef}
      core={core}
      autoResize
      cursorBlink
      onData={handleData}
      onResize={handleResize}
      className="tc-wterm-host"
      style={containerStyle}
    />
  );
}
