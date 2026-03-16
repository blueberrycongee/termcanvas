import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { createPortal } from "react-dom";
import type { TerminalData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useSelectionStore } from "../stores/selectionStore";
import { ContextMenu } from "../components/ContextMenu";
import { useNotificationStore } from "../stores/notificationStore";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";
import { useThemeStore, XTERM_THEMES } from "../stores/themeStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useT } from "../i18n/useT";

interface Props {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  terminal: TerminalData;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  onDragStart?: (terminalId: string, e: React.MouseEvent) => void;
  isDragging?: boolean;
  dragOffsetX?: number;
  dragOffsetY?: number;
  onDoubleClick?: () => void;
  onSpanChange?: (span: { cols: number; rows: number }) => void;
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
  width,
  height,
  onDragStart,
  isDragging = false,
  dragOffsetX = 0,
  dragOffsetY = 0,
  onDoubleClick,
  onSpanChange,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionCancelRef = useRef<(() => void) | null>(null);

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

  const isSelected = useSelectionStore((s) =>
    s.selectedItems.some(
      (item) =>
        item.type === "terminal" &&
        item.terminalId === terminal.id,
    ),
  );

  useEffect(() => {
    if (!containerRef.current) return;

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

    // Let Cmd key combos propagate to the app shortcut handler
    // (Ctrl must still reach xterm for terminal signals like Ctrl+C)
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.metaKey) return false;
      return true;
    });

    // Re-apply theme after open() to ensure canvas paints correctly
    xterm.options.theme = XTERM_THEMES[useThemeStore.getState().theme];

    // Restore scrollback from previous session
    if (terminal.scrollback) {
      xterm.write(terminal.scrollback);
    }

    requestAnimationFrame(() => {
      fitAddon.fit();
      xterm.refresh(0, xterm.rows - 1);
    });

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

        // Capture session ID for future resume.
        // AI CLIs (claude, codex, etc.) may take a while to initialize and
        // write their session file, so we poll instead of a single attempt.
        if (!terminal.sessionId && cliCfg) {
          let cancelled = false;
          sessionCancelRef.current = () => { cancelled = true; };

          (async () => {
            const MAX_ATTEMPTS = 15;
            const INTERVAL = 2000;

            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
              await new Promise((r) => setTimeout(r, INTERVAL));
              if (cancelled) return;

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

              if (sid) {
                updateTerminalSessionId(projectId, worktreeId, terminal.id, sid);
                return;
              }
            }
          })();
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

    let currentStatus: string = "running";
    let waitingTimer: ReturnType<typeof setTimeout> | null = null;
    const WAITING_THRESHOLD = 15_000;

    // Throttled worktree activity event for DiffCard refresh
    let activityThrottled = false;
    let activityPending = false;
    const ACTIVITY_THROTTLE = 3000;
    const dispatchActivity = () => {
      window.dispatchEvent(
        new CustomEvent("termcanvas:worktree-activity", {
          detail: worktreePath,
        }),
      );
    };

    const removeOutput = window.termcanvas.terminal.onOutput(
      (id: number, data: string) => {
        if (id === ptyId) {
          xterm.write(data);

          // Throttled activity notification (at most once per 3s)
          if (!activityThrottled) {
            activityThrottled = true;
            dispatchActivity();
            setTimeout(() => {
              activityThrottled = false;
              if (activityPending) {
                activityPending = false;
                dispatchActivity();
              }
            }, ACTIVITY_THROTTLE);
          } else {
            activityPending = true;
          }

          // Track output activity for status detection
          if (currentStatus !== "active") {
            currentStatus = "active";
            updateTerminalStatus(projectId, worktreeId, terminal.id, "active");
          }
          if (waitingTimer) clearTimeout(waitingTimer);
          waitingTimer = setTimeout(() => {
            if (currentStatus === "active") {
              currentStatus = "waiting";
              updateTerminalStatus(
                projectId,
                worktreeId,
                terminal.id,
                "waiting",
              );
              // Final activity event when output stops
              dispatchActivity();
            }
          }, WAITING_THRESHOLD);
        }
      },
    );

    const removeExit = window.termcanvas.terminal.onExit(
      (id: number, exitCode: number) => {
        if (id === ptyId) {
          if (waitingTimer) clearTimeout(waitingTimer);
          currentStatus = exitCode === 0 ? "success" : "error";
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
      if (waitingTimer) clearTimeout(waitingTimer);
      sessionCancelRef.current?.();
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
    projectId,
    worktreeId,
    worktreePath,
    updateTerminalPtyId,
    notify,
  ]);

  // Update xterm theme when app theme changes
  useEffect(() => {
    const unsubscribe = useThemeStore.subscribe((state) => {
      const xterm = xtermRef.current;
      if (xterm) {
        xterm.options.theme = XTERM_THEMES[state.theme];
        // Force full canvas repaint so background color updates immediately
        xterm.refresh(0, xterm.rows - 1);
      }
    });
    return unsubscribe;
  }, []);

  // Fix mouse selection offset when canvas viewport is scaled.
  // xterm.js uses getBoundingClientRect() (visual/scaled) to compute mouse
  // offsets but divides by unscaled cell dimensions, causing a mismatch.
  // We intercept mouse events in the capture phase and re-dispatch them
  // with clientX/clientY corrected from visual-space to canvas-space.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const corrected = new WeakSet<Event>();

    const fix = (e: MouseEvent) => {
      if (corrected.has(e)) return;
      const { scale } = useCanvasStore.getState().viewport;
      if (scale === 1) return;

      const rect = container.getBoundingClientRect();
      const adjusted = new MouseEvent(e.type, {
        bubbles: e.bubbles,
        cancelable: e.cancelable,
        clientX: rect.left + (e.clientX - rect.left) / scale,
        clientY: rect.top + (e.clientY - rect.top) / scale,
        screenX: e.screenX,
        screenY: e.screenY,
        button: e.button,
        buttons: e.buttons,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        detail: e.detail,
      });

      corrected.add(adjusted);
      e.stopPropagation();
      e.preventDefault();
      e.target!.dispatchEvent(adjusted);
    };

    const types = ["mousedown", "mousemove", "mouseup", "dblclick"];
    for (const t of types) {
      container.addEventListener(t, fix as EventListener, true);
    }
    return () => {
      for (const t of types) {
        container.removeEventListener(t, fix as EventListener, true);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    removeTerminal(projectId, worktreeId, terminal.id);
  }, [projectId, worktreeId, terminal.id, removeTerminal]);

  return (
    <div
      ref={tileRef}
      className={`absolute terminal-tile rounded-md border bg-[var(--bg)] overflow-hidden flex flex-col ${terminal.focused ? "border-[var(--accent)]" : "border-[var(--border)]"}`}

      style={{
        left: gridX + (isDragging ? dragOffsetX : 0),
        top: gridY + (isDragging ? dragOffsetY : 0),
        width: width,
        height: terminal.minimized ? "auto" : height,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.9 : 1,
        transition: isDragging ? "none" : "left 0.2s ease, top 0.2s ease",
        boxShadow: isDragging ? "0 8px 32px rgba(0,0,0,0.3)" : undefined,
        transform: isDragging ? "scale(1.02)" : undefined,
        outline: isSelected ? "2px solid #3b82f6" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setFocusedTerminal(terminal.id);
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 select-none shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onDragStart?.(terminal.id, e)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
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

      {/* Terminal content — always mounted to preserve PTY session */}
      <div
        ref={containerRef}
        className={terminal.minimized ? "" : "flex-1 min-h-0"}
        style={{
          height: terminal.minimized ? 0 : undefined,
          padding: terminal.minimized ? 0 : 4,
          overflow: "hidden",
        }}
      />

      {contextMenu &&
        createPortal(
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={[
              {
                label: "1\u00d71",
                active: terminal.span.cols === 1 && terminal.span.rows === 1,
                onClick: () => onSpanChange?.({ cols: 1, rows: 1 }),
              },
              {
                label: "2\u00d71 Wide",
                active: terminal.span.cols === 2 && terminal.span.rows === 1,
                onClick: () => onSpanChange?.({ cols: 2, rows: 1 }),
              },
              {
                label: "1\u00d72 Tall",
                active: terminal.span.cols === 1 && terminal.span.rows === 2,
                onClick: () => onSpanChange?.({ cols: 1, rows: 2 }),
              },
              {
                label: "2\u00d72 Large",
                active: terminal.span.cols === 2 && terminal.span.rows === 2,
                onClick: () => onSpanChange?.({ cols: 2, rows: 2 }),
              },
            ]}
            onClose={() => setContextMenu(null)}
          />,
          document.body,
        )}
    </div>
  );
}
