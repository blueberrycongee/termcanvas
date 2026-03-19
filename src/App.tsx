import { useEffect, useState, useCallback } from "react";
import { Canvas } from "./canvas/Canvas";
import { Toolbar } from "./toolbar/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { NotificationToast } from "./components/NotificationToast";
import { initUpdaterListeners } from "./stores/updaterStore";
import { ComposerBar } from "./components/ComposerBar";
import { DrawingPanel } from "./toolbar/DrawingPanel";
import { ShortcutHints } from "./components/ShortcutHints";
import { CompletionGlow } from "./components/CompletionGlow";
import { UsagePanel } from "./components/UsagePanel";
import { WelcomePopup } from "./components/WelcomePopup";
import { useProjectStore, createTerminal } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { useBrowserCardStore } from "./stores/browserCardStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { serializeAllTerminals } from "./terminal/terminalRegistry";
import { useT } from "./i18n/useT";
import type { ProjectData } from "./types";

function migrateProjects(projects: unknown[]): ProjectData[] {
  return projects.map((p: any) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    position: p.position ?? { x: 0, y: 0 },
    collapsed: p.collapsed ?? false,
    zIndex: p.zIndex ?? 0,
    worktrees: (p.worktrees ?? []).map((wt: any) => ({
      id: wt.id,
      name: wt.name,
      path: wt.path,
      position: wt.position ?? { x: 0, y: 0 },
      collapsed: wt.collapsed ?? false,
      terminals: (wt.terminals ?? []).map((t: any) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        minimized: t.minimized ?? false,
        focused: t.focused ?? false,
        ptyId: null,
        status: "idle",
        span: t.span ?? { cols: 1, rows: 1 },
        scrollback: t.scrollback,
        sessionId: t.sessionId,
        parentTerminalId: t.parentTerminalId,
      })),
    })),
  }));
}

function snapshotState(): string {
  const scrollbacks = serializeAllTerminals();
  const projects = useProjectStore.getState().projects.map((p) => ({
    ...p,
    worktrees: p.worktrees.map((wt) => ({
      ...wt,
      terminals: wt.terminals.map((t) => {
        console.log(`[snapshot] terminal=${t.id} type=${t.type} sessionId=${t.sessionId ?? "NONE"} ptyId=${t.ptyId}`);
        return {
          ...t,
          scrollback: scrollbacks[t.id] ?? t.scrollback ?? undefined,
          ptyId: null,
        };
      }),
    })),
  }));

  return JSON.stringify(
    {
      version: 1,
      viewport: useCanvasStore.getState().viewport,
      projects,
      drawings: useDrawingStore.getState().elements,
      browserCards: useBrowserCardStore.getState().cards,
    },
    null,
    2,
  );
}

function restoreFromData(data: Record<string, unknown>) {
  try {
    if (data.viewport) {
      useCanvasStore
        .getState()
        .setViewport(data.viewport as { x: number; y: number; scale: number });
    }
    if (data.projects && Array.isArray(data.projects)) {
      useProjectStore.getState().setProjects(migrateProjects(data.projects));
    }
    if (data.drawings && Array.isArray(data.drawings)) {
      useDrawingStore.setState({
        elements: data.drawings as ReturnType<
          typeof useDrawingStore.getState
        >["elements"],
      });
    }
    if (data.browserCards && typeof data.browserCards === "object") {
      useBrowserCardStore.setState({
        cards: data.browserCards as Record<string, import("./stores/browserCardStore").BrowserCardData>,
      });
    }
  } catch (err) {
    console.error("[restoreFromData] failed to restore state:", err);
  }
}

function useWorktreeWatcher() {
  const { projects, syncWorktrees } = useProjectStore();

  useEffect(() => {
    if (!window.termcanvas || projects.length === 0) return;

    const rescanAll = () => {
      for (const p of projects) {
        window.termcanvas.project
          .rescanWorktrees(p.path)
          .then((worktrees) => syncWorktrees(p.path, worktrees));
      }
    };

    // Initial sync
    rescanAll();
    // Poll every 5s — simple, reliable, cross-platform
    const interval = setInterval(rescanAll, 5000);
    // Immediate rescan on window focus
    window.addEventListener("focus", rescanAll);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", rescanAll);
    };
  }, [projects.length]);
}

function useStatePersistence() {
  // Load saved state on mount
  useEffect(() => {
    if (!window.termcanvas) return;
    window.termcanvas.state.load().then((saved) => {
      if (saved) restoreFromData(saved as unknown as Record<string, unknown>);
    }).catch((err) => {
      console.error("[useStatePersistence] failed to load state:", err);
    });
  }, []);
}

function useWorkspaceOpen() {
  useEffect(() => {
    const handler = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      try {
        restoreFromData(JSON.parse(raw));
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

  useEffect(() => {
    if (!window.termcanvas) return;

    const unsubscribe = window.termcanvas.app.onBeforeClose(() => {
      setShowCloseDialog(true);
    });

    return unsubscribe;
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const data = snapshotState();
      const saved = await window.termcanvas.workspace.save(data);
      if (saved) {
        // Also save to auto-restore location
        window.termcanvas.state.save(JSON.parse(data));
        window.termcanvas.app.confirmClose();
      } else {
        // User cancelled the save dialog, stay open
        setShowCloseDialog(false);
      }
    } catch (err) {
      console.error("[CloseHandler] save failed, forcing close:", err);
      window.termcanvas.app.confirmClose();
    }
  }, []);

  const handleDiscard = useCallback(() => {
    // Clear the auto-restore state
    window.termcanvas.state.save({
      viewport: { x: 0, y: 0, scale: 1 },
      projects: [],
    });
    window.termcanvas.app.confirmClose();
  }, []);

  const handleCancel = useCallback(() => {
    setShowCloseDialog(false);
  }, []);

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
            className="px-3 py-1.5 rounded-md text-[13px] text-[#ee0000] hover:bg-[#220000] transition-colors duration-150"
            onClick={onDiscard}
          >
            {t.dont_save}
          </button>
          <button
            className="px-3 py-1.5 rounded-md text-[13px] text-[var(--text-primary)] bg-[#0070f3] hover:bg-[#005cc5] transition-colors duration-150"
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
  useWorkspaceOpen();
  useKeyboardShortcuts();
  const { showCloseDialog, handleSave, handleDiscard, handleCancel } =
    useCloseHandler();

  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem("termcanvas-welcome-seen");
  });

  // Wire IPC updater events into the zustand store (once)
  useEffect(() => initUpdaterListeners(), []);

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
    };

    (window as any).__tcApi = api;
    return () => {
      delete (window as any).__tcApi;
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]">
      <Toolbar />
      <Sidebar />
      <Canvas />
      <DrawingPanel />
      <CompletionGlow />
      <ShortcutHints />
      <UsagePanel />
      <ComposerBar />
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
