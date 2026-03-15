import { useEffect, useState, useCallback } from "react";
import { Canvas } from "./canvas/Canvas";
import { Toolbar } from "./toolbar/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { NotificationToast } from "./components/NotificationToast";
import { useProjectStore } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { serializeAllTerminals } from "./terminal/terminalRegistry";

function snapshotState(): string {
  const scrollbacks = serializeAllTerminals();
  const projects = useProjectStore.getState().projects.map((p) => ({
    ...p,
    worktrees: p.worktrees.map((wt) => ({
      ...wt,
      terminals: wt.terminals.map((t) => ({
        ...t,
        scrollback: scrollbacks[t.id] ?? t.scrollback ?? undefined,
        ptyId: null,
      })),
    })),
  }));

  return JSON.stringify(
    {
      version: 1,
      viewport: useCanvasStore.getState().viewport,
      projects,
      drawings: useDrawingStore.getState().elements,
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
      useProjectStore.getState().setProjects(data.projects);
    }
    if (data.drawings && Array.isArray(data.drawings)) {
      useDrawingStore.setState({
        elements: data.drawings as ReturnType<
          typeof useDrawingStore.getState
        >["elements"],
      });
    }
  } catch {
    // Invalid data, ignore
  }
}

function useWorktreeWatcher() {
  const { projects, syncWorktrees } = useProjectStore();

  useEffect(() => {
    if (!window.termcanvas) return;

    for (const p of projects) {
      window.termcanvas.project.watch(p.path);
    }

    const unsubscribe = window.termcanvas.project.onWorktreesChanged(
      (dirPath, worktrees) => {
        syncWorktrees(dirPath, worktrees);
      },
    );

    return () => {
      unsubscribe();
      for (const p of projects) {
        window.termcanvas.project.unwatch(p.path);
      }
    };
  }, [projects.length]);
}

function useStatePersistence() {
  // Load saved state on mount
  useEffect(() => {
    if (!window.termcanvas) return;
    window.termcanvas.state.load().then((saved) => {
      if (saved) restoreFromData(saved as unknown as Record<string, unknown>);
    });
  }, []);
}

function useWorkspaceOpen() {
  useEffect(() => {
    const handler = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      try {
        restoreFromData(JSON.parse(raw));
      } catch {
        // Invalid workspace file
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
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-[#111] border border-[#222] rounded-lg p-6 max-w-sm w-full mx-4">
        <h2 className="text-[15px] font-medium text-[#ededed] mb-2">
          Save workspace?
        </h2>
        <p className="text-[13px] text-[#888] mb-6">
          Save your projects, terminals, and drawings to a file so you can
          restore them later.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            className="px-3 py-1.5 rounded-md text-[13px] text-[#888] hover:text-[#ededed] hover:bg-[#222] transition-colors duration-150"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 rounded-md text-[13px] text-[#ee0000] hover:bg-[#220000] transition-colors duration-150"
            onClick={onDiscard}
          >
            Don't Save
          </button>
          <button
            className="px-3 py-1.5 rounded-md text-[13px] text-[#ededed] bg-[#0070f3] hover:bg-[#005cc5] transition-colors duration-150"
            onClick={onSave}
          >
            Save
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
  const { showCloseDialog, handleSave, handleDiscard, handleCancel } =
    useCloseHandler();

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0a0a] text-[#ededed]">
      <Toolbar />
      <Sidebar />
      <Canvas />
      <NotificationToast />
      {showCloseDialog && (
        <CloseDialog
          onSave={handleSave}
          onDiscard={handleDiscard}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
