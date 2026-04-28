import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  clearAnnotationsInScene,
  deleteSelectedAnnotationsInScene,
  setAnnotationColorInScene,
  setAnnotationToolInScene,
} from "../actions/annotationSceneActions";
import { useDrawingStore, type DrawingTool } from "../stores/drawingStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useT } from "../i18n/useT";

const colors = [
  "#c8c8c8",
  "#0070f3",
  "#ee0000",
  "#f5a623",
  "#7928ca",
  "#50e3c2",
];

const btnBase =
  "px-2 py-1.5 rounded-md text-[13px] transition-colors duration-150 active:scale-[0.97]";

export function DrawingPanel() {
  const t = useT();
  const tools: { id: DrawingTool; label: string; icon: string }[] = [
    { id: "select", label: t.tool_select, icon: "↖" },
    { id: "pen", label: t.tool_pen, icon: "✎" },
    { id: "text", label: t.tool_text, icon: "T" },
    { id: "rect", label: t.tool_rect, icon: "□" },
    { id: "arrow", label: t.tool_arrow, icon: "→" },
  ];
  const { tool, color, elements } = useDrawingStore();
  const selectedAnnotationCount = useSelectionStore(
    (state) =>
      state.selectedItems.filter((item) => item.type === "annotation").length,
  );
  const [vertical, setVertical] = useState(true);
  const [pos, setPos] = useState({ x: window.innerWidth - 60, y: 60 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const clampPos = useCallback((x: number, y: number) => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - w)),
      y: Math.max(0, Math.min(y, window.innerHeight - h)),
    };
  }, []);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPos]);

  useLayoutEffect(() => {
    setPos((p) => clampPos(p.x, p.y));
  }, [vertical, clampPos]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };

      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const newX =
          dragRef.current.origX + ev.clientX - dragRef.current.startX;
        const newY =
          dragRef.current.origY + ev.clientY - dragRef.current.startY;
        setPos(clampPos(newX, newY));
      };

      const handleUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [pos, clampPos],
  );

  return (
    <div
      ref={panelRef}
      className="fixed z-[95] bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex items-center gap-1 px-1.5 py-1 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleDragStart}
      >
        <span className="text-[10px] text-[var(--text-muted)]">⠿</span>
        <div className="flex-1" />
        <button
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5 rounded"
          onClick={(e) => {
            e.stopPropagation();
            setVertical(!vertical);
          }}
          title={vertical ? t.layout_horizontal : t.layout_vertical}
          aria-label={vertical ? t.layout_horizontal : t.layout_vertical}
          aria-pressed={vertical}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            {vertical ? (
              <>
                <line
                  x1="1"
                  y1="5"
                  x2="9"
                  y2="5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="1"
                  y1="2"
                  x2="9"
                  y2="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="1"
                  y1="8"
                  x2="9"
                  y2="8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </>
            ) : (
              <>
                <line
                  x1="5"
                  y1="1"
                  x2="5"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="2"
                  y1="1"
                  x2="2"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="8"
                  y1="1"
                  x2="8"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </>
            )}
          </svg>
        </button>
      </div>

      <div
        className={`flex ${vertical ? "flex-col" : "flex-row"} gap-0.5 px-1.5 pb-1.5`}
      >
        {tools.map((toolItem) => (
          <button
            key={toolItem.id}
            aria-label={toolItem.label}
            aria-pressed={tool === toolItem.id}
            className={`${btnBase} ${
              tool === toolItem.id
                ? "bg-[var(--border)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]"
            }`}
            onClick={() => setAnnotationToolInScene(toolItem.id)}
            title={toolItem.label}
          >
            {toolItem.icon}
          </button>
        ))}

        {vertical ? (
          <div className="h-px bg-[var(--border)] mx-1 my-0.5" />
        ) : (
          <div className="w-px bg-[var(--border)] my-1 mx-0.5" />
        )}

        <div
          className={`flex ${vertical ? "flex-col items-center" : "flex-row"} gap-1 ${vertical ? "py-0.5 px-1" : "py-1 px-0.5"}`}
        >
          {colors.map((c) => (
            <button
              key={c}
              aria-label={`Select color ${c}`}
              aria-pressed={color === c}
              className="w-4 h-4 rounded-full transition-all duration-150"
              style={{
                backgroundColor: c,
                outline:
                  color === c
                    ? "1.5px solid var(--text-primary)"
                    : "1.5px solid transparent",
                outlineOffset: 1,
              }}
              onClick={() => setAnnotationColorInScene(c)}
            />
          ))}
        </div>

        {elements.length > 0 && (
          <button
            className={`${btnBase} text-[var(--text-muted)] hover:text-[var(--red)]`}
            onClick={deleteSelectedAnnotationsInScene}
            title={t.ctx_delete}
            aria-label={t.ctx_delete}
            disabled={selectedAnnotationCount === 0}
          >
            ⌫
          </button>
        )}

        {elements.length > 0 && (
          <button
            className={`${btnBase} text-[var(--text-muted)] hover:text-[var(--red)]`}
            onClick={clearAnnotationsInScene}
            title="Clear all annotations"
            aria-label="Clear all annotations"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
