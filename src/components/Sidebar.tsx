import { useState, useCallback } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import type { TerminalStatus, TerminalType } from "../types";

const STATUS_CONFIG: Record<
  TerminalStatus,
  { color: string; label: string; pulse: boolean }
> = {
  running: { color: "#50e3c2", label: "Running", pulse: true },
  success: { color: "#50e3c2", label: "Done", pulse: false },
  error: { color: "#ee0000", label: "Error", pulse: false },
  idle: { color: "#666", label: "Starting", pulse: true },
};

const TYPE_LABEL: Record<TerminalType, string> = {
  shell: "Shell",
  claude: "Claude",
  codex: "Codex",
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
      {/* Sidebar panel */}
      <div
        className="h-full flex flex-col border-r border-[#333] bg-[#0a0a0a] transition-[width] duration-200 overflow-hidden"
        style={{
          width: collapsed ? 0 : 220,
          height: "calc(100vh - 44px)",
        }}
      >
        <div className="px-3 py-2.5 border-b border-[#333] shrink-0">
          <span
            className="text-[11px] font-medium text-[#666] uppercase tracking-wider"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            Projects
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {projects.map((project) => {
            const terminals = project.worktrees.flatMap((wt) => wt.terminals);
            return (
              <div key={project.id} className="mb-1">
                <button
                  className="w-full text-left px-3 py-2 text-[13px] text-[#888] hover:text-[#ededed] hover:bg-[#111] transition-colors truncate"
                  onClick={() => handleFocus(project.id)}
                >
                  {project.name}
                </button>
                {terminals.length > 0 && (
                  <div className="px-3 pb-1 flex flex-col gap-0.5">
                    {terminals.map((t) => {
                      const status = STATUS_CONFIG[t.status];
                      return (
                        <div
                          key={t.id}
                          className="flex items-center gap-2 py-0.5"
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.pulse ? "status-pulse" : ""}`}
                            style={{ backgroundColor: status.color }}
                          />
                          <span
                            className="text-[11px] text-[#555] truncate"
                            style={{
                              fontFamily: '"Geist Mono", monospace',
                            }}
                          >
                            {TYPE_LABEL[t.type]}
                          </span>
                          <span className="text-[10px] text-[#444] ml-auto shrink-0">
                            {status.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {projects.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-[#444]">No projects</div>
          )}
        </div>
      </div>

      {/* Toggle button */}
      <button
        className="self-start mt-2 ml-1 p-1.5 rounded-md text-[#666] hover:text-[#ededed] hover:bg-[#111] transition-colors border border-[#333] bg-[#0a0a0a]"
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
