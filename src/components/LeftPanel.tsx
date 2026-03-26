import { useMemo, useRef, useCallback, useState } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useT } from "../i18n/useT";
import { useNotificationStore } from "../stores/notificationStore";
import { FilesContent } from "./LeftPanel/FilesContent";
import { DiffContent } from "./LeftPanel/DiffContent";
import { PreviewContent } from "./LeftPanel/PreviewContent";

export function LeftPanel() {
  const t = useT();
  const collapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const width = useCanvasStore((s) => s.leftPanelWidth);
  const activeTab = useCanvasStore((s) => s.leftPanelActiveTab);
  const previewFile = useCanvasStore((s) => s.leftPanelPreviewFile);
  const setCollapsed = useCanvasStore((s) => s.setLeftPanelCollapsed);
  const setWidth = useCanvasStore((s) => s.setLeftPanelWidth);
  const setActiveTab = useCanvasStore((s) => s.setLeftPanelActiveTab);
  const setPreviewFile = useCanvasStore((s) => s.setLeftPanelPreviewFile);
  const notify = useNotificationStore((s) => s.notify);

  const focusedWorktreeId = useProjectStore((s) => s.focusedWorktreeId);
  const projects = useProjectStore((s) => s.projects);
  const [hydraEnabling, setHydraEnabling] = useState(false);

  const focusedProject = useMemo(() => {
    if (!focusedWorktreeId) return null;
    for (const p of projects) {
      const wt = p.worktrees.find((w) => w.id === focusedWorktreeId);
      if (wt) return p;
    }
    return null;
  }, [focusedWorktreeId, projects]);

  const worktreePath = useMemo(() => {
    if (!focusedWorktreeId) return null;
    for (const p of projects) {
      const wt = p.worktrees.find((w) => w.id === focusedWorktreeId);
      if (wt) return wt.path;
    }
    return null;
  }, [focusedWorktreeId, projects]);

  const resizeRef = useRef<{ startX: number; origW: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, origW: width };
      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const newWidth = Math.max(200, Math.min(600, resizeRef.current.origW + (ev.clientX - resizeRef.current.startX)));
        setWidth(newWidth);
      };
      const handleUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [width, setWidth]
  );

  const handleFileClick = useCallback(
    (filePath: string) => {
      setPreviewFile(filePath);
      setActiveTab("preview");
    },
    [setPreviewFile, setActiveTab]
  );

  const handlePreviewClose = useCallback(() => {
    setPreviewFile(null);
    setActiveTab("files");
  }, [setPreviewFile, setActiveTab]);

  const handleEnableHydra = useCallback(async () => {
    if (!focusedProject) {
      notify("warn", t.hydra_enable_missing_target);
      return;
    }

    setHydraEnabling(true);
    try {
      const result = await window.termcanvas.project.enableHydra(focusedProject.path);
      if (!result.ok) {
        notify("error", t.hydra_enable_failed(result.error));
        return;
      }

      notify(
        "info",
        result.changed
          ? t.hydra_enable_success(focusedProject.name)
          : t.hydra_enable_already_current(focusedProject.name),
      );
    } catch (error) {
      notify("error", t.hydra_enable_failed(String(error)));
    } finally {
      setHydraEnabling(false);
    }
  }, [focusedProject, notify, t]);

  if (collapsed) {
    return (
      <button
        className="fixed left-0 z-40 bg-[var(--surface)] border-r border-[var(--border)] flex items-center justify-center hover:bg-[var(--surface-hover)] transition-colors duration-150"
        style={{ top: 44, height: "calc(100vh - 44px)", width: COLLAPSED_TAB_WIDTH }}
        onClick={() => setCollapsed(false)}
      >
        <span className="text-[var(--text-muted)] text-[11px] transform -rotate-90 whitespace-nowrap" style={{ fontFamily: '"Geist Mono", monospace' }}>
          {t.left_panel_files}
        </span>
      </button>
    );
  }

  return (
    <div
      className="fixed left-0 z-40 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col"
      style={{ top: 44, height: "calc(100vh - 44px)", width, transition: "width 0.2s ease" }}
    >
      {/* Header */}
      <div className="flex items-center border-b border-[var(--border)] shrink-0" style={{ height: 40 }}>
        <button
          className={`flex-1 text-[11px] py-2 transition-colors duration-150 ${activeTab === "files" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={() => setActiveTab("files")}
        >
          {t.left_panel_files}
        </button>
        <button
          className={`flex-1 text-[11px] py-2 transition-colors duration-150 ${activeTab === "diff" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={() => setActiveTab("diff")}
        >
          {t.left_panel_diff}
        </button>
        <button
          className={`flex-1 text-[11px] py-2 transition-colors duration-150 ${activeTab === "preview" ? "text-[var(--accent)] border-b-2 border-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={() => setActiveTab("preview")}
        >
          {t.left_panel_preview}
        </button>
        {focusedProject && (
          <button
            className="mx-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150 disabled:cursor-default disabled:opacity-60"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            onClick={handleEnableHydra}
            disabled={hydraEnabling}
            title={focusedProject.path}
          >
            {hydraEnabling ? t.left_panel_enable_hydra_busy : t.left_panel_enable_hydra}
          </button>
        )}
        <button
          className="px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150"
          onClick={() => setCollapsed(true)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Content */}
      {activeTab === "files" && <FilesContent worktreePath={worktreePath} onFileClick={handleFileClick} />}
      {activeTab === "diff" && <DiffContent worktreePath={worktreePath} />}
      {activeTab === "preview" && <PreviewContent filePath={previewFile} onClose={handlePreviewClose} />}

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-[var(--accent)] hover:opacity-50 transition-opacity duration-150"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
