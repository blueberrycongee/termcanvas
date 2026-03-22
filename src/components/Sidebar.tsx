import { useCallback } from "react";
import { useProjectStore, generateId } from "../stores/projectStore";
import { useCanvasStore, SIDEBAR_WIDTH, RIGHT_PANEL_WIDTH, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useT } from "../i18n/useT";
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";
import type { TerminalStatus, TerminalType } from "../types";

const STATUS_COLOR: Record<TerminalStatus, string> = {
  running: "var(--cyan)",
  active: "var(--cyan)",
  waiting: "var(--amber)",
  completed: "var(--accent)",
  success: "var(--cyan)",
  error: "var(--red)",
  idle: "var(--text-muted)",
};

const TYPE_LABEL: Record<TerminalType, string> = {
  shell: "Shell",
  claude: "Claude",
  codex: "Codex",
  kimi: "Kimi",
  gemini: "Gemini",
  opencode: "OpenCode",
  lazygit: "lazygit",
  tmux: "Tmux",
};

const iconBtnClass =
  "w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--sidebar-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0";

export function Sidebar() {
  const { projects, addProject } = useProjectStore();
  const {
    animateTo,
    sidebarCollapsed: collapsed,
    setSidebarCollapsed: setCollapsed,
  } = useCanvasStore();
  const { notify } = useNotificationStore();
  const t = useT();

  const STATUS_LABEL: Record<TerminalStatus, string> = {
    running: t.status_running,
    active: t.status_active,
    waiting: t.status_waiting,
    completed: t.status_completed,
    success: t.status_done,
    error: t.status_error,
    idle: t.status_idle,
  };

  const handleAddProject = useCallback(async () => {
    if (!window.termcanvas) return;
    let dirPath: string | null;
    try {
      dirPath = await window.termcanvas.project.selectDirectory();
    } catch (err) {
      notify("error", t.error_dir_picker(err));
      return;
    }
    if (!dirPath) return;
    let info: Awaited<ReturnType<typeof window.termcanvas.project.scan>>;
    try {
      info = await window.termcanvas.project.scan(dirPath);
    } catch (err) {
      notify("error", t.error_scan(err));
      return;
    }
    if (!info) {
      notify("warn", t.error_not_git(dirPath));
      return;
    }
    // Place new project to the right of existing projects with a gap
    let placeX = 0;
    const gap = 80;
    for (const p of projects) {
      let maxW = 300;
      for (const wt of p.worktrees) {
        const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
        maxW = Math.max(maxW, wt.position.x + wtSize.w);
      }
      const projW = Math.max(340, maxW + PROJ_PAD * 2);
      placeX = Math.max(placeX, p.position.x + projW + gap);
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
    notify("info", t.info_added_project(info.name, info.worktrees.length));
  }, [addProject, projects, notify, t]);

  const handleOpenWorkspace = useCallback(async () => {
    if (!window.termcanvas) return;
    const data = await window.termcanvas.workspace.open();
    if (data) {
      window.dispatchEvent(
        new CustomEvent("termcanvas:open-workspace", { detail: data }),
      );
    }
  }, []);

  const handleFocus = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      let maxW = 300;
      let totalH = 0;
      for (const wt of project.worktrees) {
        const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
        maxW = Math.max(maxW, wt.position.x + wtSize.w);
        totalH = Math.max(totalH, wt.position.y + wtSize.h);
      }
      const projW = Math.max(340, maxW + PROJ_PAD * 2);
      const projH = Math.max(
        PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD,
        PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD,
      );

      const { rightPanelCollapsed } = useCanvasStore.getState();
      const rightOffset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
      const padding = 80;
      const toolbarH = 44;
      const viewW = window.innerWidth - rightOffset - padding * 2;
      const viewH = window.innerHeight - toolbarH - padding * 2;
      const scale = Math.min(1, viewW / projW, viewH / projH);

      const centerX =
        -(project.position.x + projW / 2) * scale + (window.innerWidth - rightOffset) / 2;
      const centerY =
        -(project.position.y + projH / 2) * scale +
        (window.innerHeight + toolbarH) / 2;

      animateTo(centerX, centerY, scale);
    },
    [projects, animateTo],
  );

  return (
    <div className="fixed left-0 z-40 flex" style={{ top: 44, height: "calc(100vh - 44px)" }}>
      {/* Expanded panel */}
      <div
        className="shrink-0 flex flex-col bg-[var(--sidebar)] overflow-hidden border-r border-[var(--border)]"
        style={{
          width: collapsed ? 0 : SIDEBAR_WIDTH,
          transition: "width 0.2s ease",
        }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border)]">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-[var(--text-muted)] shrink-0">
            <path
              d="M2 4C2 3.17 2.67 2.5 3.5 2.5H5.5L7 4H10.5C11.33 4 12 4.67 12 5.5V10C12 10.83 11.33 11.5 10.5 11.5H3.5C2.67 11.5 2 10.83 2 10V4Z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.projects}
          </span>
          <div className="flex-1" />
          <button className={iconBtnClass} onClick={handleAddProject} title={t.add}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 2V8M2 5H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <button className={iconBtnClass} onClick={handleOpenWorkspace} title={t.open}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 4.5V9.5C2 10.05 2.45 10.5 3 10.5H9C9.55 10.5 10 10.05 10 9.5V5.5C10 4.95 9.55 4.5 9 4.5H6L5 3H3C2.45 3 2 3.45 2 4V4.5Z"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button className={iconBtnClass} onClick={() => setCollapsed(true)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L3.5 5L6.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {projects.map((project) => {
            const terminals = project.worktrees.flatMap((wt) => wt.terminals);
            return (
              <div key={project.id} className="mb-2">
                <button
                  className="group w-full text-left px-4 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150 truncate relative"
                  onClick={() => handleFocus(project.id)}
                >
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
                  {project.name}
                </button>
                {terminals.length > 0 && (
                  <div className="px-4 flex flex-col gap-px">
                    {terminals.map((terminal) => (
                      <div
                        key={terminal.id}
                        className="flex items-center gap-2 py-1"
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${["running", "active", "waiting", "idle"].includes(terminal.status) ? "status-pulse" : ""}`}
                          style={{
                            backgroundColor: STATUS_COLOR[terminal.status],
                          }}
                        />
                        <span
                          className="text-[11px] text-[var(--text-muted)] truncate"
                          style={{ fontFamily: '"Geist Mono", monospace' }}
                        >
                          {TYPE_LABEL[terminal.type]}
                        </span>
                        <span className="text-[11px] text-[var(--text-faint)] ml-auto shrink-0">
                          {STATUS_LABEL[terminal.status]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {projects.length === 0 && (
            <div className="px-4 py-4 text-[11px] text-[var(--text-faint)]">
              {t.no_projects}
            </div>
          )}
        </div>
      </div>

      {/* Collapsed tab */}
      <button
        className="shrink-0 flex flex-col items-center pt-3 gap-2 bg-[var(--sidebar)] overflow-hidden border-r border-[var(--border)] hover:bg-[var(--sidebar-hover)] transition-[background-color] duration-150 cursor-pointer"
        style={{
          width: collapsed ? COLLAPSED_TAB_WIDTH : 0,
          transition: "width 0.2s ease, background-color 0.15s",
        }}
        onClick={() => setCollapsed(false)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[var(--text-muted)] shrink-0">
          <path
            d="M2 4C2 3.17 2.67 2.5 3.5 2.5H5.5L7 4H10.5C11.33 4 12 4.67 12 5.5V10C12 10.83 11.33 11.5 10.5 11.5H3.5C2.67 11.5 2 10.83 2 10V4Z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
        <span
          className="text-[9px] text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap"
          style={{ writingMode: "vertical-lr", fontFamily: '"Geist Mono", monospace' }}
        >
          {t.projects}
        </span>
      </button>
    </div>
  );
}
