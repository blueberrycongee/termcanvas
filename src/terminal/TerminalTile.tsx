import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { TerminalData, TerminalType } from "../types";
import { useProjectStore, findTerminalById, getChildTerminals } from "../stores/projectStore";
import { useSelectionStore } from "../stores/selectionStore";
import { ContextMenu } from "../components/ContextMenu";
import { useNotificationStore } from "../stores/notificationStore";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";
import { useThemeStore, TERMINAL_THEMES } from "../stores/themeStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useT } from "../i18n/useT";
import {
  getTerminalLaunchOptions,
  getTerminalPromptArgs,
  getComposerAdapter,
} from "./cliConfig";
import { buildFontFamily } from "./fontRegistry";
import {
  createTerminalEngineSession,
  type CompatibleTerminal,
  type TerminalEngineSession,
} from "./terminalEngine";
import { panToTerminal } from "../utils/panToTerminal";
import { getTerminalDisplayTitle } from "../stores/terminalState";
import {
  cancelScheduledTerminalFocus,
  scheduleTerminalFocus,
} from "./focusScheduler";
import { handleTerminalCustomKeyEvent } from "./keyHandling";

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
  lazygit: { color: "#e84d31", label: "Lazygit" },
  tmux: { color: "#1bb91f", label: "Tmux" },
};

async function pollSessionId(
  ptyId: number,
  cliType: string,
  worktreePath: string,
  onFound: (sid: string) => void,
  shouldCancel: () => boolean,
  detectedCliPid?: number | null,
) {
  const MAX_ATTEMPTS = 15;
  const INTERVAL = 2000;

  // For claude: capture PID upfront so it survives process exit.
  // When launched from a shell terminal (auto-detected), the PTY PID is the
  // shell, not the actual Claude process. `detectedCliPid` (from detectCli)
  // provides the real Claude PID in that case.
  let cachedPid: number | null = detectedCliPid ?? null;
  if (!cachedPid && cliType === "claude") {
    cachedPid = (await window.termcanvas.terminal.getPid(ptyId)) ?? null;
  }

  // For codex: capture baseline session ID before polling starts.
  // getCodexLatest() is a global lookup (returns the latest from session_index.jsonl),
  // so without a baseline we'd capture a stale session from a previous Codex run.
  let codexBaseline: string | null = null;
  if (cliType === "codex") {
    codexBaseline = await window.termcanvas.session.getCodexLatest();
  }

  console.log(`[SessionCapture] start ptyId=${ptyId} type=${cliType}${cachedPid != null ? ` pid=${cachedPid}` : ""}${codexBaseline != null ? ` codexBaseline=${codexBaseline}` : ""}`);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, INTERVAL));
    if (shouldCancel()) {
      console.log(`[SessionCapture] cancelled ptyId=${ptyId}`);
      return;
    }

    let sid: string | null = null;
    if (cliType === "codex") {
      sid = await window.termcanvas.session.getCodexLatest();
      // Reject stale session from before this terminal was created
      if (sid && sid === codexBaseline) sid = null;
    } else if (cliType === "claude") {
      const pid = cachedPid ?? (await window.termcanvas.terminal.getPid(ptyId)) ?? null;
      if (!cachedPid && pid) cachedPid = pid;
      if (pid) {
        sid = await window.termcanvas.session.getClaudeByPid(pid);
      }
    } else if (cliType === "kimi") {
      sid = await window.termcanvas.session.getKimiLatest(worktreePath);
    }

    console.log(`[SessionCapture] poll ${attempt + 1}/${MAX_ATTEMPTS} ptyId=${ptyId} sid=${sid ?? "null"}`);

    if (sid) {
      console.log(`[SessionCapture] found sid=${sid} for ptyId=${ptyId}`);
      onFound(sid);
      return;
    }
  }

  console.warn(`[SessionCapture] timeout ptyId=${ptyId} type=${cliType} after ${MAX_ATTEMPTS} attempts`);
  return "timeout";
}

function HierarchyBadges({ terminal }: { terminal: TerminalData }) {
  const projects = useProjectStore((s) => s.projects);

  const parentInfo = terminal.parentTerminalId
    ? findTerminalById(projects, terminal.parentTerminalId)
    : null;
  const children = getChildTerminals(projects, terminal.id);

  if (!parentInfo && children.length === 0) return null;

  return (
    <>
      {parentInfo && (
        <button
          className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors duration-150 shrink-0"
          title={`Parent: ${parentInfo.terminal.title} (${parentInfo.terminal.type})`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            panToTerminal(parentInfo.terminal.id);
          }}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
            <path d="M6 9V3M3 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {parentInfo.terminal.type}
        </button>
      )}
      {children.length > 0 && (
        <button
          className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors duration-150 shrink-0"
          title={`${children.length} agent${children.length > 1 ? "s" : ""}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            panToTerminal(children[0].terminal.id);
          }}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v4M3 4v4M9 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {children.length}
        </button>
      )}
    </>
  );
}

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
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const [isEditingCustomTitle, setIsEditingCustomTitle] = useState(false);
  const [customTitleDraft, setCustomTitleDraft] = useState(terminal.customTitle ?? "");
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayTitleRef = useRef(getTerminalDisplayTitle(terminal));
  const tileRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingFocusFrameRef = useRef<number | null>(null);
  const customTitleInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<CompatibleTerminal | null>(null);
  const engineSessionRef = useRef<TerminalEngineSession | null>(null);
  const ptyIdRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionCancelRef = useRef<(() => void) | null>(null);

  const {
    removeTerminal,
    toggleTerminalMinimize,
    toggleTerminalStarred,
    updateTerminalCustomTitle,
    updateTerminalPtyId,
    updateTerminalStatus,
    updateTerminalSessionId,
    updateTerminalType,
    setFocusedTerminal,
  } = useProjectStore();

  const { notify } = useNotificationStore();
  const t = useT();
  const config = TYPE_CONFIG[terminal.type] ?? { color: "#888", label: terminal.type };

  useEffect(() => {
    displayTitleRef.current = getTerminalDisplayTitle(terminal);
  }, [terminal.title, terminal.customTitle]);

  useEffect(() => {
    if (!isEditingCustomTitle) {
      setCustomTitleDraft(terminal.customTitle ?? "");
    }
  }, [isEditingCustomTitle, terminal.customTitle]);

  const startCustomTitleEdit = useCallback(() => {
    setCustomTitleDraft(terminal.customTitle ?? "");
    setIsEditingCustomTitle(true);
  }, [terminal.customTitle]);

  const stopCustomTitleEdit = useCallback(() => {
    setIsEditingCustomTitle(false);
  }, []);

  const saveCustomTitleEdit = useCallback(() => {
    updateTerminalCustomTitle(
      projectId,
      worktreeId,
      terminal.id,
      customTitleDraft,
    );
    setIsEditingCustomTitle(false);
  }, [
    customTitleDraft,
    projectId,
    terminal.id,
    updateTerminalCustomTitle,
    worktreeId,
  ]);

  useEffect(() => {
    if (!isEditingCustomTitle) return;

    requestAnimationFrame(() => {
      customTitleInputRef.current?.focus();
      customTitleInputRef.current?.select();
    });
  }, [isEditingCustomTitle]);

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

    let cancelled = false;

    void (async () => {
      try {
        const currentTheme = useThemeStore.getState().theme;
        const prefs = usePreferencesStore.getState();
        const session = await createTerminalEngineSession({
          container: containerRef.current!,
          theme: TERMINAL_THEMES[currentTheme],
          fontFamily: buildFontFamily(prefs.terminalFontFamily),
          fontSize: prefs.terminalFontSize,
          minimumContrastRatio: prefs.minimumContrastRatio,
          scrollback: terminal.scrollback,
        });

        if (cancelled) {
          session.dispose();
          return;
        }

        const terminalView = session.terminal;
        terminalRef.current = terminalView;
        engineSessionRef.current = session;
        registerTerminal(terminal.id, session.serialize);

        let ptyId: number | null = null;
        const cliOverride = prefs.cliCommands[terminal.type] ?? undefined;
        const wasResumeAttempt = !!terminal.sessionId && !!getTerminalLaunchOptions(terminal.type, terminal.sessionId, terminal.autoApprove);
        let hasRespawned = false;
        let inputDisposable: { dispose(): void } | null = null;
        let resizeDisposable: { dispose(): void } | null = null;

        terminalView.attachCustomKeyEventHandler((e) =>
          handleTerminalCustomKeyEvent(e, (data) => {
            if (ptyId !== null) {
              window.termcanvas.terminal.input(ptyId, data);
            }
          }),
        );

        const selectionDisposable = terminalView.onSelectionChange(() => {
          const text = terminalView.getSelection();
          if (text) {
            navigator.clipboard.writeText(text);
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
            setShowCopiedToast(true);
            copiedTimerRef.current = setTimeout(() => setShowCopiedToast(false), 1500);
          }
        });

        /**
         * Create a PTY and wire up input/resize handlers.
         * When `resumeSessionId` is provided the CLI is launched with --resume;
         * otherwise a fresh session is started.
         */
        const spawnPty = (resumeSessionId: string | undefined) => {
          const opts: { cwd: string; shell?: string; args?: string[]; terminalId?: string; theme?: "dark" | "light" } = {
            cwd: worktreePath,
            terminalId: terminal.id,
          };
          opts.theme = useThemeStore.getState().theme;

          const launch = getTerminalLaunchOptions(
            terminal.type,
            resumeSessionId,
            terminal.autoApprove,
            cliOverride,
          );
          if (launch) {
            const promptArgs =
              !resumeSessionId && terminal.initialPrompt
                ? getTerminalPromptArgs(terminal.type, terminal.initialPrompt)
                : [];
            opts.shell = launch.shell;
            opts.args = [...launch.args, ...promptArgs];
          }

          window.termcanvas.terminal
            .create(opts)
            .then(async (id) => {
              ptyId = id;
              ptyIdRef.current = id;
              updateTerminalPtyId(projectId, worktreeId, terminal.id, id);
              updateTerminalStatus(projectId, worktreeId, terminal.id, "running");

              if (
                resumeSessionId &&
                (terminal.type === "claude" || terminal.type === "codex")
              ) {
                console.log(`[SessionCapture] watch (resume) type=${terminal.type} sid=${resumeSessionId} cwd=${worktreePath}`);
                window.termcanvas.session.watch(
                  terminal.type,
                  resumeSessionId,
                  worktreePath,
                ).then((res: { ok: boolean; reason?: string }) => {
                  if (!res?.ok) {
                    console.warn(`[SessionCapture] watch failed (resume) reason=${res?.reason}`);
                    notify("warn", `Session watch failed: ${res?.reason ?? "unknown"}`);
                  }
                }).catch((err: unknown) => {
                  console.error("[SessionCapture] watch IPC error (resume):", err);
                });
              }

              if (!resumeSessionId && launch) {
                let pollCancelled = false;
                sessionCancelRef.current = () => { pollCancelled = true; };

                pollSessionId(
                  id, terminal.type, worktreePath,
                  (sid) => {
                    updateTerminalSessionId(projectId, worktreeId, terminal.id, sid);
                    if (terminal.type === "claude" || terminal.type === "codex") {
                      console.log(`[SessionCapture] watch (new) type=${terminal.type} sid=${sid} cwd=${worktreePath}`);
                      window.termcanvas.session.watch(terminal.type, sid, worktreePath)
                        .then((res: { ok: boolean; reason?: string }) => {
                          if (!res?.ok) {
                            console.warn(`[SessionCapture] watch failed (new) reason=${res?.reason}`);
                            notify("warn", `Session watch failed: ${res?.reason ?? "unknown"}`);
                          }
                        }).catch((err: unknown) => {
                          console.error("[SessionCapture] watch IPC error (new):", err);
                        });
                    }
                  },
                  () => pollCancelled,
                ).then((result) => {
                  if (result === "timeout") {
                    notify("warn", `Session capture timeout for ${displayTitleRef.current}`);
                  }
                });
              }

              inputDisposable?.dispose();
              resizeDisposable?.dispose();
              inputDisposable = terminalView.onData((data) => {
                if (ptyId !== null) window.termcanvas.terminal.input(ptyId, data);
              });
              resizeDisposable = terminalView.onResize(({ cols, rows }) => {
                if (ptyId !== null) window.termcanvas.terminal.resize(ptyId, cols, rows);
              });

              session.fit();
              const { cols, rows } = terminalView;
              window.termcanvas.terminal.resize(id, cols, rows);
            })
            .catch((err) => {
              const errStr = err instanceof Error ? err.message : String(err);
              const isNotFound =
                errStr.includes("Executable not found") ||
                errStr.includes("executable-not-found");

              notify("error", t.failed_create_pty(displayTitleRef.current, errStr));
              updateTerminalStatus(projectId, worktreeId, terminal.id, "error");

              if (isNotFound) {
                const command = launch?.shell ?? terminal.type;
                terminalView.write(
                  `\r\n\x1b[31m${t.cli_launch_error_title(command)}\x1b[0m\r\n` +
                  `\r\n\x1b[33m${t.cli_launch_error_action}: Settings > Agents\x1b[0m\r\n`,
                );
              } else {
                terminalView.write(
                  `\r\n\x1b[31m[Error] Failed to create terminal: ${errStr}\x1b[0m\r\n`,
                );
              }
            });
        };

        spawnPty(terminal.sessionId);

        let currentStatus: string = "running";
        let waitingTimer: ReturnType<typeof setTimeout> | null = null;
        const WAITING_THRESHOLD = 15_000;

        let lastDetectedType: string | null = terminal.type !== "shell" ? terminal.type : null;
        let detectTimer: ReturnType<typeof setTimeout> | null = null;

        const triggerDetection = () => {
          if (terminal.type !== "shell" || ptyId === null) return;
          if (detectTimer) clearTimeout(detectTimer);
          detectTimer = setTimeout(async () => {
            if (ptyId === null) return;
            const result = await window.termcanvas.terminal.detectCli(ptyId);
            const newType = (result?.cliType ?? null) as TerminalType | null;
            if (!newType || newType === lastDetectedType) return;
            lastDetectedType = newType;

            updateTerminalType(projectId, worktreeId, terminal.id, newType);

            if (newType === "tmux" && result!.sessionName) {
              updateTerminalSessionId(projectId, worktreeId, terminal.id, result!.sessionName);
              return;
            }

            sessionCancelRef.current?.();
            let pollCancelled = false;
            sessionCancelRef.current = () => { pollCancelled = true; };
            pollSessionId(
              ptyId, newType, worktreePath,
              (sid) => {
                updateTerminalSessionId(projectId, worktreeId, terminal.id, sid);
                if (newType === "claude" || newType === "codex") {
                  console.log(`[SessionCapture] watch (detected) type=${newType} sid=${sid} cwd=${worktreePath}`);
                  window.termcanvas.session.watch(newType, sid, worktreePath)
                    .then((res: { ok: boolean; reason?: string }) => {
                      if (!res?.ok) {
                        console.warn(`[SessionCapture] watch failed (detected) reason=${res?.reason}`);
                        notify("warn", `Session watch failed: ${res?.reason ?? "unknown"}`);
                      }
                    }).catch((err: unknown) => {
                      console.error("[SessionCapture] watch IPC error (detected):", err);
                    });
                }
              },
              () => pollCancelled,
              result?.pid,
            ).then((r) => {
              if (r === "timeout") {
                notify("warn", `Session capture timeout for ${displayTitleRef.current}`);
              }
            });
          }, 3000);
        };

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
              terminalView.write(data);
              triggerDetection();

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

              if (exitCode !== 0 && wasResumeAttempt && !hasRespawned) {
                hasRespawned = true;
                console.log(`[TermCanvas] Resume failed for session=${terminal.sessionId}, respawning fresh`);
                updateTerminalSessionId(projectId, worktreeId, terminal.id, undefined);
                terminalView.write("\r\n\x1b[33m[Session expired, starting fresh…]\x1b[0m\r\n");
                spawnPty(undefined);
                return;
              }

              currentStatus = exitCode === 0 ? "success" : "error";
              terminalView.write(t.process_exited(exitCode));
              updateTerminalStatus(
                projectId,
                worktreeId,
                terminal.id,
                exitCode === 0 ? "success" : "error",
              );
              notify(
                exitCode === 0 ? "info" : "warn",
                t.terminal_exited(displayTitleRef.current, exitCode),
              );
            }
          },
        );

        const removeTurnComplete = window.termcanvas.session.onTurnComplete(
          (sessionId: string) => {
            const state = useProjectStore.getState();
            const proj = state.projects.find((p) => p.id === projectId);
            const wt = proj?.worktrees.find((w) => w.id === worktreeId);
            const term = wt?.terminals.find((t) => t.id === terminal.id);
            console.log(`[SessionCapture] onTurnComplete sid=${sessionId} termSid=${term?.sessionId ?? "null"} status=${currentStatus}`);
            if (term?.sessionId === sessionId) {
              if (currentStatus === "active" || currentStatus === "waiting") {
                currentStatus = "completed";
                updateTerminalStatus(
                  projectId,
                  worktreeId,
                  terminal.id,
                  "completed",
                );
                console.log(`[SessionCapture] status -> completed for terminal=${terminal.id}`);
              }
            }
          },
        );

        cleanupRef.current = () => {
          if (waitingTimer) clearTimeout(waitingTimer);
          if (detectTimer) clearTimeout(detectTimer);
          sessionCancelRef.current?.();
          removeTurnComplete();
          selectionDisposable.dispose();
          inputDisposable?.dispose();
          resizeDisposable?.dispose();
          const state = useProjectStore.getState();
          const proj = state.projects.find((p) => p.id === projectId);
          const wt = proj?.worktrees.find((w) => w.id === worktreeId);
          const term = wt?.terminals.find((t) => t.id === terminal.id);
          if (term?.sessionId) {
            window.termcanvas.session.unwatch(term.sessionId);
          }
          unregisterTerminal(terminal.id);
          removeOutput();
          removeExit();
          terminalRef.current = null;
          engineSessionRef.current = null;
          session.dispose();
          if (ptyId !== null) {
            ptyIdRef.current = null;
            window.termcanvas.terminal.destroy(ptyId).catch((err) => {
              console.error(`[TermCanvas] Failed to destroy PTY ${ptyId}:`, err);
            });
          }
        };
      } catch (err) {
        const errStr = err instanceof Error ? err.message : String(err);
        updateTerminalStatus(projectId, worktreeId, terminal.id, "error");
        notify("error", `[Terminal] Failed to initialize renderer: ${errStr}`);
      }
    })();

    return () => {
      cancelled = true;
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

  useEffect(() => {
    if (terminal.minimized) return;
    if (!engineSessionRef.current) return;

    // Only fit when the tile's geometry changes from React state.
    const frame = requestAnimationFrame(() => {
      engineSessionRef.current?.fit();
    });

    return () => cancelAnimationFrame(frame);
  }, [width, height, terminal.minimized]);

  // Give terminal DOM focus when composer is disabled or terminal type
  // doesn't support the Composer.
  const composerEnabled = usePreferencesStore((s) => s.composerEnabled);
  const focusTerminalInput = useCallback(() => {
    const tile = tileRef.current;
    const terminalView = terminalRef.current;
    if (!tile || !terminalView || tile.getClientRects().length === 0) {
      return false;
    }

    terminalView.focus();
    return tile.contains(document.activeElement);
  }, []);
  const scheduleTerminalInputFocus = useCallback(() => {
    scheduleTerminalFocus(focusTerminalInput, pendingFocusFrameRef);
  }, [focusTerminalInput]);

  useEffect(() => {
    const adapter = getComposerAdapter(terminal.type);
    const shouldFocusTerminalInput = terminal.focused && (!adapter || !composerEnabled);

    if (terminal.focused) {
      engineSessionRef.current?.touch();
    }

    if (shouldFocusTerminalInput) {
      scheduleTerminalInputFocus();
    } else {
      cancelScheduledTerminalFocus(pendingFocusFrameRef);
    }
  }, [
    terminal.focused,
    terminal.id,
    terminal.type,
    composerEnabled,
    scheduleTerminalInputFocus,
  ]);

  // Listen for explicit terminal input focus requests (when composer is disabled)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === terminal.id) {
        scheduleTerminalInputFocus();
      }
    };
    window.addEventListener("termcanvas:focus-terminal-input", handler);
    return () => window.removeEventListener("termcanvas:focus-terminal-input", handler);
  }, [scheduleTerminalInputFocus, terminal.id]);

  useEffect(
    () => () => {
      cancelScheduledTerminalFocus(pendingFocusFrameRef);
    },
    [],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === terminal.id) {
        startCustomTitleEdit();
      }
    };
    window.addEventListener("termcanvas:focus-custom-title", handler);
    return () => window.removeEventListener("termcanvas:focus-custom-title", handler);
  }, [startCustomTitleEdit, terminal.id]);

  // Update terminal theme when app theme changes
  useEffect(() => {
    const unsubscribe = useThemeStore.subscribe((state) => {
      engineSessionRef.current?.applyTheme(TERMINAL_THEMES[state.theme]);
      if (ptyIdRef.current !== null) {
        window.termcanvas.terminal.notifyThemeChanged(ptyIdRef.current);
      }
    });
    return unsubscribe;
  }, []);

  // Update terminal font size when preference changes
  useEffect(() => {
    const unsubscribe = usePreferencesStore.subscribe((state) => {
      engineSessionRef.current?.applyFontSize(state.terminalFontSize);
    });
    return unsubscribe;
  }, []);

  // Update terminal font family when preference changes
  useEffect(() => {
    const unsubscribe = usePreferencesStore.subscribe((state) => {
      engineSessionRef.current?.applyFontFamily(
        buildFontFamily(state.terminalFontFamily),
      );
    });
    return unsubscribe;
  }, []);

  // Update terminal minimum contrast ratio when preference changes
  useEffect(() => {
    const unsubscribe = usePreferencesStore.subscribe((state) => {
      engineSessionRef.current?.applyMinimumContrastRatio(
        state.minimumContrastRatio,
      );
    });
    return unsubscribe;
  }, []);

  // Fix mouse selection offset when canvas viewport is scaled.
  // Terminal mouse hit-testing uses getBoundingClientRect() (visual/scaled) to compute mouse
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
      className="absolute terminal-tile rounded-md bg-[var(--bg)] overflow-hidden flex flex-col border border-[var(--border)] hover:border-[var(--border-hover)]"

      style={{
        left: gridX + (isDragging ? dragOffsetX : 0),
        top: gridY + (isDragging ? dragOffsetY : 0),
        width: width,
        height: terminal.minimized ? "auto" : height,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.9 : 1,
        transition: isDragging ? "none" : "left 0.2s ease, top 0.2s ease",
        boxShadow: isDragging
          ? "0 8px 32px rgba(0,0,0,0.3)"
          : terminal.focused
            ? "0 0 0 1px rgba(0,112,243,0.45), 0 0 8px rgba(0,112,243,0.15)"
            : undefined,
        transform: isDragging ? "scale(1.02)" : undefined,
        outline: isSelected ? "2px solid #3b82f6" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setFocusedTerminal(terminal.id);
      }}
      onMouseEnter={() => {
        window.dispatchEvent(new CustomEvent("termcanvas:terminal-hover", { detail: terminal.id }));
      }}
      onMouseLeave={() => {
        window.dispatchEvent(new CustomEvent("termcanvas:terminal-hover", { detail: null }));
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
        {terminal.origin !== "agent" && (
          <div className="w-[3px] h-3 rounded-full bg-amber-500/60 shrink-0" />
        )}
        <span
          className="text-[11px] font-medium"
          style={{ color: config.color, fontFamily: '"Geist Mono", monospace' }}
        >
          {config.label}
        </span>
        <HierarchyBadges terminal={terminal} />
        <span
          className="text-[11px] text-[var(--text-muted)] truncate shrink-0"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {terminal.title}
        </span>
        <div
          className={`h-6 min-w-0 flex-1 rounded-md border px-1.5 text-[11px] ${
            terminal.customTitle
              ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
              : "border-dashed border-[var(--border)] bg-[var(--bg)] text-[var(--text-faint)]"
          }`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          title={terminal.customTitle || t.terminal_custom_title_placeholder}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startCustomTitleEdit();
          }}
        >
          <div className="flex h-full items-center gap-1.5 min-w-0">
            <button
              className={`shrink-0 rounded p-0.5 transition-colors duration-150 ${
                terminal.starred
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-[var(--text-faint)] hover:text-amber-400"
              }`}
              title={terminal.starred ? t.terminal_unstar : t.terminal_star}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleTerminalStarred(projectId, worktreeId, terminal.id);
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M5 1.2l1.05 2.13 2.35.34-1.7 1.66.4 2.35L5 6.58 2.9 7.68l.4-2.35L1.6 3.67l2.35-.34L5 1.2z"
                  fill={terminal.starred ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {isEditingCustomTitle ? (
              <input
                ref={customTitleInputRef}
                className="min-w-0 flex-1 bg-transparent outline-none leading-[22px] text-[var(--text-primary)]"
                value={customTitleDraft}
                placeholder={t.terminal_custom_title_placeholder}
                onChange={(e) => setCustomTitleDraft(e.target.value)}
                onBlur={saveCustomTitleEdit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveCustomTitleEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    stopCustomTitleEdit();
                  }
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate leading-[22px]">
                {terminal.customTitle || t.terminal_custom_title_placeholder}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onMouseDown={(e) => e.stopPropagation()}
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
            onMouseDown={(e) => e.stopPropagation()}
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
      {/* Only give terminal direct DOM focus for "type"-mode terminals (shell,
          lazygit, tmux) that need real-time keystroke interaction.
          "paste"-mode terminals (AI CLIs) keep Composer focused. */}
      <div
        ref={containerRef}
        className={terminal.minimized ? "" : "flex-1 min-h-0"}
        style={{
          height: terminal.minimized ? 0 : undefined,
          padding: terminal.minimized ? 0 : 4,
          overflow: "hidden",
        }}
        onClick={() => {
          const adapter = getComposerAdapter(terminal.type);
          if (!adapter || adapter.inputMode === "type" || !composerEnabled) {
            scheduleTerminalInputFocus();
          }
        }}
      />

      {/* Copied toast */}
      {showCopiedToast && (
        <div className="absolute left-1/2 bottom-3 -translate-x-1/2 px-3 py-1 rounded-md bg-[var(--surface)] text-[var(--text-primary)] text-xs font-medium shadow-lg border border-[var(--border)] pointer-events-none z-10 animate-[fadeIn_0.15s_ease-out]">
          {t.terminal_copied}
        </div>
      )}

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
