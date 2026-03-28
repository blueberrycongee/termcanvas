import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import {
  useCardLayoutStore,
  resolveAllCardPositions,
} from "../stores/cardLayoutStore";
import { useProjectStore, getProjectBounds } from "../stores/projectStore";
import { useT } from "../i18n/useT";

type FileContent =
  | { status: "loading" }
  | { status: "text"; content: string }
  | { status: "markdown"; content: string }
  | { status: "image"; content: string }
  | { status: "binary" }
  | { status: "error"; message: string };

interface Props {
  fileCardId: string;
  filePath: string;
  fileName: string;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
}

export function FileCard({
  fileCardId,
  filePath,
  fileName,
  anchorX,
  anchorY,
  onClose,
}: Props) {
  const t = useT();
  const cardId = `file:${fileCardId}`;
  const [fileContent, setFileContent] = useState<FileContent>({ status: "loading" });
  const [pos, setPos] = useState({ x: anchorX + 16, y: anchorY });
  const [size, setSize] = useState({ w: 500, h: 400 });
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

  const { register, unregister } = useCardLayoutStore();
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

  const allResolved = resolveAllCardPositions(cards, obstacles);
  const resolved = allResolved[cardId] ?? { x: pos.x, y: pos.y };
  const resolvedX = resolved.x;
  const resolvedY = resolved.y;

  useEffect(() => {
    if (!window.termcanvas) return;
    setFileContent({ status: "loading" });
    window.termcanvas.fs.readFile(filePath).then((result) => {
      if ("error" in result) {
        if (result.error === "too-large") {
          setFileContent({
            status: "error",
            message: t.file_too_large(result.size ?? ""),
          });
        } else {
          setFileContent({ status: "error", message: t.file_read_error });
        }
      } else {
        if (result.type === "image") {
          setFileContent({ status: "image", content: result.content });
        } else if (result.type === "binary") {
          setFileContent({ status: "binary" });
        } else if (result.type === "markdown") {
          setFileContent({ status: "markdown", content: result.content });
        } else {
          setFileContent({ status: "text", content: result.content });
        }
      }
    });
  }, [filePath, t]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
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
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [pos],
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
        setSize({
          w: Math.max(
            280,
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
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [size],
  );

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
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none shrink-0"
          onMouseDown={handleDragStart}
        >
          <span
            className="text-[11px] font-medium text-[var(--accent)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.file_viewer}
          </span>
          <span
            className="text-[11px] text-[var(--text-muted)] truncate"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {fileName}
          </span>
          <div className="flex-1" />
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
        </div>

        <div
          className="flex-1 overflow-auto min-h-0"
          style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}
        >
          {fileContent.status === "loading" && (
            <div className="text-[var(--text-muted)] py-8 text-center">
              {t.loading}
            </div>
          )}
          {(fileContent.status === "text" || fileContent.status === "markdown") && (
            <pre className="px-3 py-1 leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words">
              <div className="pb-3">{fileContent.content}</div>
            </pre>
          )}
          {fileContent.status === "image" && (
            <div className="flex items-center justify-center p-4">
              <img
                src={fileContent.content}
                alt={fileName}
                className="max-w-full max-h-full rounded border border-[var(--border)] object-contain"
                style={{
                  background:
                    "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%) 50% / 12px 12px",
                }}
              />
            </div>
          )}
          {fileContent.status === "binary" && (
            <div className="text-[var(--text-muted)] py-8 text-center">
              {t.file_binary}
            </div>
          )}
          {fileContent.status === "error" && (
            <div className="text-[var(--text-muted)] py-8 text-center">
              {fileContent.message}
            </div>
          )}
        </div>

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
      </div>
    </>
  );
}
