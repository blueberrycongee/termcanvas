import { useState, useCallback } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
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
  const { projects } = useProjectStore();
  const { animateTo } = useCanvasStore();

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
        className="flex flex-col bg-[#0a0a0a] transition-[width] duration-200 overflow-hidden"
        style={{
          width: collapsed ? 0 : 200,
          height: "calc(100vh - 44px)",
        }}
      >
        <div className="px-4 py-3 shrink-0">
          <span
            className="text-[11px] font-medium text-[#444] uppercase tracking-wider"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            Projects
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {projects.map((project) => {
            const terminals = project.worktrees.flatMap((wt) => wt.terminals);
            return (
              <div key={project.id} className="mb-2">
                <button
                  className="group w-full text-left px-4 py-1.5 text-[13px] text-[#888] hover:text-[#ededed] transition-colors duration-150 truncate relative"
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
                          className="text-[11px] text-[#444] truncate"
                          style={{ fontFamily: '"Geist Mono", monospace' }}
                        >
                          {TYPE_LABEL[t.type]}
                        </span>
                        <span className="text-[11px] text-[#333] ml-auto shrink-0">
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
            <div className="px-4 py-4 text-[11px] text-[#333]">No projects</div>
          )}
        </div>
      </div>

      {/* Toggle */}
      <button
        className="self-start mt-2 ml-1 p-1.5 rounded-md text-[#444] hover:text-[#ededed] hover:bg-[#111] transition-colors duration-150"
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
