import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { TerminalData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";
import { TERMINAL_W, TERMINAL_H } from "../layout";
import { useThemeStore, XTERM_THEMES } from "../stores/themeStore";
import { useT } from "../i18n/useT";

interface Props {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  terminal: TerminalData;
  gridX: number;
  gridY: number;
  onDragStart?: (terminalId: string, e: React.MouseEvent) => void;
  isDragging?: boolean;
  dragOffsetX?: number;
  dragOffsetY?: number;
  onDoubleClick?: () => void;
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
  gridX,
  gridY,
  onDragStart,
  isDragging = false,
  dragOffsetX = 0,
  dragOffsetY = 0,
  onDoubleClick,
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
    updateTerminalStatus,
    updateTerminalSessionId,
    setFocusedTerminal,
  } = useProjectStore();

  const { notify } = useNotificationStore();
  const t = useT();
  const config = TYPE_CONFIG[terminal.type];

  useEffect(() => {
    if (!containerRef.current || terminal.minimized) return;

    if (!window.termcanvas) {
      notify("error", t.terminal_api_unavailable);
      return;
    }

    const currentTheme = useThemeStore.getState().theme;
    const xterm = new Terminal({
      theme: XTERM_THEMES[currentTheme],
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

    // CLI config: how to launch and resume each terminal type
    const CLI_CONFIG: Record<
      string,
      | {
          shell: string;
          resumeArgs: (id: string) => string[];
          newArgs: string[];
        }
      | undefined
    > = {
      claude: {
        shell: "claude",
        resumeArgs: (id) => ["--resume", id],
        newArgs: [],
      },
      codex: {
        shell: "codex",
        resumeArgs: (id) => ["resume", id],
        newArgs: [],
      },
      kimi: {
        shell: "kimi",
        resumeArgs: (id) => ["-S", id],
        newArgs: [],
      },
      gemini: {
        shell: "gemini",
        resumeArgs: (id) => ["--resume", id],
        newArgs: [],
      },
      opencode: {
        shell: "opencode",
        resumeArgs: (id) => ["-s", id],
        newArgs: [],
      },
    };

    const ptyOptions: { cwd: string; shell?: string; args?: string[] } = {
      cwd: worktreePath,
    };

    const cliCfg = CLI_CONFIG[terminal.type];
    if (cliCfg) {
      ptyOptions.shell = cliCfg.shell;
      ptyOptions.args = terminal.sessionId
        ? cliCfg.resumeArgs(terminal.sessionId)
        : cliCfg.newArgs;
    }

    window.termcanvas.terminal
      .create(ptyOptions)
      .then(async (id) => {
        ptyId = id;
        updateTerminalPtyId(projectId, worktreeId, terminal.id, id);
        updateTerminalStatus(projectId, worktreeId, terminal.id, "running");

        // Capture session ID for future resume
        if (!terminal.sessionId && cliCfg) {
          setTimeout(async () => {
            let sid: string | null = null;
            if (terminal.type === "codex") {
              sid = await window.termcanvas.session.getCodexLatest();
            } else if (terminal.type === "claude") {
              const pid = await window.termcanvas.terminal.getPid(id);
              if (pid) {
                sid = await window.termcanvas.session.getClaudeByPid(pid);
              }
            } else if (terminal.type === "kimi") {
              sid = await window.termcanvas.session.getKimiLatest(worktreePath);
            }
            // opencode/gemini: session ID captured when available
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
        notify("error", t.failed_create_pty(terminal.title, err));
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
          xterm.write(t.process_exited(exitCode));
          updateTerminalStatus(
            projectId,
            worktreeId,
            terminal.id,
            exitCode === 0 ? "success" : "error",
          );
          notify(
            exitCode === 0 ? "info" : "warn",
            t.terminal_exited(terminal.title, exitCode),
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

  // Update xterm theme when app theme changes
  useEffect(() => {
    const unsubscribe = useThemeStore.subscribe((state) => {
      if (xtermRef.current) {
        xtermRef.current.options.theme = XTERM_THEMES[state.theme];
      }
    });
    return unsubscribe;
  }, []);

  const handleClose = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    removeTerminal(projectId, worktreeId, terminal.id);
  }, [projectId, worktreeId, terminal.id, removeTerminal]);

  return (
    <div
      ref={tileRef}
      className="absolute terminal-tile rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden flex flex-col"
      style={{
        left: gridX + (isDragging ? dragOffsetX : 0),
        top: gridY + (isDragging ? dragOffsetY : 0),
        width: TERMINAL_W,
        height: terminal.minimized ? "auto" : TERMINAL_H,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.9 : 1,
        transition: isDragging ? "none" : "left 0.2s ease, top 0.2s ease",
        boxShadow: isDragging ? "0 8px 32px rgba(0,0,0,0.3)" : undefined,
        transform: isDragging ? "scale(1.02)" : undefined,
      }}
      onClick={() => setFocusedTerminal(terminal.id)}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 select-none shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onDragStart?.(terminal.id, e)}
        onDoubleClick={onDoubleClick}
      >
        <span
          className="text-[11px] font-medium"
          style={{ color: config.color, fontFamily: '"Geist Mono", monospace' }}
        >
          {config.label}
        </span>
        <span
          className="text-[11px] text-[var(--text-muted)] truncate flex-1"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {terminal.title}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
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
            className="text-[var(--text-faint)] hover:text-[var(--red)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
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
