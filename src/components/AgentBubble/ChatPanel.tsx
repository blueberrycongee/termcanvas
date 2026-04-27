import { useCallback, useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { BubbleMessage } from "./types";
import {
  useCanvasStore,
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
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const minRight = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : rightPanelWidth;

  const sessions = useAgentBubbleStore((s) => s.sessions);
  const activeSessionId = useAgentBubbleStore((s) => s.activeSessionId);
  const newSession = useAgentBubbleStore((s) => s.newSession);
  const switchSession = useAgentBubbleStore((s) => s.switchSession);
  const deleteSession = useAgentBubbleStore((s) => s.deleteSession);
  const tabBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = tabBarRef.current;
    if (!container) return;
    const active = container.querySelector("[data-active-tab]") as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [activeSessionId]);

  const [size, setSize] = useState({ w: INITIAL_WIDTH, h: INITIAL_HEIGHT });
  const [pos, setPos] = useState(() =>
    clampPos(128, 16, INITIAL_WIDTH, INITIAL_HEIGHT, rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : rightPanelWidth),
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

  useEffect(() => {
    const onResize = () => {
      setPos((p) => clampPos(p.bottom, p.right, size.w, size.h, minRight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size, minRight]);

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
          newRight = Math.max(0, startPos.right - (newW - startSize.w));
        }
        if (edge.includes("w")) {
          newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startSize.w - dx));
        }
        if (edge.includes("s")) {
          newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startSize.h + dy));
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

  const handlePanelPointerMove = useCallback((e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    if (panel.hasPointerCapture(e.pointerId)) return;
    const rect = panel.getBoundingClientRect();
    const edge = getEdge(rect, e.clientX, e.clientY);
    panel.style.cursor = edge ? edgeCursors[edge] : "";
  }, []);

  return (
    <div
      ref={panelRef}
      className="fixed z-[95] panel flex flex-col tc-enter-fade-up"
      style={{
        width: size.w,
        height: size.h,
        bottom: pos.bottom,
        right: pos.right,
        boxShadow:
          "0 12px 32px color-mix(in srgb, var(--shadow-color) 32%, transparent), 0 2px 6px color-mix(in srgb, var(--shadow-color) 18%, transparent)",
      }}
      onPointerDown={handlePanelPointerDown}
      onPointerMove={handlePanelPointerMove}
    >
      <div
        className="flex items-center border-b border-[var(--border)] cursor-grab active:cursor-grabbing select-none shrink-0"
        onPointerDown={handleHeaderPointerDown}
      >
        <div
          ref={tabBarRef}
          className="flex-1 min-w-0 flex items-center overflow-x-auto px-1.5 py-1.5 gap-0.5"
          style={{ scrollbarWidth: "none" }}
        >
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                data-active-tab={isActive ? "" : undefined}
                className="group flex items-center gap-1 shrink-0 max-w-[140px] rounded px-2 py-1 tc-label"
                style={{
                  background: isActive ? "var(--surface-hover)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: isActive ? "var(--weight-medium)" : "var(--weight-regular)",
                  transition:
                    "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
                }}
                onMouseEnter={(e) => {
                  if (isActive) return;
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "color-mix(in srgb, var(--surface-hover) 50%, transparent)";
                  el.style.color = "var(--text-secondary)";
                }}
                onMouseLeave={(e) => {
                  if (isActive) return;
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "transparent";
                  el.style.color = "var(--text-muted)";
                }}
                onClick={() => switchSession(s.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    deleteSession(s.id);
                  }
                }}
                title={s.title}
              >
                <span className="truncate">{s.title}</span>
                {sessions.length > 1 && (
                  <span
                    className="shrink-0 opacity-0 group-hover:opacity-100 ml-0.5"
                    style={{ transition: "opacity var(--duration-quick) var(--ease-out-soft)" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                    }}
                  >
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-0.5 px-1.5 shrink-0">
          <button
            className="p-1 rounded"
            style={{
              color: "var(--text-faint)",
              transition:
                "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "var(--surface-hover)";
              el.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "transparent";
              el.style.color = "var(--text-faint)";
            }}
            onClick={newSession}
            title="New chat"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <button
            className="p-1 rounded"
            style={{
              color: "var(--text-faint)",
              transition:
                "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "var(--surface-hover)";
              el.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "transparent";
              el.style.color = "var(--text-faint)";
            }}
            onClick={onCollapse}
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <MessageList messages={messages} />

      <MessageInput
        onSend={onSendMessage}
        onAbort={() => window.termcanvas.agent.abort(activeSessionId)}
        streaming={useAgentBubbleStore((s) => s.streaming)}
        autoFocus
      />
    </div>
  );
}
