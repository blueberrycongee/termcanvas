import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import {
  useCardLayoutStore,
  resolveAllCardPositions,
} from "../stores/cardLayoutStore";
import { useProjectStore, getProjectBounds } from "../stores/projectStore";
import { useT } from "../i18n/useT";

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface Props {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  anchorX: number;
  anchorY: number;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDragStateChange?: (dragging: boolean) => void;
  onOpenFile: (filePath: string, fileName: string) => void;
}

function FileIcon({ isDirectory, expanded }: { isDirectory: boolean; expanded?: boolean }) {
  if (isDirectory) {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
        {expanded ? (
          <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" stroke="var(--accent)" strokeWidth="1.2" fill="rgba(80,227,194,0.1)" />
        ) : (
          <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" stroke="var(--text-muted)" strokeWidth="1.2" fill="none" />
        )}
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z" stroke="var(--text-muted)" strokeWidth="1.2" fill="none" />
      <path d="M9 1.5v3.5h3.5" stroke="var(--text-muted)" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

export function FileTreeCard({
  projectId,
  worktreeId,
  worktreePath,
  anchorX,
  anchorY,
  pinned,
  onPin,
  onClose,
  onMouseEnter,
  onMouseLeave,
  onDragStateChange,
  onOpenFile,
}: Props) {
  const t = useT();
  const cardId = `filetree:${worktreeId}`;
  const [entries, setEntries] = useState<Map<string, DirEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [pos, setPos] = useState({ x: anchorX + 16, y: anchorY });
  const [size, setSize] = useState({ w: 280, h: 340 });
  const [justPinned, setJustPinned] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);
  const hasDragged = useRef(false);

  const register = useCardLayoutStore((s) => s.register);
  const unregister = useCardLayoutStore((s) => s.unregister);
  const activeCardId = useCardLayoutStore((s) => s.activeCardId);
  const recentCardId = useCardLayoutStore((s) => s.recentCardId);
  const setActiveCardId = useCardLayoutStore((s) => s.setActiveCardId);
  const setRecentCardId = useCardLayoutStore((s) => s.setRecentCardId);
  const cards = useCardLayoutStore((s) => s.cards);

  useEffect(() => {
    register(cardId, { x: pos.x, y: pos.y, w: size.w, h: size.h });
    return () => unregister(cardId);
  }, [cardId, pos.x, pos.y, size.w, size.h, register, unregister]);

  const projects = useProjectStore((s) => s.projects);
  const obstacles = useMemo(
    () => projects.map((p) => getProjectBounds(p)),
    [projects],
  );

  const priorityIds = [activeCardId, recentCardId].filter(
    (id): id is string => Boolean(id),
  );
  const allResolved = resolveAllCardPositions(cards, obstacles, { priorityIds });
  const resolved = allResolved[cardId] ?? { x: pos.x, y: pos.y };
  const resolvedX = resolved.x;
  const resolvedY = resolved.y;

  // Load root directory on mount
  useEffect(() => {
    if (!window.termcanvas) return;
    setLoading(true);
    window.termcanvas.fs.listDir(worktreePath).then((items) => {
      setEntries(new Map([[worktreePath, items]]));
      setLoading(false);
    });
  }, [worktreePath]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          // Lazy load if not already loaded
          if (!entries.has(dirPath)) {
            window.termcanvas.fs.listDir(dirPath).then((items) => {
              setEntries((prev) => new Map(prev).set(dirPath, items));
            });
          }
        }
        return next;
      });
    },
    [entries],
  );

  useEffect(() => {
    if (!pinned) setPos({ x: anchorX + 16, y: anchorY });
  }, [anchorX, anchorY, pinned]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      hasDragged.current = false;
      onDragStateChange?.(true);
      setActiveCardId(cardId);
      setRecentCardId(cardId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: resolvedX,
        origY: resolvedY,
      };
      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        hasDragged.current = true;
        setPos({
          x:
            dragRef.current.origX +
            (ev.clientX - dragRef.current.startX) / scale,
          y:
            dragRef.current.origY +
            (ev.clientY - dragRef.current.startY) / scale,
        });
      };
      const handleUp = () => {
        onDragStateChange?.(false);
        setActiveCardId(null);
        setRecentCardId(cardId);
        if (hasDragged.current && !pinned) {
          onPin();
          setJustPinned(true);
          setTimeout(() => setJustPinned(false), 200);
        }
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [
      cardId,
      onPin,
      pinned,
      resolvedX,
      resolvedY,
      onDragStateChange,
      setActiveCardId,
      setRecentCardId,
    ],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      setActiveCardId(cardId);
      setRecentCardId(cardId);
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: size.w,
        origH: size.h,
      };
      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        setSize({
          w: Math.max(
            200,
            resizeRef.current.origW +
              (ev.clientX - resizeRef.current.startX) / scale,
          ),
          h: Math.max(
            150,
            resizeRef.current.origH +
              (ev.clientY - resizeRef.current.startY) / scale,
          ),
        });
      };
      const handleUp = () => {
        setActiveCardId(null);
        setRecentCardId(cardId);
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [cardId, setActiveCardId, setRecentCardId, size],
  );

  // Render directory tree recursively
  const renderEntries = (dirPath: string, depth: number) => {
    const items = entries.get(dirPath);
    if (!items) return null;
    if (items.length === 0) {
      return (
        <div
          className="text-[var(--text-muted)] text-[11px] py-1"
          style={{ paddingLeft: depth * 16 + 12 }}
        >
          {t.file_empty_dir}
        </div>
      );
    }
    return items.map((entry) => {
      const fullPath = `${dirPath}/${entry.name}`;
      const isExpanded = expandedDirs.has(fullPath);
      return (
        <div key={fullPath}>
          <button
            className="w-full flex items-center gap-1.5 px-2 py-[3px] hover:bg-[var(--surface-hover)] transition-colors duration-150 text-left"
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => {
              if (entry.isDirectory) {
                toggleDir(fullPath);
              } else {
                onOpenFile(fullPath, entry.name);
              }
            }}
          >
            {entry.isDirectory ? (
              <svg
                width="6"
                height="6"
                viewBox="0 0 6 6"
                fill="none"
                className={`shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
              >
                <path
                  d="M1.5 0.5L4.5 3L1.5 5.5"
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span className="w-[6px] shrink-0" />
            )}
            <FileIcon isDirectory={entry.isDirectory} expanded={isExpanded} />
            <span className="text-[var(--text-primary)] truncate text-[11px]">
              {entry.name}
            </span>
          </button>
          {entry.isDirectory && isExpanded && renderEntries(fullPath, depth + 1)}
        </div>
      );
    });
  };

  // Connection line
  const lineX1 = anchorX;
  const lineY1 = anchorY + 20;
  const lineX2 = resolvedX;
  const lineY2 = resolvedY + 20;
  const lineSvgLeft = Math.min(lineX1, lineX2);
  const lineSvgTop = Math.min(lineY1, lineY2);
  const lineSvgW = Math.abs(lineX2 - lineX1) || 1;
  const lineSvgH = Math.abs(lineY2 - lineY1) || 1;

  return (
    <>
      <svg
        className="absolute pointer-events-none"
        style={{
          left: lineSvgLeft,
          top: lineSvgTop,
          overflow: "visible",
        }}
        width={lineSvgW}
        height={lineSvgH}
      >
        <line
          x1={lineX1 - lineSvgLeft}
          y1={lineY1 - lineSvgTop}
          x2={lineX2 - lineSvgLeft}
          y2={lineY2 - lineSvgTop}
          stroke="var(--text-muted)"
          strokeWidth="1.5"
          strokeDasharray={pinned ? "none" : "4 3"}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        className="absolute rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col"
        style={{
          left: resolvedX,
          top: resolvedY,
          width: size.w,
          height: size.h,
          opacity: pinned ? 1 : 0.85,
          transition: justPinned
            ? "transform 150ms ease, opacity 150ms ease"
            : "opacity 150ms ease",
          transform: justPinned ? "scale(1.02)" : "scale(1)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none shrink-0"
          onMouseDown={handleDragStart}
        >
          <span
            className="text-[11px] font-medium text-[var(--accent)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.files}
          </span>
          {!loading && entries.has(worktreePath) && (
            <span className="text-[11px] text-[var(--text-muted)]">
              {(() => {
                const rootItems = entries.get(worktreePath) ?? [];
                const dirs = rootItems.filter((e) => e.isDirectory).length;
                const files = rootItems.length - dirs;
                return t.filetree_summary(files, dirs);
              })()}
            </span>
          )}
          <div className="flex-1" />
          {pinned && (
            <button
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
              onClick={onClose}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        {/* File tree */}
        <div
          className="flex-1 overflow-auto min-h-0"
          style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}
        >
          {loading ? (
            <div className="text-[var(--text-muted)] py-8 text-center">
              {t.loading}
            </div>
          ) : (
            renderEntries(worktreePath, 0)
          )}
        </div>

        {/* Resize handle */}
        {pinned && (
          <div
            className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity duration-150"
            onMouseDown={handleResizeStart}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              className="text-[var(--text-faint)]"
            >
              <path
                d="M11 11L6 11M11 11L11 6"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>
    </>
  );
}
