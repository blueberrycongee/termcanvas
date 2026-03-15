import { useCallback } from "react";
import { useProjectStore, generateId } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useT } from "../i18n/useT";
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";
import type { TerminalStatus, TerminalType } from "../types";

const STATUS_COLOR: Record<TerminalStatus, string> = {
  running: "#50e3c2",
  success: "#50e3c2",
  error: "#ee0000",
  idle: "#444",
};

const TYPE_LABEL: Record<TerminalType, string> = {
  shell: "Shell",
  claude: "Claude",
  codex: "Codex",
  kimi: "Kimi",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export function Sidebar() {
  const { projects, addProject } = useProjectStore();
  const {
    viewport,
    animateTo,
    sidebarCollapsed: collapsed,
    setSidebarCollapsed: setCollapsed,
  } = useCanvasStore();
  const { notify } = useNotificationStore();
  const t = useT();

  const STATUS_LABEL: Record<TerminalStatus, string> = {
    running: t.status_running,
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
    addProject({
      id: generateId(),
      name: info.name,
      path: info.path,
      position: { x: 100 - viewport.x, y: 100 - viewport.y },
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
  }, [addProject, viewport, notify, t]);

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
        const wtSize = computeWorktreeSize(wt.terminals.length);
        maxW = Math.max(maxW, wt.position.x + wtSize.w);
        totalH = Math.max(totalH, wt.position.y + wtSize.h);
      }
      const projW = Math.max(340, maxW + PROJ_PAD * 2);
      const projH = Math.max(
        PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD,
        PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD,
      );

      const padding = 80;
      const toolbarH = 44;
      const viewW = window.innerWidth - padding * 2;
      const viewH = window.innerHeight - toolbarH - padding * 2;
      const scale = Math.min(1, viewW / projW, viewH / projH);

      const centerX =
        -(project.position.x + projW / 2) * scale + window.innerWidth / 2;
      const centerY =
        -(project.position.y + projH / 2) * scale +
        (window.innerHeight + toolbarH) / 2;

      animateTo(centerX, centerY, scale);
    },
    [projects, animateTo],
  );

  return (
    <div className="fixed left-0 z-40 flex" style={{ top: 44 }}>
      <div
        className="flex flex-col bg-[var(--bg)] transition-[width] duration-200 overflow-hidden"
        style={{
          width: collapsed ? 0 : 200,
          height: "calc(100vh - 44px)",
        }}
      >
        <div className="px-3 py-2 shrink-0 flex flex-col gap-1.5">
          <span
            className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider px-1"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.projects}
          </span>
          <div className="flex gap-1">
            <button
              className="flex-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150 border border-[var(--border)]"
              onClick={handleAddProject}
            >
              {t.add}
            </button>
            <button
              className="flex-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150 border border-[var(--border)]"
              onClick={handleOpenWorkspace}
            >
              {t.open}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {projects.map((project) => {
            const terminals = project.worktrees.flatMap((wt) => wt.terminals);
            return (
              <div key={project.id} className="mb-2">
                <button
                  className="group w-full text-left px-4 py-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150 truncate relative"
                  onClick={() => handleFocus(project.id)}
                >
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-[#0070f3] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
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
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${terminal.status === "running" || terminal.status === "idle" ? "status-pulse" : ""}`}
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

      {/* Toggle */}
      <button
        className="self-start mt-2 ml-1 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150"
        onClick={() => setCollapsed(!collapsed)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
        >
          <path
            d="M5 3L9 7L5 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
