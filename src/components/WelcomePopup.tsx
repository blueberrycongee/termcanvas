import { useState, useEffect, useRef } from "react";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";

interface Props {
  onClose: () => void;
}

function Bi({ en: e, zh: z }: { en: string; zh: string }) {
  return (
    <>
      <span style={{ color: "var(--cyan)" }}>{e}</span>
      <span className="text-[var(--text-faint)] mx-1">·</span>
      <span style={{ color: "var(--amber)" }}>{z}</span>
    </>
  );
}

const TERMINALS = [
  {
    name: "node",
    color: "var(--cyan)",
    lines: [
      { text: "$ node server.js", color: "var(--text-muted)" },
      { text: "listening on :3000", color: "var(--green)" },
    ],
  },
  {
    name: "build",
    color: "var(--amber)",
    lines: [
      { text: "$ npm run build", color: "var(--text-muted)" },
      { text: "✓ built in 1.2s", color: "var(--green)" },
    ],
  },
  {
    name: "git",
    color: "var(--cyan)",
    lines: [
      { text: "$ git status", color: "var(--text-muted)" },
      { text: "nothing to commit", color: "var(--text-secondary)" },
    ],
  },
  {
    name: "test",
    color: "var(--green)",
    lines: [
      { text: "$ npm test", color: "var(--text-muted)" },
      { text: "4 passing (12ms)", color: "var(--green)" },
    ],
  },
] as const;

const isMac = (window.termcanvas?.app.platform ?? "darwin") === "darwin";

const TILE_OFFSETS = [
  { x: -64, y: -44 },
  { x: 64, y: -44 },
  { x: -64, y: 44 },
  { x: 64, y: 44 },
];

function DemoCursor({
  pos,
  dragging,
}: {
  pos: { x: number; y: number };
  dragging: boolean;
}) {
  return (
    <svg
      width="16"
      height="20"
      viewBox="0 0 16 20"
      fill="none"
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        transition: dragging
          ? "none"
          : "left 350ms cubic-bezier(0.4, 0, 0.2, 1), top 350ms cubic-bezier(0.4, 0, 0.2, 1)",
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      <path
        d="M1 1L1 14L4.5 10.5L8 18L10.5 17L7 9.5L12 9.5L1 1Z"
        fill="white"
        stroke="#1a1a1a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DemoTile({
  name,
  color,
  lines,
  focused,
  visible,
}: {
  name: string;
  color: string;
  lines: { text: string; color: string }[];
  focused: boolean;
  visible: boolean;
}) {
  return (
    <div
      className="rounded border"
      style={{
        width: 120,
        height: 80,
        background: "var(--bg)",
        borderColor: focused ? "rgba(91,158,245,0.6)" : "var(--border)",
        boxShadow: focused ? "0 0 12px rgba(91,158,245,0.45)" : "none",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.95)",
        transition: "all 200ms ease-out",
      }}
    >
      <div className="flex items-center gap-1 px-1.5 py-0.5 border-b border-[var(--border)]">
        <div
          className="w-[3px] h-[7px] rounded-full shrink-0"
          style={{ background: color }}
        />
        <span className="text-[9px] text-[var(--text-secondary)] truncate">
          {name}
        </span>
      </div>
      <div className="px-1.5 py-1 space-y-0.5">
        {lines.map((line, i) => (
          <div
            key={i}
            className="text-[8px] leading-tight truncate"
            style={{ color: line.color }}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoSidebar() {
  return (
    <div
      className="shrink-0 flex flex-col items-center pt-3 gap-2 border-r border-[var(--border)]"
      style={{ width: 44, background: "var(--sidebar)" }}
    >
      <div
        className="rounded-md"
        style={{
          width: 20,
          height: 20,
          background: "var(--text-faint)",
          opacity: 0.6,
        }}
      />
      {[0.4, 0.3, 0.25, 0.2].map((op, i) => (
        <div
          key={i}
          className="rounded"
          style={{
            width: 16,
            height: 16,
            background: "var(--text-faint)",
            opacity: op,
          }}
        />
      ))}
    </div>
  );
}

function DemoPanel({
  visible,
  content,
}: {
  visible: boolean;
  content: "usage" | "hydra";
}) {
  return (
    <div className="shrink-0 overflow-hidden" style={{ width: visible ? 180 : 0, transition: "width 300ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
      <div
        className="h-full border-l border-[var(--border)]"
        style={{
          width: 180,
          background: "var(--surface)",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition:
            "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {content === "usage" ? (
          <div className="p-3 flex flex-col gap-3">
            <div
              className="rounded"
              style={{
                height: 12,
                width: "60%",
                background: "var(--text-faint)",
                opacity: 0.5,
              }}
            />
            <div className="flex items-end gap-2" style={{ height: 60 }}>
              {[40, 55, 30].map((h, i) => (
                <div
                  key={i}
                  className="rounded-sm flex-1"
                  style={{
                    height: h,
                    background: "var(--accent)",
                    opacity: 0.3 + i * 0.15,
                  }}
                />
              ))}
            </div>
            <div
              className="rounded"
              style={{
                height: 10,
                width: "40%",
                background: "var(--text-faint)",
                opacity: 0.4,
              }}
            />
          </div>
        ) : (
          <div className="p-3 flex flex-col gap-3">
            {[0.5, 0.4].map((op, i) => (
              <div
                key={i}
                className="rounded-full"
                style={{
                  height: 14,
                  width: i === 0 ? "70%" : "50%",
                  background: "var(--green)",
                  opacity: op,
                }}
              />
            ))}
            <div
              className="rounded-full"
              style={{
                height: 6,
                width: "100%",
                background: "var(--text-faint)",
                opacity: 0.3,
                overflow: "hidden",
              }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: "65%",
                  background: "var(--accent)",
                  opacity: 0.6,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KeystrokeBar({
  keystroke,
}: {
  keystroke: { key: string; en: string; zh: string } | null;
}) {
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{ height: 32 }}
    >
      <div
        style={{
          opacity: keystroke ? 1 : 0,
          transform: keystroke ? "translateY(0)" : "translateY(4px)",
          transition: "opacity 150ms, transform 150ms",
        }}
      >
        {keystroke && (
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className="rounded-md px-1.5 py-0.5"
              style={{
                background: "var(--surface)",
                color: "var(--text-primary)",
                fontFamily: '"Geist Mono", monospace',
              }}
            >
              {keystroke.key}
            </span>
            <Bi en={keystroke.en} zh={keystroke.zh} />
          </div>
        )}
      </div>
    </div>
  );
}

export function WelcomePopup({ onClose }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [focusedTile, setFocusedTile] = useState(-1);
  const [tilesVisible, setTilesVisible] = useState([false, false, false, false]);
  const [canvasTransform, setCanvasTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [panelVisible, setPanelVisible] = useState(false);
  const [panelContent, setPanelContent] = useState<"usage" | "hydra">("usage");
  const [keystroke, setKeystroke] = useState<{ key: string; en: string; zh: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFinished, setIsFinished] = useState(false);
  const prefersReducedMotion = useRef(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  const getCenter = () => {
    const el = canvasRef.current;
    if (!el) return { x: 190, y: 190 };
    return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
  };

  const getTileCenter = (index: number) => {
    const center = getCenter();
    const off = TILE_OFFSETS[index];
    return { x: center.x + off.x, y: center.y + off.y };
  };

  useEffect(() => {
    if (!isPlaying) return;
    let cancelled = false;

    const delay = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const run = async () => {
      setIsFinished(false);
      setFocusedTile(-1);
      setTilesVisible([false, false, false, false]);
      setCanvasTransform({ x: 0, y: 0, scale: 1 });
      setKeystroke(null);
      setPanelVisible(false);
      setPanelContent("usage");
      setIsDragging(false);

      if (prefersReducedMotion.current) {
        setTilesVisible([true, true, true, true]);
        setCursorPos(getCenter());
        setIsFinished(true);
        setIsPlaying(false);
        return;
      }

      const center = getCenter();
      setCursorPos(center);
      await delay(400);
      if (cancelled) return;

      for (let i = 0; i < 4; i++) {
        if (cancelled) return;
        setTilesVisible((prev) => {
          const next = [...prev];
          next[i] = true;
          return next;
        });
        await delay(150);
      }
      await delay(800);
      if (cancelled) return;

      const fmtClearFocus = formatShortcut(shortcuts.clearFocus, isMac);
      const tile0 = getTileCenter(0);
      setCursorPos(tile0);
      await delay(400);
      if (cancelled) return;

      setKeystroke({ key: fmtClearFocus, en: "Toggle Focus", zh: "切换聚焦" });
      await delay(300);
      if (cancelled) return;

      setFocusedTile(0);
      setCanvasTransform({
        x: -TILE_OFFSETS[0].x * 0.3,
        y: -TILE_OFFSETS[0].y * 0.3,
        scale: 1.3,
      });
      await delay(1500);
      if (cancelled) return;

      const fmtNext = formatShortcut(shortcuts.nextTerminal, isMac);
      setKeystroke({ key: fmtNext, en: "Next Terminal", zh: "下一终端" });
      for (const idx of [1, 2, 3]) {
        if (cancelled) return;
        setFocusedTile(idx);
        setCursorPos(getTileCenter(idx));
        setCanvasTransform({
          x: -TILE_OFFSETS[idx].x * 0.3,
          y: -TILE_OFFSETS[idx].y * 0.3,
          scale: 1.3,
        });
        await delay(1000);
      }
      if (cancelled) return;

      setKeystroke({ key: fmtClearFocus, en: "Toggle Focus", zh: "切换聚焦" });
      await delay(300);
      if (cancelled) return;
      setFocusedTile(-1);
      setCursorPos(getCenter());
      setCanvasTransform({ x: 0, y: 0, scale: 1 });
      await delay(1500);
      if (cancelled) return;

      setKeystroke({ key: "Scroll", en: "Zoom", zh: "缩放" });
      await delay(300);
      if (cancelled) return;

      setCanvasTransform({ x: 0, y: 0, scale: 0.7 });
      await delay(800);
      if (cancelled) return;

      setKeystroke({ key: "Drag", en: "Pan", zh: "平移" });
      setIsDragging(true);
      const panCenter = getCenter();
      const PAN_STEPS = 16;
      for (let i = 1; i <= PAN_STEPS; i++) {
        if (cancelled) return;
        const progress = i / PAN_STEPS;
        const panX = Math.sin(progress * Math.PI) * 30;
        setCursorPos({ x: panCenter.x + panX, y: panCenter.y });
        setCanvasTransform({ x: panX, y: 0, scale: 0.7 });
        await delay(25);
      }
      setIsDragging(false);
      if (cancelled) return;

      setKeystroke({ key: "Scroll", en: "Zoom", zh: "缩放" });
      setCanvasTransform({ x: 0, y: 0, scale: 1 });
      setCursorPos(panCenter);
      await delay(800);
      if (cancelled) return;

      // Phase 6: Panel
      const fmtTogglePanel = formatShortcut(shortcuts.toggleRightPanel, isMac);
      setKeystroke({ key: fmtTogglePanel, en: "Toggle Panel", zh: "切换面板" });
      await delay(300);
      if (cancelled) return;

      setPanelVisible(true);
      setPanelContent("usage");
      await delay(2000);
      if (cancelled) return;

      setPanelContent("hydra");
      await delay(1500);
      if (cancelled) return;

      // Phase 7: Finish
      setPanelVisible(false);
      await delay(400);
      if (cancelled) return;

      const fmtAddProject = formatShortcut(shortcuts.addProject, isMac);
      setKeystroke({ key: fmtAddProject, en: "Add Project", zh: "添加项目" });
      await delay(1500);
      if (cancelled) return;

      setIsFinished(true);
      setIsPlaying(false);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isPlaying, shortcuts.clearFocus, shortcuts.nextTerminal, shortcuts.toggleRightPanel, shortcuts.addProject]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        setIsPlaying(false);
      } else if (!isFinished) {
        setIsPlaying(true);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [isFinished]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        className="rounded-md bg-[var(--bg)] overflow-hidden flex flex-col border border-[var(--border)] max-w-[800px] w-full mx-4 shadow-2xl"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <div className="flex items-center gap-2 px-3 py-2 select-none shrink-0">
          <div className="w-[3px] h-3 rounded-full bg-amber-500/60 shrink-0" />
          <span
            className="text-[11px] font-medium"
            style={{ color: "var(--cyan)" }}
          >
            demo
          </span>
          <span className="text-[11px] text-[var(--text-muted)] truncate flex-1">
            termcanvas
          </span>
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={onClose}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 2L8 8M8 2L2 8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <DemoSidebar />

          <div className="flex-1 min-w-0 flex flex-col">
            <div
              ref={canvasRef}
              className="relative overflow-hidden flex-1"
              style={{
                height: 380,
                background: "var(--surface)",
                backgroundImage:
                  "radial-gradient(circle, var(--text-faint) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            >
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`,
                  transition: "transform 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  {TERMINALS.map((term, i) => (
                    <DemoTile
                      key={term.name}
                      name={term.name}
                      color={term.color}
                      lines={[...term.lines]}
                      focused={focusedTile === i}
                      visible={tilesVisible[i]}
                    />
                  ))}
                </div>
              </div>

              <DemoCursor pos={cursorPos} dragging={isDragging} />
            </div>

            <KeystrokeBar keystroke={keystroke} />

            {isFinished && (
              <div className="flex items-center justify-center py-2">
                <button
                  className="text-[11px] hover:underline"
                  style={{ color: "var(--accent)" }}
                  onClick={() => setIsPlaying(true)}
                >
                  <Bi en="Replay" zh="重播" />
                </button>
              </div>
            )}
          </div>

          <DemoPanel visible={panelVisible} content={panelContent} />
        </div>
      </div>

      <div className="absolute bottom-6 text-[12px] text-[var(--text-muted)]">
        <Bi en="Escape to close" zh="Escape 关闭" />
      </div>
    </div>
  );
}
