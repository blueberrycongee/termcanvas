import { useState, useRef, useCallback, useEffect } from "react";
import { useCanvasStore } from "../stores/canvasStore";

interface Props {
  worktreeId: string;
  worktreePath: string;
  /** Anchor position in canvas coords (right edge of worktree) */
  anchorX: number;
  anchorY: number;
  /** Whether this card is pinned (dragged out) */
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
}

export function DiffCard({
  worktreePath,
  anchorX,
  anchorY,
  pinned,
  onPin,
  onClose,
}: Props) {
  const [stat, setStat] = useState("");
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(true);
  const [pos, setPos] = useState({ x: anchorX + 16, y: anchorY });
  const [size, setSize] = useState({ w: 360, h: 300 });
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

  useEffect(() => {
    if (!window.termcanvas) return;
    setLoading(true);
    window.termcanvas.project.diff(worktreePath).then((result) => {
      setStat(result.stat || "No changes");
      setDiff(result.diff);
      setLoading(false);
    });
  }, [worktreePath]);

  // Sync position with anchor when not pinned
  useEffect(() => {
    if (!pinned) {
      setPos({ x: anchorX + 16, y: anchorY });
    }
  }, [anchorX, anchorY, pinned]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const scale = useCanvasStore.getState().viewport.scale;
      hasDragged.current = false;

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };

      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        hasDragged.current = true;
        const dx = (ev.clientX - dragRef.current.startX) / scale;
        const dy = (ev.clientY - dragRef.current.startY) / scale;
        setPos({
          x: dragRef.current.origX + dx,
          y: dragRef.current.origY + dy,
        });
      };

      const handleUp = () => {
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
    [pos, pinned, onPin],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;

      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: size.w,
        origH: size.h,
      };

      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const dx = (ev.clientX - resizeRef.current.startX) / scale;
        const dy = (ev.clientY - resizeRef.current.startY) / scale;
        setSize({
          w: Math.max(240, resizeRef.current.origW + dx),
          h: Math.max(150, resizeRef.current.origH + dy),
        });
      };

      const handleUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [size],
  );

  return (
    <div
      className="absolute rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        opacity: pinned ? 1 : 0.85,
        transition: justPinned
          ? "transform 150ms ease, opacity 150ms ease"
          : "opacity 150ms ease",
        transform: justPinned ? "scale(1.02)" : "scale(1)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
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
          Diff
        </span>
        <span className="text-[11px] text-[var(--text-muted)] truncate flex-1">
          {loading ? "Loading..." : `${stat.split("\n").length - 1} files`}
        </span>
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

      {/* Content */}
      <div
        className="flex-1 overflow-auto px-3 pb-2 min-h-0"
        style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}
      >
        {loading ? (
          <div className="text-[var(--text-muted)] py-4 text-center">
            Loading diff...
          </div>
        ) : diff ? (
          <pre className="whitespace-pre leading-relaxed">
            {diff.split("\n").map((line, i) => {
              let color = "var(--text-secondary)";
              if (line.startsWith("+") && !line.startsWith("+++"))
                color = "var(--cyan)";
              else if (line.startsWith("-") && !line.startsWith("---"))
                color = "var(--red)";
              else if (line.startsWith("@@")) color = "var(--accent)";
              else if (line.startsWith("diff ")) color = "var(--text-muted)";
              return (
                <div key={i} style={{ color }}>
                  {line}
                </div>
              );
            })}
          </pre>
        ) : (
          <div className="text-[var(--text-muted)] py-4 text-center">
            No changes
          </div>
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
  );
}
