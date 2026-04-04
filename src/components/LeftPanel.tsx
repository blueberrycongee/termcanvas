import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useT } from "../i18n/useT";
import { useNotificationStore } from "../stores/notificationStore";
import { FilesContent } from "./LeftPanel/FilesContent";
import { DiffContent } from "./LeftPanel/DiffContent";
import { GitContent } from "./LeftPanel/GitContent";
import { PreviewContent } from "./LeftPanel/PreviewContent";
import { MemoryContent } from "./LeftPanel/MemoryContent";
import { HydraSetupPopup } from "./HydraSetupPopup";
import { panToTerminal } from "../utils/panToTerminal";
import { useSidebarDragStore } from "../stores/sidebarDragStore";
import type { LeftPanelTab } from "../stores/canvasStore";
import {
  resolveRepoContext,
  type RepoContextOption,
} from "./LeftPanel/repoContext";

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

function IconMemory({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="6" r="3.5" />
      <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" />
      <circle cx="8" cy="6" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const TAB_CONFIG: { id: LeftPanelTab; icon: typeof IconFiles; labelKey: "left_panel_files" | "left_panel_diff" | "left_panel_git" | "left_panel_memory" }[] = [
  { id: "files", icon: IconFiles, labelKey: "left_panel_files" },
  { id: "diff", icon: IconDiff, labelKey: "left_panel_diff" },
  { id: "git", icon: IconGit, labelKey: "left_panel_git" },
  { id: "memory", icon: IconMemory, labelKey: "left_panel_memory" },
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
  const [directoryIsGitRepo, setDirectoryIsGitRepo] = useState(false);
  const [childRepos, setChildRepos] = useState<RepoContextOption[]>([]);
  const [selectedChildRepoPath, setSelectedChildRepoPath] = useState<string | null>(null);
  const checkedProjectRef = useRef<Set<string>>(new Set());
  const dismissedHydraRef = useRef<Set<string>>(new Set());
  const preferredRepoPathRef = useRef<Map<string, string>>(new Map());

  // Re-center the focused terminal when the left panel opens/closes
  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsedRef.current === collapsed) return;
    prevCollapsedRef.current = collapsed;
    const tid = projects
      .flatMap((p) => p.worktrees)
      .flatMap((w) => w.terminals)
      .find((t) => t.focused)?.id;
    if (tid) panToTerminal(tid);
  }, [collapsed, projects]);

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
  const repoScopedTabs = activeTab === "diff" || activeTab === "git" || activeTab === "memory";

  useEffect(() => {
    if (!effectiveWorktreePath || !window.termcanvas) {
      setDirectoryIsGitRepo(false);
      setChildRepos([]);
      setSelectedChildRepoPath(null);
      return;
    }

    let cancelled = false;
    const preferredRepoPath =
      preferredRepoPathRef.current.get(effectiveWorktreePath) ?? null;

    Promise.all([
      window.termcanvas.git.isRepo(effectiveWorktreePath),
      window.termcanvas.project.listChildGitRepos(effectiveWorktreePath),
    ])
      .then(([isGitRepo, repos]) => {
        if (cancelled) return;
        setDirectoryIsGitRepo(isGitRepo);
        setChildRepos(repos);

        const resolution = resolveRepoContext({
          childRepos: repos,
          directoryIsGitRepo: isGitRepo,
          directoryPath: effectiveWorktreePath,
          preferredRepoPath,
        });
        setSelectedChildRepoPath(resolution.selectedRepoPath);
      })
      .catch(() => {
        if (cancelled) return;
        setDirectoryIsGitRepo(false);
        setChildRepos([]);
        setSelectedChildRepoPath(null);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveWorktreePath]);

  const repoContext = useMemo(
    () =>
      resolveRepoContext({
        childRepos,
        directoryIsGitRepo,
        directoryPath: effectiveWorktreePath,
        preferredRepoPath: selectedChildRepoPath,
      }),
    [childRepos, directoryIsGitRepo, effectiveWorktreePath, selectedChildRepoPath],
  );
  const repoContextPath = repoScopedTabs
    ? repoContext.targetPath
    : effectiveWorktreePath;

  const handleSelectChildRepo = useCallback(
    (repoPath: string) => {
      if (!effectiveWorktreePath) return;
      preferredRepoPathRef.current.set(effectiveWorktreePath, repoPath);
      setSelectedChildRepoPath(repoPath);
    },
    [effectiveWorktreePath],
  );

  // Check Hydra toolchain status when a project comes into focus.
  useEffect(() => {
    if (!focusedProject || !window.termcanvas?.project?.checkHydra) return;
    if (checkedProjectRef.current.has(focusedProject.path)) return;
    if (dismissedHydraRef.current.has(focusedProject.path)) return;
    checkedProjectRef.current.add(focusedProject.path);

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
      const pid = e.pointerId;
      handle.setPointerCapture(pid);
      const startX = e.clientX;
      const origW = width;
      useSidebarDragStore.getState().setActive(true);
      const handleMove = (ev: PointerEvent) => {
        setWidth(Math.max(200, Math.min(600, origW + (ev.clientX - startX))));
      };
      const cleanup = () => {
        handle.removeEventListener("pointermove", handleMove);
        handle.removeEventListener("pointerup", cleanup);
        handle.removeEventListener("pointercancel", cleanup);
        handle.removeEventListener("lostpointercapture", cleanup);
        try { handle.releasePointerCapture(pid); } catch {}
        useSidebarDragStore.getState().setActive(false);
        const tid = useProjectStore.getState().projects
          .flatMap((p) => p.worktrees)
          .flatMap((w) => w.terminals)
          .find((t) => t.focused)?.id;
        if (tid) panToTerminal(tid, { immediate: true });
      };
      handle.addEventListener("pointermove", handleMove);
      handle.addEventListener("pointerup", cleanup);
      handle.addEventListener("pointercancel", cleanup);
      handle.addEventListener("lostpointercapture", cleanup);
    },
    [width, setWidth]
  );

  const prevTabRef = useRef<LeftPanelTab>("files");

  const handleFileClick = useCallback(
    (filePath: string) => {
      if (activeTab !== "preview") prevTabRef.current = activeTab;
      setPreviewFile(filePath);
      setActiveTab("preview");
    },
    [activeTab, setPreviewFile, setActiveTab]
  );

  const handlePreviewClose = useCallback(() => {
    setPreviewFile(null);
    setActiveTab(prevTabRef.current);
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

  const hydraPopup = hydraStatus && focusedProject ? (
    <HydraSetupPopup
      status={hydraStatus}
      projectName={focusedProject.name}
      onEnable={handleHydraBannerAction}
      onDismiss={() => setHydraStatus(null)}
      onDismissForever={() => {
        if (focusedProject) dismissedHydraRef.current.add(focusedProject.path);
        setHydraStatus(null);
      }}
    />
  ) : null;

  // ── Collapsed state: vertical icon strip ──
  if (collapsed) {
    return (
      <>
        {hydraPopup}
        <div
          className="fixed left-0 z-40 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col items-center pt-3 gap-1 cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors duration-150"
          style={{ top: 44, height: "calc(100vh - 44px)", width: COLLAPSED_TAB_WIDTH }}
          onClick={() => setCollapsed(false)}
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer.types).includes("Files")) return;
            e.preventDefault();
            setActiveTab("files");
            setCollapsed(false);
          }}
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
      </>
    );
  }

  return (
    <>
    {hydraPopup}
    <div
      className="fixed left-0 z-40 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col"
      style={{ top: 44, height: "calc(100vh - 44px)", width }}
    >
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
                {width > 260 && <span>{t[labelKey]}</span>}
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
        {repoScopedTabs && repoContext.selectorKind !== "none" && (
          <div className="shrink-0 px-2 pb-1.5">
            <div className="rounded-lg bg-[var(--bg)] px-2 py-2">
              <div
                className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {t.left_panel_repo}
              </div>
              {repoContext.selectorKind === "single" ? (
                <div
                  className="mt-1.5 truncate rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)]"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                  title={childRepos[0]?.name}
                >
                  {childRepos[0]?.name}
                </div>
              ) : repoContext.selectorKind === "inline" ? (
                <div className="mt-1.5 flex items-center gap-1 rounded-md bg-[var(--surface)] p-1">
                  {childRepos.map((repo) => {
                    const isActive = repo.path === repoContext.targetPath;
                    return (
                      <button
                        key={repo.path}
                        className={`min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-[11px] transition-all duration-150 ${
                          isActive
                            ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                        style={{ fontFamily: '"Geist Mono", monospace' }}
                        onClick={() => handleSelectChildRepo(repo.path)}
                        title={repo.name}
                      >
                        <span className="block truncate">{repo.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="relative mt-1.5">
                  <select
                    className="w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 pr-8 text-[11px] text-[var(--text-primary)] outline-none transition-colors duration-150 hover:border-[var(--border-hover)] focus:border-[var(--accent)]"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                    value={repoContext.targetPath ?? ""}
                    onChange={(event) => handleSelectChildRepo(event.target.value)}
                    aria-label={t.left_panel_repo}
                  >
                    {childRepos.map((repo) => (
                      <option key={repo.path} value={repo.path}>
                        {repo.name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[var(--text-faint)]">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M2.2 3.5L5 6.3L7.8 3.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === "files" && <FilesContent worktreePath={effectiveWorktreePath} onFileClick={handleFileClick} />}
        {activeTab === "diff" && <DiffContent worktreePath={repoContextPath} />}
        {activeTab === "preview" && <PreviewContent filePath={previewFile} onClose={handlePreviewClose} onNavigate={handleFileClick} />}
        {activeTab === "git" && (
          <GitContent
            worktreePath={repoContextPath}
            onEnableHydra={focusedProject ? handleEnableHydra : undefined}
            hydraEnabling={hydraEnabling}
          />
        )}
        {activeTab === "memory" && (
          <MemoryContent worktreePath={repoContextPath} onFileClick={handleFileClick} />
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
    </>
  );
}
