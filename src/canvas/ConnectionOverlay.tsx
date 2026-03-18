import { useMemo, useState, useEffect } from "react";
import type { ProjectData } from "../types";
import { useProjectStore, getChildTerminals, findTerminalById } from "../stores/projectStore";
import {
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
} from "../layout";

const TYPE_COLORS: Record<string, string> = {
  shell: "#888",
  claude: "#f5a623",
  codex: "#7928ca",
  kimi: "#0070f3",
  gemini: "#4285f4",
  opencode: "#50e3c2",
  lazygit: "#e84d31",
  tmux: "#1bb91f",
};

interface TerminalRect {
  cx: number;
  top: number;
  bottom: number;
}

function getTerminalAbsoluteRect(
  projects: ProjectData[],
  terminalId: string,
): TerminalRect | null {
  for (const p of projects) {
    if (p.collapsed) continue;
    for (const w of p.worktrees) {
      if (w.collapsed) continue;
      const index = w.terminals.findIndex((t) => t.id === terminalId);
      if (index === -1) continue;

      const packed = packTerminals(w.terminals.map((t) => t.span));
      const item = packed[index];
      if (!item) continue;

      const absX = p.position.x + PROJ_PAD + w.position.x + WT_PAD + item.x;
      const absY = p.position.y + PROJ_TITLE_H + PROJ_PAD + w.position.y + WT_TITLE_H + WT_PAD + item.y;

      return {
        cx: absX + item.w / 2,
        top: absY,
        bottom: absY + item.h,
      };
    }
  }
  return null;
}

interface Connection {
  parentId: string;
  childId: string;
  parentRect: TerminalRect;
  childRect: TerminalRect;
  color: string;
}

/** Collect the set of terminal IDs related to a hovered terminal (itself + parent + children) */
function getRelatedIds(projects: ProjectData[], terminalId: string): Set<string> {
  const ids = new Set<string>([terminalId]);
  const info = findTerminalById(projects, terminalId);
  if (info?.terminal.parentTerminalId) {
    ids.add(info.terminal.parentTerminalId);
  }
  for (const child of getChildTerminals(projects, terminalId)) {
    ids.add(child.terminal.id);
  }
  return ids;
}

export function ConnectionOverlay() {
  const projects = useProjectStore((s) => s.projects);
  const [hoveredTerminalId, setHoveredTerminalId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      setHoveredTerminalId((e as CustomEvent<string | null>).detail);
    };
    window.addEventListener("termcanvas:terminal-hover", handler);
    return () => window.removeEventListener("termcanvas:terminal-hover", handler);
  }, []);

  const connections = useMemo(() => {
    const result: Connection[] = [];

    for (const p of projects) {
      for (const w of p.worktrees) {
        for (const t of w.terminals) {
          if (!t.parentTerminalId) continue;

          const parentRect = getTerminalAbsoluteRect(projects, t.parentTerminalId);
          const childRect = getTerminalAbsoluteRect(projects, t.id);
          if (!parentRect || !childRect) {
            console.warn(`[ConnectionOverlay] missing rect for connection ${t.parentTerminalId} → ${t.id}`);
            continue;
          }

          const parentInfo = findTerminalById(projects, t.parentTerminalId);
          const color = parentInfo
            ? (TYPE_COLORS[parentInfo.terminal.type] ?? "#888")
            : "#888";

          result.push({
            parentId: t.parentTerminalId,
            childId: t.id,
            parentRect,
            childRect,
            color,
          });
        }
      }
    }

    return result;
  }, [projects]);

  const relatedIds = useMemo(() => {
    if (!hoveredTerminalId) return null;
    return getRelatedIds(projects, hoveredTerminalId);
  }, [projects, hoveredTerminalId]);

  if (connections.length === 0) return null;

  return (
    <svg
      className="absolute pointer-events-none"
      style={{ overflow: "visible", zIndex: -1, top: 0, left: 0, width: 1, height: 1 }}
    >
      <defs>
        <filter id="tc-conn-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {connections.map((conn) => {
        const isHighlighted = relatedIds !== null && (
          relatedIds.has(conn.parentId) || relatedIds.has(conn.childId)
        );
        const isAnyHovered = relatedIds !== null;

        const { parentRect, childRect } = conn;

        // Bezier from parent center-bottom to child center-top
        const x1 = parentRect.cx;
        const y1 = parentRect.bottom;
        const x2 = childRect.cx;
        const y2 = childRect.top;

        const dy = Math.abs(y2 - y1);
        const cpOffset = Math.max(60, dy * 0.4);

        const path = `M ${x1} ${y1} C ${x1} ${y1 + cpOffset}, ${x2} ${y2 - cpOffset}, ${x2} ${y2}`;

        const opacity = isHighlighted ? 0.8 : isAnyHovered ? 0.08 : 0.3;

        return (
          <g key={`${conn.parentId}-${conn.childId}`}>
            <path
              d={path}
              fill="none"
              stroke={conn.color}
              strokeWidth={isHighlighted ? 2 : 1.5}
              opacity={opacity}
              filter={isHighlighted ? "url(#tc-conn-glow)" : undefined}
              style={{ transition: "opacity 0.2s ease, stroke-width 0.2s ease" }}
            />
            {/* Arrow dot at child end */}
            <circle
              cx={x2}
              cy={y2}
              r={isHighlighted ? 4 : 3}
              fill={conn.color}
              opacity={opacity}
              style={{ transition: "opacity 0.2s ease" }}
            />
          </g>
        );
      })}
    </svg>
  );
}
