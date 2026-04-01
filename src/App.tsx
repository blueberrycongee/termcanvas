import { useEffect, useState, useCallback } from "react";
import { CanvasRoot } from "./canvas/CanvasRoot";
import { Toolbar } from "./toolbar/Toolbar";
import { NotificationToast } from "./components/NotificationToast";
import { Hub } from "./components/Hub";
import { LeftPanel } from "./components/LeftPanel";
import { initUpdaterListeners, useUpdaterStore } from "./stores/updaterStore";
import { ComposerBar } from "./components/ComposerBar";
import { usePreferencesStore } from "./stores/preferencesStore";
import { DrawingPanel } from "./toolbar/DrawingPanel";
import { ShortcutHints } from "./components/ShortcutHints";
import { CompletionGlow } from "./components/CompletionGlow";
import { UsagePanel } from "./components/UsagePanel";
import { StashBox } from "./components/StashBox";
import { AgentBubble } from "./components/AgentBubble";
import { useAgentBubbleStore } from "./stores/agentBubbleStore";
import { WelcomePopup } from "./components/WelcomePopup";
import {
  useProjectStore,
  createTerminal,
  getProjectBounds,
  generateId,
} from "./stores/projectStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useT } from "./i18n/useT";
import { loadAllDownloadedFonts } from "./terminal/fontLoader";
import { startAutoSummaryWatcher } from "./terminal/summaryScheduler";
import { shouldRunAutoSaveBackstop, useWorkspaceStore } from "./stores/workspaceStore";
import {
  readWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  snapshotState,
  snapshotStateWithRefresh,
  type SkipRestoreSnapshot,
} from "./snapshotState";
import { updateWindowTitle } from "./titleHelper";
import { useNotificationStore } from "./stores/notificationStore";
import { logSlowRendererPath } from "./utils/devPerf";
import { getCloseAction } from "./closeFlow";

function isSkipRestoreSnapshot(
  snapshot: ReturnType<typeof readWorkspaceSnapshot>,
): snapshot is SkipRestoreSnapshot {
  return !!snapshot && "skipRestore" in snapshot;
}

function useWorktreeWatcher() {
  const projectCount = useProjectStore((s) => s.projects.length);

  useEffect(() => {
    if (!window.termcanvas || projectCount === 0) return;

    const inFlight = new Set<string>();
    const pending = new Set<string>();
    const latestSeqByPath = new Map<string, number>();
    let disposed = false;

    const scheduleRescan = (projectPath: string) => {
      if (inFlight.has(projectPath)) {
        pending.add(projectPath);
        return;
      }

      inFlight.add(projectPath);
      const seq = (latestSeqByPath.get(projectPath) ?? 0) + 1;
      latestSeqByPath.set(projectPath, seq);

      void window.termcanvas.project
        .rescanWorktrees(projectPath)
        .then((worktrees) => {
          if (disposed) return;
          if (latestSeqByPath.get(projectPath) !== seq) return;
          useProjectStore.getState().syncWorktrees(projectPath, worktrees);
        })
        .catch((err) => {
          if (!disposed) {
            console.error(
              `[useWorktreeWatcher] failed to rescan ${projectPath}:`,
              err,
            );
          }
        })
        .finally(() => {
          inFlight.delete(projectPath);
          if (!disposed && pending.delete(projectPath)) {
            scheduleRescan(projectPath);
          }
        });
    };

    const rescanAll = () => {
      const { projects } = useProjectStore.getState();
      for (const p of projects) {
        scheduleRescan(p.path);
      }
    };

    rescanAll();
    // Poll every 5s — simple, reliable, cross-platform
    const interval = setInterval(rescanAll, 5000);
    window.addEventListener("focus", rescanAll);

    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener("focus", rescanAll);
    };
  }, [projectCount]);
}

function useStatePersistence() {
  useEffect(() => {
    if (!window.termcanvas) return;
    window.termcanvas.state
      .load()
      .then((saved) => {
        const restored = readWorkspaceSnapshot(saved);
        if (!restored) return;
        if (isSkipRestoreSnapshot(restored)) {
          window.termcanvas.state.save({ skipRestore: false });
          return;
        }
        restoreWorkspaceSnapshot(restored);
        useWorkspaceStore.getState().setWorkspacePath(null);
        useWorkspaceStore.getState().markClean();
      })
      .catch((err) => {
        console.error("[useStatePersistence] failed to load state:", err);
      });
  }, []);
}

function useAutoSave() {
  useEffect(() => {
    if (!window.termcanvas) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const saveSnapshot = async () => {
      const startedAt = performance.now();
      try {
        await window.termcanvas.state.save(snapshotState());
        useWorkspaceStore.setState((state) => ({
          ...state,
          lastSavedAt: Date.now(),
        }));
      } catch (err) {
        console.error("[useAutoSave] failed to save recovery snapshot:", err);
      } finally {
        logSlowRendererPath("App.autoSaveSnapshot", startedAt, {
          thresholdMs: 20,
        });
      }
    };

    const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
      if (state.dirty && state.lastDirtyAt !== prev.lastDirtyAt) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          void saveSnapshot();
        }, 5000);
      }

      if (!state.dirty && prev.dirty && debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    });

    const backstopTimer = setInterval(() => {
      const { dirty, lastDirtyAt, lastSavedAt } = useWorkspaceStore.getState();
      if (shouldRunAutoSaveBackstop({ dirty, lastDirtyAt, lastSavedAt })) {
        void saveSnapshot();
      }
    }, 60_000);

    return () => {
      unsubscribe();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      clearInterval(backstopTimer);
    };
  }, []);
}

function useWorkspaceOpen() {
  useEffect(() => {
    const handler = (e: Event) => {
      const { dirty } = useWorkspaceStore.getState();
      if (
        dirty &&
        !window.confirm("Unsaved changes will be lost. Continue?")
      ) {
        return;
      }

      const raw = (e as CustomEvent<string>).detail;
      try {
        const restored = readWorkspaceSnapshot(raw);
        if (!restored || isSkipRestoreSnapshot(restored)) {
          return;
        }
        restoreWorkspaceSnapshot(restored);
        useWorkspaceStore.getState().setWorkspacePath(null);
        useWorkspaceStore.getState().markClean();
      } catch (err) {
        console.error("[useWorkspaceOpen] failed to parse workspace file:", err);
      }
    };
    window.addEventListener("termcanvas:open-workspace", handler);
    return () =>
      window.removeEventListener("termcanvas:open-workspace", handler);
  }, []);
}

function useCloseHandler() {
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const t = useT();
  const consumeRestartOnClose = useCallback(
    () => useUpdaterStore.getState().consumeRestartOnClose(),
    [],
  );
  const cancelRestartOnClose = useCallback(
    () => useUpdaterStore.getState().cancelRestartOnClose(),
    [],
  );

  useEffect(() => {
    if (!window.termcanvas) return;

    const unsubscribe = window.termcanvas.app.onBeforeClose(() => {
      const { dirty } = useWorkspaceStore.getState();
      const action = getCloseAction({
        dirty,
        installUpdateRequested:
          useUpdaterStore.getState().installOnCloseRequested,
      });

      if (action === "silent-close") {
        void (async () => {
          const startedAt = performance.now();
          try {
            await window.termcanvas.state.save(await snapshotStateWithRefresh());
          } catch (err) {
            console.error("[CloseHandler] failed to save recovery snapshot:", err);
          } finally {
            logSlowRendererPath("App.closeRecoverySnapshot", startedAt, {
              thresholdMs: 20,
            });
            window.termcanvas.app.confirmClose({
              installUpdate: consumeRestartOnClose(),
            });
          }
        })();
        return;
      }

      setShowCloseDialog(true);
    });

    return unsubscribe;
  }, [consumeRestartOnClose]);

  const handleSave = useCallback(async () => {
    try {
      const snap = await snapshotStateWithRefresh();
      const { workspacePath } = useWorkspaceStore.getState();

      if (workspacePath) {
        await window.termcanvas.workspace.saveToPath(workspacePath, snap);
      } else {
        const savedPath = await window.termcanvas.workspace.save(snap);
        if (!savedPath) {
          return;
        }
        useWorkspaceStore.getState().setWorkspacePath(savedPath);
      }
      await window.termcanvas.state.save(snap);
      useWorkspaceStore.getState().markClean();
      window.termcanvas.app.confirmClose({
        installUpdate: consumeRestartOnClose(),
      });
    } catch (err) {
      console.error("[CloseHandler] save failed:", err);
      useNotificationStore
        .getState()
        .notify("error", t.save_error(String(err)));
    }
  }, [consumeRestartOnClose, t]);

  const handleDiscard = useCallback(async () => {
    await window.termcanvas.state.save({ skipRestore: true });
    window.termcanvas.app.confirmClose({
      installUpdate: consumeRestartOnClose(),
    });
  }, [consumeRestartOnClose]);

  const handleCancel = useCallback(() => {
    cancelRestartOnClose();
    setShowCloseDialog(false);
  }, [cancelRestartOnClose]);

  return { showCloseDialog, handleSave, handleDiscard, handleCancel };
}

function CloseDialog({
  onSave,
  onDiscard,
  onCancel,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 max-w-sm w-full mx-4">
        <h2 className="text-[15px] font-medium text-[var(--text-primary)] mb-2">
          {t.save_workspace_title}
        </h2>
        <p className="text-[13px] text-[var(--text-secondary)] mb-6">
          {t.save_workspace_desc}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            className="px-3 py-1.5 rounded-md text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors duration-150"
            onClick={onCancel}
          >
            {t.cancel}
          </button>
          <button
            className="px-3 py-1.5 rounded-md text-[13px] text-[var(--red)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
            onClick={onDiscard}
          >
            {t.dont_save}
          </button>
          <button
            className="px-3 py-1.5 rounded-md text-[13px] text-white bg-[var(--accent)] hover:brightness-110 transition-all duration-150"
            onClick={onSave}
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  useWorktreeWatcher();
  useStatePersistence();
  useAutoSave();
  useWorkspaceOpen();
  useKeyboardShortcuts();
  const t = useT();
  const composerEnabled = usePreferencesStore((s) => s.composerEnabled);
  const drawingEnabled = usePreferencesStore((s) => s.drawingEnabled);
  const summaryEnabled = usePreferencesStore((s) => s.summaryEnabled);
  const { showCloseDialog, handleSave, handleDiscard, handleCancel } =
    useCloseHandler();

  const bubbleMessages = useAgentBubbleStore((s) => s.messages);
  const bubbleTaskCount = useAgentBubbleStore((s) => s.activeTaskCount);
  const addBubbleMessage = useAgentBubbleStore((s) => s.addMessage);
  const activeSessionId = useAgentBubbleStore((s) => s.activeSessionId);
  const agentConfig = usePreferencesStore((s) => s.agentConfig);
  const handleBubbleSend = useCallback(
    (text: string) => {
      addBubbleMessage({
        id: generateId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      });

      if (agentConfig.apiKey) {
        window.termcanvas.agent.send(activeSessionId, text, {
          type: agentConfig.type,
          baseURL: agentConfig.baseURL,
          apiKey: agentConfig.apiKey,
          model: agentConfig.model,
        });
      }
    },
    [addBubbleMessage, activeSessionId, agentConfig],
  );

  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem("termcanvas-welcome-seen");
  });

  useEffect(() => {
    if (!summaryEnabled) return;
    return startAutoSummaryWatcher();
  }, [summaryEnabled]);

  useEffect(() => initUpdaterListeners(), []);

  useEffect(() => {
    if (!window.termcanvas?.menu) return;
    return window.termcanvas.menu.onOpenFolder(async (dirPath: string) => {
      const { notify } = useNotificationStore.getState();
      try {
        const info = await window.termcanvas.project.scan(dirPath);
        if (!info) {
          notify("error", "Failed to scan directory");
          return;
        }
        const { projects, addProject } = useProjectStore.getState();
        let placeX = 0;
        const gap = 80;
        for (const p of projects) {
          const bounds = getProjectBounds(p);
          placeX = Math.max(placeX, bounds.x + bounds.w + gap);
        }
        addProject({
          id: generateId(),
          name: info.name,
          path: info.path,
          position: { x: placeX, y: 0 },
          collapsed: false,
          zIndex: 0,
          worktrees: info.worktrees.map((wt, i) => ({
            id: generateId(),
            name: wt.branch,
            path: wt.path,
            position: { x: 0, y: i * 360 },
            collapsed: false,
            terminals: [],
          })),
        });
      } catch (err) {
        notify("error", String(err));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAllDownloadedFonts();
  }, []);

  useEffect(() => {
    const unsubscribe = useWorkspaceStore.subscribe(() => updateWindowTitle());
    updateWindowTitle();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const api = {
      getProjects: () => {
        const { projects } = useProjectStore.getState();
        return JSON.parse(
          JSON.stringify(
            projects.map((p: any) => ({
              id: p.id,
              name: p.name,
              path: p.path,
              collapsed: p.collapsed,
              worktrees: p.worktrees.map((w: any) => ({
                id: w.id,
                name: w.name,
                path: w.path,
                terminals: w.terminals.map((t: any) => ({
                  id: t.id,
                  title: t.title,
                  customTitle: t.customTitle,
                  starred: t.starred,
                  type: t.type,
                  status: t.status,
                  ptyId: t.ptyId,
                  span: t.span,
                  parentTerminalId: t.parentTerminalId,
                })),
              })),
            })),
          ),
        );
      },

      addProject: (projectData: any) => {
        useProjectStore.getState().addProject(projectData);
        return true;
      },

      removeProject: (projectId: string) => {
        useProjectStore.getState().removeProject(projectId);
        return true;
      },

      addTerminal: (projectId: string, worktreeId: string, type: string, prompt?: string, autoApprove?: boolean, parentTerminalId?: string | null) => {
        const terminal = createTerminal(type as any, undefined, prompt, autoApprove, "agent", parentTerminalId ?? undefined);
        useProjectStore.getState().addTerminal(projectId, worktreeId, terminal);
        return JSON.parse(JSON.stringify(terminal));
      },

      removeTerminal: (
        projectId: string,
        worktreeId: string,
        terminalId: string,
      ) => {
        useProjectStore
          .getState()
          .removeTerminal(projectId, worktreeId, terminalId);
        return true;
      },

      syncWorktrees: (projectPath: string, worktrees: any[]) => {
        useProjectStore.getState().syncWorktrees(projectPath, worktrees);
        return true;
      },

      getTerminal: (terminalId: string) => {
        const { projects } = useProjectStore.getState();
        for (const p of projects) {
          for (const w of p.worktrees) {
            const t = w.terminals.find((t: any) => t.id === terminalId);
            if (t)
              return JSON.parse(
                JSON.stringify({
                  id: t.id,
                  title: t.title,
                  customTitle: t.customTitle,
                  starred: t.starred,
                  type: t.type,
                  status: t.status,
                  ptyId: t.ptyId,
                  span: t.span,
                  parentTerminalId: t.parentTerminalId,
                  projectId: p.id,
                  worktreeId: w.id,
                  worktreePath: w.path,
                }),
              );
          }
        }
        return null;
      },

      setCustomTitle: (terminalId: string, customTitle: string) => {
        const { projects } = useProjectStore.getState();
        for (const p of projects) {
          for (const w of p.worktrees) {
            const t = w.terminals.find((t) => t.id === terminalId);
            if (t) {
              useProjectStore.getState().updateTerminalCustomTitle(
                p.id,
                w.id,
                terminalId,
                customTitle,
              );
              return true;
            }
          }
        }
        throw new Error("Terminal not found");
      },
    };

    (window as any).__tcApi = api;
    return () => {
      delete (window as any).__tcApi;
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]">
      <Toolbar onShowTutorial={() => setShowWelcome(true)} />
      <Hub />
      <LeftPanel />
      <CanvasRoot />
      {drawingEnabled && <DrawingPanel />}
      <CompletionGlow />
      <ShortcutHints />
      <UsagePanel />
      <StashBox />
      <AgentBubble
        messages={bubbleMessages}
        activeTaskCount={bubbleTaskCount}
        onSendMessage={handleBubbleSend}
      />
      {composerEnabled && <ComposerBar />}
      <NotificationToast />
      {showCloseDialog && (
        <CloseDialog
          onSave={handleSave}
          onDiscard={handleDiscard}
          onCancel={handleCancel}
        />
      )}
      {showWelcome && (
        <WelcomePopup
          onClose={() => {
            localStorage.setItem("termcanvas-welcome-seen", "1");
            setShowWelcome(false);
          }}
        />
      )}
    </div>
  );
}
