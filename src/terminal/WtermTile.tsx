import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Terminal as WtermTerminal,
  type TerminalCore,
  type TerminalHandle,
} from "@wterm/react";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/react/css";
import type { TerminalData } from "../types";
import { useResolvedTerminalRuntimeState } from "../stores/terminalRuntimeStateStore";
import { getTerminalRuntimePreviewAnsi } from "./terminalRuntimeStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useThemeStore } from "../stores/themeStore";

let coreLoadPromise: Promise<TerminalCore> | null = null;

function getGhosttyCore(): Promise<TerminalCore> {
  if (!coreLoadPromise) {
    coreLoadPromise = GhosttyCore.load().catch((err) => {
      coreLoadPromise = null;
      throw err;
    });
  }
  return coreLoadPromise;
}

interface Props {
  terminal: TerminalData;
}

export function WtermTile({ terminal }: Props) {
  const handleRef = useRef<TerminalHandle>(null);
  const liveRuntimeState = useResolvedTerminalRuntimeState(terminal);
  const ptyId = liveRuntimeState.ptyId ?? terminal.ptyId ?? null;
  const fontSize = usePreferencesStore((s) => s.terminalFontSize);
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
      theme={theme === "light" ? "light" : undefined}
      onData={handleData}
      onResize={handleResize}
      className="tc-wterm-host"
      style={{
        width: "100%",
        height: "100%",
        padding: 8,
        borderRadius: 0,
        boxShadow: "none",
        fontSize: `${fontSize}px`,
      }}
    />
  );
}
