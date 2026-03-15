import { useState, useRef, useCallback } from "react";
import { useDrawingStore, type DrawingTool } from "../stores/drawingStore";
import { useT } from "../i18n/useT";

const colors = [
  "#ededed",
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
  const { tool, color, setTool, setColor, clearAll, elements } =
    useDrawingStore();
  const [vertical, setVertical] = useState(true);
  const [pos, setPos] = useState({ x: window.innerWidth - 60, y: 60 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

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
        setPos({
          x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
          y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
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

  return (
    <div
      className="fixed z-50 bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Drag handle + layout toggle */}
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

      {/* Tools + colors */}
      <div
        className={`flex ${vertical ? "flex-col" : "flex-row"} gap-0.5 px-1.5 pb-1.5`}
      >
        {/* Tool buttons */}
        {tools.map((toolItem) => (
          <button
            key={toolItem.id}
            className={`${btnBase} ${
              tool === toolItem.id
                ? "bg-[var(--border)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]"
            }`}
            onClick={() => setTool(toolItem.id)}
            title={toolItem.label}
          >
            {toolItem.icon}
          </button>
        ))}

        {/* Separator */}
        {vertical ? (
          <div className="h-px bg-[var(--border)] mx-1 my-0.5" />
        ) : (
          <div className="w-px bg-[var(--border)] my-1 mx-0.5" />
        )}

        {/* Color dots */}
        <div
          className={`flex ${vertical ? "flex-col items-center" : "flex-row"} gap-1 ${vertical ? "py-0.5 px-1" : "py-1 px-0.5"}`}
        >
          {colors.map((c) => (
            <button
              key={c}
              className="w-4 h-4 rounded-full transition-all duration-150"
              style={{
                backgroundColor: c,
                outline:
                  color === c
                    ? "1.5px solid var(--text-primary)"
                    : "1.5px solid transparent",
                outlineOffset: 1,
              }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        {/* Clear */}
        {elements.length > 0 && (
          <button
            className={`${btnBase} text-[var(--text-muted)] hover:text-[var(--red)]`}
            onClick={clearAll}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
