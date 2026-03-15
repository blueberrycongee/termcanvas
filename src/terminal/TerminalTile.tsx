import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { TerminalData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useDrag } from "../hooks/useDrag";
import { useResize } from "../hooks/useResize";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";

interface Props {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  terminal: TerminalData;
}

const TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  shell: { color: "#888", label: "Shell" },
  claude: { color: "#f5a623", label: "Claude" },
  codex: { color: "#7928ca", label: "Codex" },
  kimi: { color: "#0070f3", label: "Kimi" },
  gemini: { color: "#4285f4", label: "Gemini" },
  opencode: { color: "#50e3c2", label: "OpenCode" },
};

export function TerminalTile({
  projectId,
  worktreeId,
  worktreePath,
  terminal,
}: Props) {
  const tileRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const {
    removeTerminal,
    toggleTerminalMinimize,
    updateTerminalPtyId,
    updateTerminalSize,
    updateTerminalPosition,
    updateTerminalStatus,
    updateTerminalSessionId,
    setFocusedTerminal,
  } = useProjectStore();

  const { notify } = useNotificationStore();
  const config = TYPE_CONFIG[terminal.type];

  const handleDrag = useDrag(
    terminal.position.x,
    terminal.position.y,
    useCallback(
      (x: number, y: number) =>
        updateTerminalPosition(projectId, worktreeId, terminal.id, x, y),
      [projectId, worktreeId, terminal.id, updateTerminalPosition],
    ),
  );

  const handleResize = useResize(
    terminal.size.w,
    terminal.size.h,
    useCallback(
      (w: number, h: number) =>
        updateTerminalSize(projectId, worktreeId, terminal.id, w, h),
      [projectId, worktreeId, terminal.id, updateTerminalSize],
    ),
    260,
    80,
    tileRef,
  );

  useEffect(() => {
    if (!containerRef.current || terminal.minimized) return;

    if (!window.termcanvas) {
      notify("error", "Terminal API not available. Not running in Electron.");
      return;
    }

    const xterm = new Terminal({
      theme: {
        background: "#0a0a0a",
        foreground: "#ededed",
        cursor: "#ededed",
        cursorAccent: "#0a0a0a",
        selectionBackground: "rgba(0, 112, 243, 0.3)",
        black: "#111111",
        red: "#ee0000",
        green: "#0070f3",
        yellow: "#f5a623",
        blue: "#0070f3",
        magenta: "#7928ca",
        cyan: "#79ffe1",
        white: "#ededed",
        brightBlack: "#444444",
        brightRed: "#ff4444",
        brightGreen: "#50e3c2",
        brightYellow: "#f7b955",
        brightBlue: "#3291ff",
        brightMagenta: "#a855f7",
        brightCyan: "#79ffe1",
        brightWhite: "#fafafa",
      },
      fontFamily: '"Geist Mono", "SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      scrollback: 5000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(serializeAddon);
    xterm.open(containerRef.current);

    // Restore scrollback from previous session
    if (terminal.scrollback) {
      xterm.write(terminal.scrollback);
    }

    requestAnimationFrame(() => fitAddon.fit());

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;
    registerTerminal(terminal.id, xterm, serializeAddon);

    let ptyId: number | null = null;

    // Build PTY options based on terminal type and session state
    const ptyOptions: { cwd: string; shell?: string; args?: string[] } = {
      cwd: worktreePath,
    };

    if (terminal.type === "codex" && terminal.sessionId) {
      ptyOptions.shell = "codex";
      ptyOptions.args = ["resume", terminal.sessionId];
    } else if (terminal.type === "codex") {
      ptyOptions.shell = "codex";
      ptyOptions.args = [];
    } else if (terminal.type === "claude" && terminal.sessionId) {
      ptyOptions.shell = "claude";
      ptyOptions.args = ["--resume", terminal.sessionId];
    } else if (terminal.type === "claude") {
      ptyOptions.shell = "claude";
      ptyOptions.args = [];
    }

    window.termcanvas.terminal
      .create(ptyOptions)
      .then(async (id) => {
        ptyId = id;
        updateTerminalPtyId(projectId, worktreeId, terminal.id, id);
        updateTerminalStatus(projectId, worktreeId, terminal.id, "running");

        // Capture session ID for future resume
        if (!terminal.sessionId && terminal.type !== "shell") {
          setTimeout(async () => {
            let sid: string | null = null;
            if (terminal.type === "codex") {
              sid = await window.termcanvas.session.getCodexLatest();
            } else if (terminal.type === "claude") {
              const pid = await window.termcanvas.terminal.getPid(id);
              if (pid) {
                sid = await window.termcanvas.session.getClaudeByPid(pid);
              }
            }
            if (sid) {
              updateTerminalSessionId(projectId, worktreeId, terminal.id, sid);
            }
          }, 3000);
        }

        xterm.onData((data) => {
          window.termcanvas.terminal.input(id, data);
        });

        xterm.onResize(({ cols, rows }) => {
          window.termcanvas.terminal.resize(id, cols, rows);
        });

        fitAddon.fit();
        const { cols, rows } = xterm;
        window.termcanvas.terminal.resize(id, cols, rows);
      })
      .catch((err) => {
        notify("error", `Failed to create PTY for "${terminal.title}": ${err}`);
        updateTerminalStatus(projectId, worktreeId, terminal.id, "error");
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
          updateTerminalStatus(
            projectId,
            worktreeId,
            terminal.id,
            exitCode === 0 ? "success" : "error",
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
      unregisterTerminal(terminal.id);
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
      ref={tileRef}
      className="absolute terminal-tile rounded-md border border-[#222] bg-[#0a0a0a] overflow-hidden flex flex-col"
      style={{
        left: terminal.position.x,
        top: terminal.position.y,
        width: terminal.size.w,
        height: terminal.minimized ? "auto" : terminal.size.h,
      }}
      onClick={() => setFocusedTerminal(terminal.id)}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 select-none shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={handleDrag}
      >
        <span
          className="text-[11px] font-medium"
          style={{ color: config.color, fontFamily: '"Geist Mono", monospace' }}
        >
          {config.label}
        </span>
        <span
          className="text-[11px] text-[#444] truncate flex-1"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {terminal.title}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            className="text-[#333] hover:text-[#ededed] transition-colors duration-150 p-1 rounded-md hover:bg-[#222]"
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
            className="text-[#333] hover:text-[#ee0000] transition-colors duration-150 p-1 rounded-md hover:bg-[#222]"
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

      {/* Resize handle */}
      {!terminal.minimized && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity"
          onMouseDown={handleResize}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className="text-[#444]"
          >
            <path
              d="M11 11L6 11M11 11L11 6"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
