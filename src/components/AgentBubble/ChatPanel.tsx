import { useCallback, useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { BubbleMessage } from "./types";
import {
  useCanvasStore,
  RIGHT_PANEL_WIDTH,
  COLLAPSED_TAB_WIDTH,
} from "../../stores/canvasStore";
import { useAgentBubbleStore } from "../../stores/agentBubbleStore";

interface ChatPanelProps {
  messages: BubbleMessage[];
  onSendMessage: (text: string) => void;
  onCollapse: () => void;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 300;
const MAX_WIDTH = 600;
const MAX_HEIGHT = 700;
const INITIAL_WIDTH = 380;
const INITIAL_HEIGHT = 520;
const EDGE_ZONE = 8;
const TOOLBAR_HEIGHT = 44;

function clampPos(
  bottom: number,
  right: number,
  w: number,
  h: number,
  minRight: number,
): { bottom: number; right: number } {
  // Right: must not overlap with the right panel area
  const maxRight = window.innerWidth - w;
  const clampedRight = Math.max(minRight, Math.min(maxRight, right));
  // Bottom: top edge must not go above toolbar (top = innerHeight - bottom - h >= TOOLBAR_HEIGHT)
  const maxBottom = window.innerHeight - h - TOOLBAR_HEIGHT;
  const clampedBottom = Math.max(0, Math.min(maxBottom, bottom));
  return { bottom: clampedBottom, right: clampedRight };
}

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

function getEdge(rect: DOMRect, clientX: number, clientY: number): ResizeEdge {
  const top = clientY - rect.top < EDGE_ZONE;
  const bottom = rect.bottom - clientY < EDGE_ZONE;
  const left = clientX - rect.left < EDGE_ZONE;
  const right = rect.right - clientX < EDGE_ZONE;

  if (top && left) return "nw";
  if (top && right) return "ne";
  if (bottom && left) return "sw";
  if (bottom && right) return "se";
  if (top) return "n";
  if (bottom) return "s";
  if (left) return "w";
  if (right) return "e";
  return null;
}

const edgeCursors: Record<string, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

export function ChatPanel({ messages, onSendMessage, onCollapse }: ChatPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const minRight = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;

  const sessions = useAgentBubbleStore((s) => s.sessions);
  const activeSessionId = useAgentBubbleStore((s) => s.activeSessionId);
  const newSession = useAgentBubbleStore((s) => s.newSession);
  const switchSession = useAgentBubbleStore((s) => s.switchSession);
  const deleteSession = useAgentBubbleStore((s) => s.deleteSession);
  const [showSessionList, setShowSessionList] = useState(false);
  const sessionListRef = useRef<HTMLDivElement>(null);

  // Close session list on outside click
  useEffect(() => {
    if (!showSessionList) return;
    const handler = (e: MouseEvent) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node)) {
        setShowSessionList(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSessionList]);

  const [size, setSize] = useState({ w: INITIAL_WIDTH, h: INITIAL_HEIGHT });
  // Position: bottom-right anchor (distance from bottom and right edges of viewport)
  const [pos, setPos] = useState(() =>
    clampPos(128, 16, INITIAL_WIDTH, INITIAL_HEIGHT, rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH),
  );

  // ESC to collapse — only when focus is inside the panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!panelRef.current?.contains(document.activeElement)) return;
      e.stopPropagation();
      e.preventDefault();
      onCollapse();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onCollapse]);

  // Reclamp position on window resize
  useEffect(() => {
    const onResize = () => {
      setPos((p) => clampPos(p.bottom, p.right, size.w, size.h, minRight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size, minRight]);

  // Drag by header
  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;
      const startPos = { ...pos };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        setPos(
          clampPos(startPos.bottom - dy, startPos.right - dx, size.w, size.h, minRight),
        );
      };
      const cleanup = (ev: PointerEvent) => {
        try { el.releasePointerCapture(ev.pointerId); } catch {}
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", cleanup);
        el.removeEventListener("pointercancel", cleanup);
        el.removeEventListener("lostpointercapture", cleanup);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", cleanup);
      el.addEventListener("pointercancel", cleanup);
      el.addEventListener("lostpointercapture", cleanup);
    },
    [pos, size, minRight],
  );

  // Resize by edges
  const handlePanelPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const edge = getEdge(rect, e.clientX, e.clientY);
      if (!edge) return;

      e.preventDefault();
      e.stopPropagation();
      panel.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = { ...size };
      const startPos = { ...pos };

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let newW = startSize.w;
        let newH = startSize.h;
        let newRight = startPos.right;
        let newBottom = startPos.bottom;

        if (edge.includes("e")) {
          newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startSize.w + dx));
          // expanding east means moving the left edge, but we anchor right, so adjust right
          newRight = Math.max(0, startPos.right - (newW - startSize.w));
        }
        if (edge.includes("w")) {
          newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startSize.w - dx));
        }
        if (edge.includes("s")) {
          newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startSize.h + dy));
          // expanding south means moving the bottom edge down
          newBottom = Math.max(0, startPos.bottom - (newH - startSize.h));
        }
        if (edge.includes("n")) {
          newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startSize.h - dy));
        }

        setSize({ w: newW, h: newH });
        const clamped = clampPos(newBottom, newRight, newW, newH, minRight);
        setPos(clamped);
      };

      const cleanup = (ev: PointerEvent) => {
        try { panel.releasePointerCapture(ev.pointerId); } catch {}
        panel.removeEventListener("pointermove", onMove);
        panel.removeEventListener("pointerup", cleanup);
        panel.removeEventListener("pointercancel", cleanup);
        panel.removeEventListener("lostpointercapture", cleanup);
      };
      panel.addEventListener("pointermove", onMove);
      panel.addEventListener("pointerup", cleanup);
      panel.addEventListener("pointercancel", cleanup);
      panel.addEventListener("lostpointercapture", cleanup);
    },
    [size, pos, minRight],
  );

  // Update cursor on mouse move over panel edges
  const handlePanelPointerMove = useCallback((e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    // Skip cursor updates during active pointer capture (drag/resize in progress)
    if (panel.hasPointerCapture(e.pointerId)) return;
    const rect = panel.getBoundingClientRect();
    const edge = getEdge(rect, e.clientX, e.clientY);
    panel.style.cursor = edge ? edgeCursors[edge] : "";
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed z-[95] panel flex flex-col"
      style={{
        width: size.w,
        height: size.h,
        bottom: pos.bottom,
        right: pos.right,
      }}
      onPointerDown={handlePanelPointerDown}
      onPointerMove={handlePanelPointerMove}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={handleHeaderPointerDown}
      >
        <div className="flex items-center gap-1.5 relative" ref={sessionListRef}>
          {/* Session list toggle */}
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
            onClick={() => setShowSessionList((v) => !v)}
            title="Chat history"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>
          <span className="text-[13px] font-medium text-[var(--text-primary)]">
            Agent
          </span>

          {/* Session list dropdown */}
          {showSessionList && (
            <div className="absolute top-full left-0 mt-1 w-56 max-h-64 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg z-10">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer transition-colors duration-100 group ${
                    s.id === activeSessionId
                      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                  }`}
                  onClick={() => {
                    switchSession(s.id);
                    setShowSessionList(false);
                  }}
                >
                  <span className="flex-1 min-w-0 truncate">{s.title}</span>
                  <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
                    {s.messages.length}
                  </span>
                  {sessions.length > 1 && (
                    <button
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--danger,#e55)] transition-opacity duration-100 p-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(s.id);
                      }}
                      title="Delete"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* New chat button */}
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
            onClick={newSession}
            title="New chat"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          {/* Close button */}
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
            onClick={onCollapse}
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
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Input */}
      <MessageInput onSend={onSendMessage} autoFocus />
    </div>
  );
}
