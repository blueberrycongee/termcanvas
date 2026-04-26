import { useEffect, useState } from "react";
import { CanvasRoot } from "./canvas/CanvasRoot";
import { addProjectFromDirectoryPath } from "./canvas/sceneCommands";
import { Toolbar } from "./toolbar/Toolbar";
import { BottomToolbar } from "./toolbar/BottomToolbar";
import { NotificationToast } from "./components/NotificationToast";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { FileEditorDrawer } from "./components/FileEditorDrawer";
import { PinDetailDrawer } from "./components/PinDetailDrawer";
import { initUpdaterListeners } from "./stores/updaterStore";
import { ComposerBar } from "./components/ComposerBar";
import { usePreferencesStore, hydrateApiKey } from "./stores/preferencesStore";
import { DrawingPanel } from "./toolbar/DrawingPanel";
import { ShortcutHints } from "./components/ShortcutHints";
import { CompletionGlow } from "./components/CompletionGlow";
import { initSessionStoreIPC } from "./stores/sessionStore";
import { WelcomePopup } from "./components/WelcomePopup";
import { SearchModal } from "./components/SearchModal";
import { UsageOverlay } from "./components/UsageOverlay";
import { SessionsOverlay } from "./components/SessionsOverlay";
import {
  closeTerminalInScene,
  createTerminalInScene,
  updateTerminalCustomTitleInScene,
} from "./actions/terminalSceneActions";
import { useProjectStore, generateId } from "./stores/projectStore";
import { addScannedProjectAndFocus } from "./projects/projectCreation";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePinPreloader } from "./hooks/usePinPreloader";
import { useT } from "./i18n/useT";
import { loadAllDownloadedFonts } from "./terminal/fontLoader";
import { startAutoSummaryWatcher } from "./terminal/summaryScheduler";
import {
  shouldRunAutoSaveBackstop,
  useWorkspaceStore,
} from "./stores/workspaceStore";
import {
  readWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  snapshotState,
  type SkipRestoreSnapshot,
} from "./snapshotState";
import { updateWindowTitle } from "./titleHelper";
import { resolveTerminalWithRuntimeState } from "./stores/terminalRuntimeStateStore";
import { logSlowRendererPath } from "./utils/devPerf";
import { selectAllTerminalRuntime } from "./terminal/terminalRuntimeStore";
import { performContextualSelectAll } from "./utils/contextualSelectAll";

function isSkipRestoreSnapshot(
  snapshot: ReturnType<typeof readWorkspaceSnapshot>,
): snapshot is SkipRestoreSnapshot {
  return !!snapshot && "skipRestore" in snapshot;
}

function selectFocusedTerminalBuffer(): boolean {
  const { projects } = useProjectStore.getState();
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.focused) {
          return selectAllTerminalRuntime(terminal.id);
        }
      }
    }
  }

  return false;
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
      if (dirty && !window.confirm("Unsaved changes will be lost. Continue?")) {
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
        console.error(
          "[useWorkspaceOpen] failed to parse workspace file:",
          err,
        );
      }
    };
    window.addEventListener("termcanvas:open-workspace", handler);
    return () =>
      window.removeEventListener("termcanvas:open-workspace", handler);
  }, []);
}


export function App() {
  useWorktreeWatcher();
  usePinPreloader();
  useStatePersistence();
  useAutoSave();
  useWorkspaceOpen();
  useKeyboardShortcuts();
  const t = useT();
  const composerEnabled = usePreferencesStore((s) => s.composerEnabled);
  const globalSearchEnabled = usePreferencesStore((s) => s.globalSearchEnabled);
  const drawingEnabled = usePreferencesStore((s) => s.drawingEnabled);
  const summaryEnabled = usePreferencesStore((s) => s.summaryEnabled);
  const completionGlowEnabled = usePreferencesStore(
    (s) => s.completionGlowEnabled,
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
    void hydrateApiKey();
  }, []);
  useEffect(() => {
    if (!window.termcanvas?.sessions) return;
    return initSessionStoreIPC();
  }, []);

  useEffect(() => {
    if (!window.termcanvas?.menu) return;
    const removeOpenFolderListener = window.termcanvas.menu.onOpenFolder(
      async (dirPath: string) => {
        await addProjectFromDirectoryPath(dirPath, t);
      },
    );
    const removeSelectAllListener = window.termcanvas.menu.onSelectAll(() => {
      performContextualSelectAll(
        document.activeElement,
        selectFocusedTerminalBuffer,
      );
    });

    return () => {
      removeOpenFolderListener();
      removeSelectAllListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

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
                terminals: w.terminals.map((t: any) => {
                  const liveTerminal = resolveTerminalWithRuntimeState(t);
                  return {
                    id: liveTerminal.id,
                    title: liveTerminal.title,
                    customTitle: liveTerminal.customTitle,
                    starred: liveTerminal.starred,
                    type: liveTerminal.type,
                    status: liveTerminal.status,
                    ptyId: liveTerminal.ptyId,
                    width: liveTerminal.width,
                    height: liveTerminal.height,
                    parentTerminalId: liveTerminal.parentTerminalId,
                  };
                }),
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

      addTerminal: (
        projectId: string,
        worktreeId: string,
        type: string,
        prompt?: string,
        autoApprove?: boolean,
        parentTerminalId?: string | null,
      ) => {
        const terminal = createTerminalInScene({
          projectId,
          worktreeId,
          type: type as any,
          initialPrompt: prompt,
          autoApprove,
          origin: "agent",
          parentTerminalId: parentTerminalId ?? undefined,
        });
        return JSON.parse(JSON.stringify(terminal));
      },

      removeTerminal: (
        projectId: string,
        worktreeId: string,
        terminalId: string,
      ) => {
        closeTerminalInScene(projectId, worktreeId, terminalId);
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
            if (t) {
              const liveTerminal = resolveTerminalWithRuntimeState(t);
              return JSON.parse(
                JSON.stringify({
                  id: liveTerminal.id,
                  title: liveTerminal.title,
                  customTitle: liveTerminal.customTitle,
                  starred: liveTerminal.starred,
                  type: liveTerminal.type,
                  status: liveTerminal.status,
                  ptyId: liveTerminal.ptyId,
                  width: liveTerminal.width,
                  height: liveTerminal.height,
                  parentTerminalId: liveTerminal.parentTerminalId,
                  projectId: p.id,
                  worktreeId: w.id,
                  worktreePath: w.path,
                }),
              );
            }
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
              updateTerminalCustomTitleInScene(
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
      {/* Hub (focus-level switcher) hidden until the underlying level
          cycling is reworked — it currently overlaps the new worktree
          label HUD in the canvas top-left. Re-enable when ready. */}
      {/* <Hub /> */}
      <LeftPanel />
      <RightPanel />
      <CanvasRoot />
      <BottomToolbar />
      {drawingEnabled && <DrawingPanel />}
      {completionGlowEnabled && <CompletionGlow />}
      <ShortcutHints />
      {composerEnabled && <ComposerBar />}
      <NotificationToast />
      {globalSearchEnabled && <SearchModal />}
      <UsageOverlay />
      <SessionsOverlay />
      <FileEditorDrawer />
      <PinDetailDrawer />
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
