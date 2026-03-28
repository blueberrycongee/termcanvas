import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useT } from "../i18n/useT";
import { useNotificationStore } from "../stores/notificationStore";
import { FilesContent } from "./LeftPanel/FilesContent";
import { DiffContent } from "./LeftPanel/DiffContent";
import { GitContent } from "./LeftPanel/GitContent";
import { PreviewContent } from "./LeftPanel/PreviewContent";
import type { LeftPanelTab } from "../stores/canvasStore";

// ── Tab icon SVGs (14×14, matching the minimal aesthetic) ──

function IconFiles({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z" />
      <path d="M9 1.5v3.5h3.5" />
    </svg>
  );
}

function IconDiff({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M5 4h6M5 8h6M5 12h6" />
      <circle cx="3" cy="4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconPreview({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3.5h12v9H2z" />
      <path d="M2 6h12" />
    </svg>
  );
}

function IconGit({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="6.5" r="1.5" />
      <path d="M5 5v6M11 8v-0.5c0-1.5-1-2.5-3-2.5H5" />
    </svg>
  );
}

const TAB_CONFIG: { id: LeftPanelTab; icon: typeof IconFiles; labelKey: "left_panel_files" | "left_panel_diff" | "left_panel_git" }[] = [
  { id: "files", icon: IconFiles, labelKey: "left_panel_files" },
  { id: "diff", icon: IconDiff, labelKey: "left_panel_diff" },
  { id: "git", icon: IconGit, labelKey: "left_panel_git" },
];

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
  const [hydraStatus, setHydraStatus] = useState<"missing" | "outdated" | null>(null);
  const checkedProjectRef = useRef<string | null>(null);

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

  // Keep the last active worktree path so the left panel stays populated
  // when focus is cleared (e.g. clicking the canvas background).
  const lastWorktreePathRef = useRef<string | null>(null);
  if (worktreePath) {
    lastWorktreePathRef.current = worktreePath;
  }
  const effectiveWorktreePath = worktreePath ?? lastWorktreePathRef.current;

  // Check Hydra toolchain status when a project comes into focus.
  useEffect(() => {
    if (!focusedProject || !window.termcanvas?.project?.checkHydra) return;
    if (checkedProjectRef.current === focusedProject.path) return;
    checkedProjectRef.current = focusedProject.path;

    window.termcanvas.project.checkHydra(focusedProject.path).then((status) => {
      if (status === "outdated" || status === "missing") {
        setHydraStatus(status);
      } else {
        setHydraStatus(null);
      }
    }).catch(() => {});
  }, [focusedProject]);

  const handleHydraBannerAction = useCallback(async () => {
    if (!focusedProject || hydraEnabling) return;
    setHydraEnabling(true);
    try {
      const result = await window.termcanvas.project.enableHydra(focusedProject.path);
      setHydraStatus(null);
      if (!result.ok) {
        notify("error", t.hydra_enable_failed(result.error));
        return;
      }
      notify("info", t.hydra_enable_success(focusedProject.name));
    } catch (err: unknown) {
      notify("error", t.hydra_enable_failed(err instanceof Error ? err.message : String(err)));
    } finally {
      setHydraEnabling(false);
    }
  }, [focusedProject, hydraEnabling, notify, t]);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const origW = width;
      const handleMove = (ev: PointerEvent) => {
        setWidth(Math.max(200, Math.min(600, origW + (ev.clientX - startX))));
      };
      const handleUp = () => {
        handle.removeEventListener("pointermove", handleMove);
        handle.removeEventListener("pointerup", handleUp);
      };
      handle.addEventListener("pointermove", handleMove);
      handle.addEventListener("pointerup", handleUp);
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

  // ── Collapsed state: vertical icon strip ──
  if (collapsed) {
    return (
      <div
        className="fixed left-0 z-40 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col items-center pt-3 gap-1"
        style={{ top: 44, height: "calc(100vh - 44px)", width: COLLAPSED_TAB_WIDTH }}
      >
        {TAB_CONFIG.map(({ id, icon: Icon }) => (
          <button
            key={id}
            className={`flex items-center justify-center w-6 h-6 rounded-md transition-colors duration-150 ${
              activeTab === id
                ? "text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            title={t[`left_panel_${id}` as keyof typeof t] as string}
            onClick={() => {
              setActiveTab(id);
              setCollapsed(false);
            }}
          >
            <Icon size={14} />
          </button>
        ))}
        <div className="mt-auto mb-3">
          <button
            className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-150"
            onClick={() => setCollapsed(false)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed left-0 z-40 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col"
      style={{ top: 44, height: "calc(100vh - 44px)", width }}
    >
      {/* ── Hydra Toolchain Banner ── */}
      {hydraStatus && (
        <div className="shrink-0 px-2 pt-2">
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 bg-[var(--accent)]/10 border border-[var(--accent)]/20">
            <span className="text-[11px] text-[var(--accent)] flex-1 min-w-0 truncate">
              {hydraStatus === "outdated" ? t.hydra_outdated : t.hydra_missing}
            </span>
            <button
              className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              onClick={handleHydraBannerAction}
              disabled={hydraEnabling}
            >
              {hydraEnabling ? "..." : hydraStatus === "outdated" ? t.hydra_update : t.hydra_enable_action}
            </button>
          </div>
        </div>
      )}

      {/* ── Segmented Tab Bar ── */}
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-[var(--bg)] p-0.5">
          {TAB_CONFIG.map(({ id, icon: Icon, labelKey }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] transition-all duration-200 ${
                  isActive
                    ? "bg-[var(--surface-hover)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
                style={{ fontFamily: '"Geist Mono", monospace' }}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={13} />
                <span>{t[labelKey]}</span>
              </button>
            );
          })}
          <button
            className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-all duration-200 ml-0.5 shrink-0"
            onClick={() => setCollapsed(true)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "files" && <FilesContent worktreePath={effectiveWorktreePath} onFileClick={handleFileClick} />}
        {activeTab === "diff" && <DiffContent worktreePath={effectiveWorktreePath} />}
        {activeTab === "preview" && <PreviewContent filePath={previewFile} onClose={handlePreviewClose} />}
        {activeTab === "git" && (
          <GitContent
            worktreePath={effectiveWorktreePath}
            onEnableHydra={focusedProject ? handleEnableHydra : undefined}
            hydraEnabling={hydraEnabling}
          />
        )}
      </div>

      {/* ── Resize handle with visible rail ── */}
      <div
        className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize group/resize"
        onPointerDown={handleResizeStart}
      >
        <div className="absolute right-0 top-0 w-px h-full bg-[var(--border)] group-hover/resize:bg-[var(--accent)] group-hover/resize:opacity-70 transition-colors duration-150" />
      </div>
    </div>
  );
}
