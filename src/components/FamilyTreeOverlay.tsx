import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { ProjectData, TerminalData } from "../types";
import { useProjectStore, findTerminalById, getChildTerminals } from "../stores/projectStore";
import {
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
} from "../layout";
import { panToTerminal } from "../utils/panToTerminal";
import { useT } from "../i18n/useT";

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

const STATUS_DOTS: Record<string, string> = {
  running: "#3b82f6",
  active: "#22c55e",
  waiting: "#f59e0b",
  completed: "#6b7280",
  success: "#22c55e",
  error: "#ef4444",
  idle: "#9ca3af",
};

interface TreeNode {
  terminal: TerminalData;
  isRoot: boolean;
}

function buildFamilyTree(projects: ProjectData[], terminalId: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  const visited = new Set<string>();

  // Find root (walk up parent chain)
  let rootId = terminalId;
  for (let i = 0; i < 20; i++) {
    const info = findTerminalById(projects, rootId);
    if (!info?.terminal.parentTerminalId) break;
    rootId = info.terminal.parentTerminalId;
  }

  // Add root
  const rootInfo = findTerminalById(projects, rootId);
  if (!rootInfo) return [];
  nodes.push({ terminal: rootInfo.terminal, isRoot: true });
  visited.add(rootId);

  // Add all children (BFS)
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = getChildTerminals(projects, id);
    for (const child of children) {
      if (visited.has(child.terminal.id)) continue;
      visited.add(child.terminal.id);
      nodes.push({ terminal: child.terminal, isRoot: false });
      queue.push(child.terminal.id);
    }
  }

  return nodes;
}

function getTerminalAbsolutePosition(
  projects: ProjectData[],
  terminalId: string,
): { x: number; y: number; w: number; h: number } | null {
  for (const p of projects) {
    for (const w of p.worktrees) {
      const index = w.terminals.findIndex((t) => t.id === terminalId);
      if (index === -1) continue;

      const packed = packTerminals(w.terminals.map((t) => t.span));
      const item = packed[index];
      if (!item) continue;

      return {
        x: p.position.x + PROJ_PAD + w.position.x + WT_PAD + item.x,
        y: p.position.y + PROJ_TITLE_H + PROJ_PAD + w.position.y + WT_TITLE_H + WT_PAD + item.y,
        w: item.w,
        h: item.h,
      };
    }
  }
  return null;
}

export function FamilyTreeOverlay() {
  const t = useT();
  const projects = useProjectStore((s) => s.projects);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayHovered = useRef(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const terminalId = (e as CustomEvent<string | null>).detail;
      setHoveredId(terminalId);
    };
    window.addEventListener("termcanvas:terminal-hover", handler);
    return () => window.removeEventListener("termcanvas:terminal-hover", handler);
  }, []);

  // Show overlay after 500ms hover, hide when no longer hovering
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (hoveredId) {
      // Check if this terminal has connections
      const info = findTerminalById(projects, hoveredId);
      const children = getChildTerminals(projects, hoveredId);
      const hasConnections = info?.terminal.parentTerminalId || children.length > 0;

      if (hasConnections) {
        timerRef.current = setTimeout(() => {
          setVisibleId(hoveredId);
        }, 500);
      }
    } else {
      // Delay hide to allow moving to overlay
      timerRef.current = setTimeout(() => {
        if (!overlayHovered.current) {
          setVisibleId(null);
        }
      }, 200);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hoveredId, projects]);

  const tree = useMemo(() => {
    if (!visibleId) return [];
    return buildFamilyTree(projects, visibleId);
  }, [visibleId, projects]);

  const anchorPos = useMemo(() => {
    if (!visibleId) return null;
    return getTerminalAbsolutePosition(projects, visibleId);
  }, [visibleId, projects]);

  if (!visibleId || tree.length <= 1 || !anchorPos) return null;

  const portalTarget = document.getElementById("canvas-layer");
  if (!portalTarget) return null;

  // Position: to the right of the hovered terminal
  const overlayX = anchorPos.x + anchorPos.w + 12;
  const overlayY = anchorPos.y;

  return createPortal(
    <div
      className="absolute panel rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
      style={{
        left: overlayX,
        top: overlayY,
        zIndex: 100,
        minWidth: 180,
        maxWidth: 260,
        animation: "fadeIn 0.15s ease",
      }}
      onMouseEnter={() => { overlayHovered.current = true; }}
      onMouseLeave={() => {
        overlayHovered.current = false;
        setVisibleId(null);
      }}
    >
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <span
          className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.hierarchy_agent_tree}
        </span>
      </div>
      <div className="py-1">
        {tree.map((node) => {
          const color = TYPE_COLORS[node.terminal.type] ?? "#888";
          const statusColor = STATUS_DOTS[node.terminal.status] ?? "#9ca3af";
          const isHovered = node.terminal.id === visibleId;

          return (
            <button
              key={node.terminal.id}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--border)] transition-colors duration-100 ${
                isHovered ? "bg-[var(--border)]" : ""
              }`}
              onClick={() => {
                panToTerminal(node.terminal.id);
                setVisibleId(null);
              }}
            >
              {/* Indent children */}
              {!node.isRoot && (
                <span className="text-[var(--text-faint)] text-[10px] ml-1">└</span>
              )}
              {/* Status dot */}
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: statusColor }}
              />
              {/* Type label */}
              <span
                className="text-[10px] font-medium shrink-0"
                style={{ color, fontFamily: '"Geist Mono", monospace' }}
              >
                {node.terminal.type}
              </span>
              {/* Title */}
              <span
                className="text-[10px] text-[var(--text-muted)] truncate"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {node.terminal.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>,
    portalTarget,
  );
}
