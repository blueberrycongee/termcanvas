import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";

interface Props {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  terminal: TerminalData;
}

const TYPE_CONFIG = {
  shell: {
    icon: "▸",
    pill: "bg-zinc-500/15 text-zinc-400",
    label: "Shell",
    border: "border-white/[0.06]",
  },
  claude: {
    icon: "◆",
    pill: "bg-orange-500/15 text-orange-400",
    label: "Claude",
    border: "border-orange-500/10",
  },
  codex: {
    icon: "◈",
    pill: "bg-violet-500/15 text-violet-400",
    label: "Codex",
    border: "border-violet-500/10",
  },
};

export function TerminalTile({
  projectId,
  worktreeId,
  worktreePath,
  terminal,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const {
    removeTerminal,
    toggleTerminalMinimize,
    updateTerminalPtyId,
    setFocusedTerminal,
  } = useProjectStore();

  const { notify } = useNotificationStore();
  const config = TYPE_CONFIG[terminal.type];

  useEffect(() => {
    if (!containerRef.current || terminal.minimized) return;

    if (!window.termcanvas) {
      notify("error", "Terminal API not available. Not running in Electron.");
      return;
    }

    const xterm = new Terminal({
      theme: {
        background: "#08080c",
        foreground: "#d4d4d8",
        cursor: "#a1a1aa",
        cursorAccent: "#08080c",
        selectionBackground: "rgba(99, 102, 241, 0.3)",
        black: "#18181b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4e7",
        brightBlack: "#3f3f46",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#fafafa",
      },
      fontFamily:
        "'SF Mono', 'JetBrains Mono', 'Cascadia Code', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      scrollback: 5000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);

    requestAnimationFrame(() => fitAddon.fit());

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    let ptyId: number | null = null;

    window.termcanvas.terminal
      .create({ cwd: worktreePath })
      .then((id) => {
        ptyId = id;
        updateTerminalPtyId(projectId, worktreeId, terminal.id, id);

        // Sync xterm input to PTY
        xterm.onData((data) => {
          window.termcanvas.terminal.input(id, data);
        });

        // Sync resize events to PTY
        xterm.onResize(({ cols, rows }) => {
          window.termcanvas.terminal.resize(id, cols, rows);
        });

        // Fit now and sync the actual size to PTY immediately
        fitAddon.fit();
        const { cols, rows } = xterm;
        window.termcanvas.terminal.resize(id, cols, rows);
      })
      .catch((err) => {
        notify("error", `Failed to create PTY for "${terminal.title}": ${err}`);
        xterm.write(
          `\r\n\x1b[31m[Error] Failed to create terminal: ${err}\x1b[0m\r\n`,
        );
      });

    const removeOutput = window.termcanvas.terminal.onOutput(
      (id: number, data: string) => {
        if (id === ptyId) {
          xterm.write(data);
        }
      },
    );

    const removeExit = window.termcanvas.terminal.onExit(
      (id: number, exitCode: number) => {
        if (id === ptyId) {
          xterm.write(
            `\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
          );
          notify(
            exitCode === 0 ? "info" : "warn",
            `Terminal "${terminal.title}" exited with code ${exitCode}.`,
          );
        }
      },
    );

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    cleanupRef.current = () => {
      resizeObserver.disconnect();
      removeOutput();
      removeExit();
      xterm.dispose();
      if (ptyId !== null) {
        window.termcanvas.terminal.destroy(ptyId).catch((err) => {
          console.error(`[TermCanvas] Failed to destroy PTY ${ptyId}:`, err);
        });
      }
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [
    terminal.id,
    terminal.title,
    terminal.minimized,
    projectId,
    worktreeId,
    worktreePath,
    updateTerminalPtyId,
    notify,
  ]);

  const handleClose = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    removeTerminal(projectId, worktreeId, terminal.id);
  }, [projectId, worktreeId, terminal.id, removeTerminal]);

  return (
    <div
      className={`terminal-tile rounded-lg ${config.border} border bg-[#08080c] overflow-hidden flex flex-col`}
      style={{
        width: terminal.size.w,
        height: terminal.minimized ? "auto" : terminal.size.h,
      }}
      onClick={() => setFocusedTerminal(terminal.id)}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-b from-white/[0.04] to-transparent select-none shrink-0 border-b border-white/[0.04]">
        <span className={`type-pill ${config.pill}`}>{config.label}</span>
        <span className="text-[11px] text-zinc-500 truncate flex-1 font-mono">
          {terminal.title}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-white/[0.06]"
            onClick={(e) => {
              e.stopPropagation();
              toggleTerminalMinimize(projectId, worktreeId, terminal.id);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              {terminal.minimized ? (
                <rect
                  x="2"
                  y="2"
                  width="6"
                  height="6"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  rx="0.5"
                />
              ) : (
                <path
                  d="M2 5H8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
          <button
            className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded hover:bg-white/[0.06]"
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal content */}
      {!terminal.minimized && (
        <div ref={containerRef} className="flex-1 min-h-0 p-1" />
      )}
    </div>
  );
}
