import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { ProjectData, TerminalData } from "../types";
import {
  useProjectStore,
  findTerminalById,
  getChildTerminals,
} from "../stores/projectStore";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
} from "../stores/canvasStore";
import { panToTerminal } from "../utils/panToTerminal";
import { useT } from "../i18n/useT";
import {
  canvasPointToScreenPoint,
  getCanvasLeftInset,
} from "../canvas/viewportBounds";
import { useResolvedTerminalRuntimeState } from "../stores/terminalRuntimeStateStore";

const TYPE_COLORS: Record<string, string> = {
  shell: "#888",
  claude: "#f5a623",
  codex: "#7928ca",
  kimi: "#0070f3",
  gemini: "#4285f4",
  opencode: "#50e3c2",
  wuu: "#ff6b9d",
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

const OVERLAY_GAP = 12;
const OVERLAY_MARGIN = 8;
const OVERLAY_MAX_WIDTH = 260;
const OVERLAY_FALLBACK_HEIGHT = 240;
const TOOLBAR_HEIGHT = 44;

function FamilyTreeNodeRow({
  node,
  visibleId,
  onSelect,
}: {
  node: TreeNode;
  visibleId: string;
  onSelect: (terminalId: string) => void;
}) {
  const liveRuntimeState = useResolvedTerminalRuntimeState(node.terminal);
  const liveTerminal = {
    ...node.terminal,
    ...liveRuntimeState,
  };
  const color = TYPE_COLORS[liveTerminal.type] ?? "#888";
  const statusColor = STATUS_DOTS[liveTerminal.status] ?? "#9ca3af";
  const isHovered = liveTerminal.id === visibleId;

  return (
    <button
      key={liveTerminal.id}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--border)] transition-colors duration-100 ${
        isHovered ? "bg-[var(--border)]" : ""
      }`}
      onClick={() => {
        onSelect(liveTerminal.id);
      }}
    >
      {!node.isRoot && (
        <span className="text-[var(--text-faint)] text-[10px] ml-1">└</span>
      )}
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: statusColor }}
      />
      <span
        className="text-[10px] font-medium shrink-0"
        style={{ color, fontFamily: '"Geist Mono", monospace' }}
      >
        {liveTerminal.type}
      </span>
      <span
        className="text-[10px] text-[var(--text-muted)] truncate"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {liveTerminal.title}
      </span>
    </button>
  );
}

function buildFamilyTree(
  projects: ProjectData[],
  terminalId: string,
): TreeNode[] {
  const nodes: TreeNode[] = [];
  const visited = new Set<string>();

  let rootId = terminalId;
  for (let i = 0; i < 20; i++) {
    const info = findTerminalById(projects, rootId);
    if (!info?.terminal.parentTerminalId) break;
    rootId = info.terminal.parentTerminalId;
  }

  const rootInfo = findTerminalById(projects, rootId);
  if (!rootInfo) return [];
  nodes.push({ terminal: rootInfo.terminal, isRoot: true });
  visited.add(rootId);

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
      const terminal = w.terminals.find((t) => t.id === terminalId);
      if (!terminal) continue;
      return {
        x: terminal.x,
        y: terminal.y,
        w: terminal.width,
        h: terminal.height,
      };
    }
  }
  return null;
}

export function FamilyTreeOverlay() {
  const t = useT();
  const projects = useProjectStore((s) => s.projects);
  const viewport = useCanvasStore((s) => s.viewport);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayHovered = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [, setWindowTick] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const terminalId = (e as CustomEvent<string | null>).detail;
      setHoveredId(terminalId);
    };
    window.addEventListener("termcanvas:terminal-hover", handler);
    return () =>
      window.removeEventListener("termcanvas:terminal-hover", handler);
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (hoveredId) {
      const info = findTerminalById(projects, hoveredId);
      const children = getChildTerminals(projects, hoveredId);
      const hasConnections =
        info?.terminal.parentTerminalId || children.length > 0;

      if (hasConnections) {
        timerRef.current = setTimeout(() => {
          setVisibleId(hoveredId);
        }, 500);
      }
    } else {
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

  useEffect(() => {
    const onResize = () => setWindowTick((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!visibleId || tree.length <= 1 || !anchorPos) return null;

  const portalTarget = document.body;
  if (!portalTarget) return null;

  const panelWidth = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const safeLeft = leftInset + OVERLAY_MARGIN;
  const safeTop = TOOLBAR_HEIGHT + OVERLAY_MARGIN;
  const safeRight = Math.max(
    safeLeft + 1,
    window.innerWidth - panelWidth - OVERLAY_MARGIN,
  );
  const safeBottom = Math.max(safeTop + 1, window.innerHeight - OVERLAY_MARGIN);

  const anchorScreenPoint = canvasPointToScreenPoint(
    anchorPos.x,
    anchorPos.y,
    viewport,
    leftPanelCollapsed,
    leftPanelWidth,
  );
  const anchorLeft = anchorScreenPoint.x;
  const anchorTop = anchorScreenPoint.y;
  const anchorRight = anchorLeft + anchorPos.w * viewport.scale;
  const preferredY = anchorTop;

  const measured = overlayRef.current?.getBoundingClientRect();
  const overlayW = Math.min(
    OVERLAY_MAX_WIDTH,
    measured?.width ?? OVERLAY_MAX_WIDTH,
  );
  const overlayH = measured?.height ?? OVERLAY_FALLBACK_HEIGHT;

  const fitsRight = anchorRight + OVERLAY_GAP + overlayW <= safeRight;
  const preferRightX = anchorRight + OVERLAY_GAP;
  const preferLeftX = anchorLeft - OVERLAY_GAP - overlayW;
  const rawX = fitsRight ? preferRightX : preferLeftX;
  const maxX = Math.max(safeLeft, safeRight - overlayW);
  const clampedX = Math.min(Math.max(rawX, safeLeft), maxX);

  const maxY = Math.max(safeTop, safeBottom - overlayH);
  const clampedY = Math.min(Math.max(preferredY, safeTop), maxY);

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed panel rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg"
      style={{
        left: clampedX,
        top: clampedY,
        zIndex: 120,
        minWidth: 180,
        maxWidth: 260,
        maxHeight: `calc(100vh - ${TOOLBAR_HEIGHT + OVERLAY_MARGIN * 2}px)`,
        overflowY: "auto",
        animation: "fadeIn 0.15s ease",
      }}
      onMouseEnter={() => {
        overlayHovered.current = true;
      }}
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
        {tree.map((node) => (
          <FamilyTreeNodeRow
            key={node.terminal.id}
            node={node}
            visibleId={visibleId}
            onSelect={(terminalId) => {
              panToTerminal(terminalId);
              setVisibleId(null);
            }}
          />
        ))}
      </div>
    </div>,
    portalTarget,
  );
}
