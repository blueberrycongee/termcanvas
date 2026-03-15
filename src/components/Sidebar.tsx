import { useState, useCallback } from "react";
import { useProjectStore, generateId } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useNotificationStore } from "../stores/notificationStore";
import type { TerminalStatus, TerminalType } from "../types";

const STATUS_COLOR: Record<TerminalStatus, string> = {
  running: "#50e3c2",
  success: "#50e3c2",
  error: "#ee0000",
  idle: "#444",
};

const STATUS_LABEL: Record<TerminalStatus, string> = {
  running: "Running",
  success: "Done",
  error: "Error",
  idle: "Starting",
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
  const [collapsed, setCollapsed] = useState(false);
  const { projects, addProject } = useProjectStore();
  const { viewport, animateTo } = useCanvasStore();
  const { notify } = useNotificationStore();

  const handleAddProject = useCallback(async () => {
    if (!window.termcanvas) return;
    let dirPath: string | null;
    try {
      dirPath = await window.termcanvas.project.selectDirectory();
    } catch (err) {
      notify("error", `Failed to open directory picker: ${err}`);
      return;
    }
    if (!dirPath) return;
    let info: Awaited<ReturnType<typeof window.termcanvas.project.scan>>;
    try {
      info = await window.termcanvas.project.scan(dirPath);
    } catch (err) {
      notify("error", `Failed to scan project: ${err}`);
      return;
    }
    if (!info) {
      notify("warn", `"${dirPath}" is not a git repository.`);
      return;
    }
    addProject({
      id: generateId(),
      name: info.name,
      path: info.path,
      position: { x: 100 - viewport.x, y: 100 - viewport.y },
      size: { w: 620, h: Math.max(200, info.worktrees.length * 160 + 60) },
      collapsed: false,
      zIndex: 0,
      worktrees: info.worktrees.map((wt, i) => ({
        id: generateId(),
        name: wt.branch,
        path: wt.path,
        position: { x: 0, y: i * 160 },
        size: { w: 580, h: 140 },
        collapsed: false,
        terminals: [],
      })),
    });
    notify(
      "info",
      `Added "${info.name}" with ${info.worktrees.length} worktree(s).`,
    );
  }, [addProject, viewport, notify]);

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

      const padding = 80;
      const toolbarH = 44;
      const projW = project.size.w || 620;
      const projH = project.size.h || 400;
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
            Projects
          </span>
          <div className="flex gap-1">
            <button
              className="flex-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150 border border-[var(--border)]"
              onClick={handleAddProject}
            >
              + Add
            </button>
            <button
              className="flex-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150 border border-[var(--border)]"
              onClick={handleOpenWorkspace}
            >
              Open
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
                    {terminals.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 py-1">
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.status === "running" || t.status === "idle" ? "status-pulse" : ""}`}
                          style={{ backgroundColor: STATUS_COLOR[t.status] }}
                        />
                        <span
                          className="text-[11px] text-[var(--text-muted)] truncate"
                          style={{ fontFamily: '"Geist Mono", monospace' }}
                        >
                          {TYPE_LABEL[t.type]}
                        </span>
                        <span className="text-[11px] text-[var(--text-faint)] ml-auto shrink-0">
                          {STATUS_LABEL[t.status]}
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
              No projects
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
