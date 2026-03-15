import { useState, useCallback } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import type { TerminalStatus } from "../types";

const STATUS_COLOR: Record<TerminalStatus, string> = {
  running: "#50e3c2",
  success: "#666",
  error: "#ee0000",
  idle: "#444",
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

      // Fit project into viewport, cap at 1x to avoid over-zooming
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
              <div key={project.id}>
                <button
                  className="w-full text-left px-3 py-2 text-[13px] text-[#888] hover:text-[#ededed] hover:bg-[#111] transition-colors truncate"
                  onClick={() => handleFocus(project.id)}
                >
                  {project.name}
                </button>
                {terminals.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 pb-1.5">
                    {terminals.map((t) => (
                      <div
                        key={t.id}
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: STATUS_COLOR[t.status],
                          boxShadow:
                            t.status === "running"
                              ? `0 0 4px ${STATUS_COLOR.running}`
                              : undefined,
                        }}
                        title={`${t.title} — ${t.status}`}
                      />
                    ))}
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
