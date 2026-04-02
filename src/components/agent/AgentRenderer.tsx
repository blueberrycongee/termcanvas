import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStreamEvent } from "../../types";
import { useThemeStore } from "../../stores/themeStore";
import { MessageBubble } from "./MessageBubble";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";
import { AgentInputBox } from "./AgentInputBox";
import { AgentStatusBar } from "./AgentStatusBar";

interface ThinkingSegment {
  kind: "thinking";
  text: string;
  streaming: boolean;
}

interface TextSegment {
  kind: "text";
  text: string;
}

interface ToolSegment {
  kind: "tool";
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  approval?: { requestId: string };
}

type MessageSegment = ThinkingSegment | TextSegment | ToolSegment;

interface ErrorBanner {
  id: number;
  message: string;
}

interface StatusInfo {
  model?: string;
  toolsCount?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  numTurns?: number;
}

interface AgentRendererProps {
  terminalId: string;
  sessionId: string;
  height: number;
  width: number;
}

let errorIdCounter = 0;

export function AgentRenderer({ terminalId: _, sessionId, height, width }: AgentRendererProps) {
  const isDark = useThemeStore((s) => s.theme) === "dark";
  const [segments, setSegments] = useState<MessageSegment[]>([]);
  const [running, setRunning] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number } | null>(null);
  const [errors, setErrors] = useState<ErrorBanner[]>([]);
  const [statusInfo, setStatusInfo] = useState<StatusInfo>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const autoScrollRef = useRef(true);
  const lastSegmentRef = useRef<"text" | "thinking" | "tool" | null>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  useEffect(() => {
    if (!window.termcanvas?.agent) return;

    const unsubscribe = window.termcanvas.agent.onEvent(
      (evtSessionId: string, event: AgentStreamEvent) => {
        if (evtSessionId !== sessionId) return;
        handleEvent(event);
      },
    );
    return unsubscribe;
  }, [sessionId]);

  const handleEvent = useCallback((event: AgentStreamEvent) => {
    switch (event.type) {
      case "stream_start":
        setRunning(true);
        setSegments([]);
        setErrors([]);
        lastSegmentRef.current = null;
        break;

      case "stream_end":
        setRunning(false);
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming ? { ...s, streaming: false } : s,
          ),
        );
        break;

      case "text_delta":
        if (!autoScrollRef.current) setHasNewMessages(true);
        setSegments((prev) => {
          if (lastSegmentRef.current === "text" && prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last.kind === "text") {
              return [...prev.slice(0, -1), { ...last, text: last.text + event.text }];
            }
          }
          lastSegmentRef.current = "text";
          return [...prev, { kind: "text", text: event.text }];
        });
        break;

      case "thinking_delta":
        setSegments((prev) => {
          if (lastSegmentRef.current === "thinking" && prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last.kind === "thinking") {
              return [...prev.slice(0, -1), { ...last, text: last.text + event.thinking }];
            }
          }
          lastSegmentRef.current = "thinking";
          return [...prev, { kind: "thinking", text: event.thinking, streaming: true }];
        });
        break;

      case "tool_use_start":
        if (!autoScrollRef.current) setHasNewMessages(true);
        lastSegmentRef.current = "tool";
        setSegments((prev) => [
          ...prev,
          { kind: "tool", id: event.id, name: event.name, input: {} },
        ]);
        break;

      case "tool_start":
        setSegments((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].kind === "tool" && (prev[i] as ToolSegment).name === event.name) {
              const updated = [...prev];
              updated[i] = { ...(prev[i] as ToolSegment), input: event.input };
              return updated;
            }
          }
          return prev;
        });
        break;

      case "tool_end":
        setSegments((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].kind === "tool" && (prev[i] as ToolSegment).name === event.name) {
              const updated = [...prev];
              updated[i] = {
                ...(prev[i] as ToolSegment),
                result: event.content,
                isError: event.is_error,
              };
              return updated;
            }
          }
          return prev;
        });
        break;

      case "approval_request":
        lastSegmentRef.current = "tool";
        setSegments((prev) => [
          ...prev,
          {
            kind: "tool",
            id: event.request_id,
            name: event.tool_name,
            input: event.tool_input,
            approval: { requestId: event.request_id },
          },
        ]);
        break;

      case "message_start":
        if (event.usage) {
          setTokenUsage((prev) => ({
            input: (prev?.input ?? 0) + event.usage!.input_tokens,
            output: (prev?.output ?? 0) + event.usage!.output_tokens,
          }));
        }
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming ? { ...s, streaming: false } : s,
          ),
        );
        lastSegmentRef.current = null;
        break;

      case "message_delta":
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming ? { ...s, streaming: false } : s,
          ),
        );
        lastSegmentRef.current = null;
        break;

      case "error":
        setErrors((prev) => [...prev, { id: ++errorIdCounter, message: event.error.message }]);
        setRunning(false);
        break;

      case "system_init":
        setStatusInfo((prev) => ({
          ...prev,
          model: event.model,
          toolsCount: event.tools_count,
        }));
        break;

      case "result_info":
        setStatusInfo((prev) => ({
          ...prev,
          costUsd: event.cost_usd,
          inputTokens: event.input_tokens,
          outputTokens: event.output_tokens,
          durationMs: event.duration_ms,
          numTurns: event.num_turns,
        }));
        break;

      case "turn_start":
      case "turn_end":
        break;
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [segments]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
    setUserScrolledUp(!atBottom);
    if (atBottom) setHasNewMessages(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    autoScrollRef.current = true;
    setUserScrolledUp(false);
    setHasNewMessages(false);
  }, []);

  const dismissError = useCallback((id: number) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      if (!window.termcanvas?.agent) return;
      window.termcanvas.agent.send(sessionId, text, {
        type: "claude-code",
        baseURL: "",
        apiKey: "",
        model: "",
      });
    },
    [sessionId],
  );

  const handleAbort = useCallback(() => {
    if (!window.termcanvas?.agent) return;
    window.termcanvas.agent.abort(sessionId);
  }, [sessionId]);

  const handleApprove = useCallback(
    (sid: string, requestId: string) => {
      window.termcanvas?.agent?.approve(sid, requestId);
    },
    [],
  );

  const handleDeny = useCallback(
    (sid: string, requestId: string) => {
      window.termcanvas?.agent?.deny(sid, requestId);
    },
    [],
  );

  return (
    <div
      className={`flex flex-col overflow-hidden ${isDark ? "bg-zinc-900 text-zinc-100" : "bg-white text-zinc-900"}`}
      style={{ height, width }}
    >
      <AgentStatusBar
        generating={running}
        tokenUsage={tokenUsage}
        model={statusInfo.model}
        costUsd={statusInfo.costUsd}
        durationMs={statusInfo.durationMs}
        isDark={isDark}
      />

      {/* Scrollable message area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div className="px-4 py-3 space-y-1">
          {segments.map((seg, i) => {
            switch (seg.kind) {
              case "text":
                return <MessageBubble key={i} text={seg.text} isDark={isDark} />;
              case "thinking":
                return <ThinkingBlock key={i} text={seg.text} streaming={seg.streaming} isDark={isDark} />;
              case "tool":
                return (
                  <ToolCard
                    key={seg.id}
                    name={seg.name}
                    input={seg.input}
                    result={seg.result}
                    isError={seg.isError}
                    approval={seg.approval ? { requestId: seg.approval.requestId, sessionId } : undefined}
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                    isDark={isDark}
                  />
                );
            }
          })}
          {segments.length === 0 && !running && (
            <div className={`flex items-center justify-center h-32 text-sm ${isDark ? "text-zinc-600" : "text-zinc-400"}`}>
              Send a message to start
            </div>
          )}
        </div>
      </div>

      {/* Error banners */}
      {errors.length > 0 && (
        <div className="shrink-0 px-3 space-y-1">
          {errors.map((err) => (
            <div
              key={err.id}
              className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-xs"
            >
              <span className="flex-1 min-w-0 break-words">{err.message}</span>
              <button
                className="shrink-0 hover:text-red-300 transition-colors duration-150"
                onClick={() => dismissError(err.id)}
                aria-label="Dismiss error"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Scroll to bottom / new messages */}
      {userScrolledUp && (
        <div className="relative shrink-0">
          <button
            className={`absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs shadow-lg transition-colors duration-150 ${
              isDark
                ? "bg-zinc-700/80 text-zinc-300 hover:bg-zinc-600/90"
                : "bg-zinc-200/80 text-zinc-700 hover:bg-zinc-300/90"
            } backdrop-blur-sm`}
            onClick={scrollToBottom}
          >
            {hasNewMessages ? "New messages" : "Scroll to bottom"}
          </button>
        </div>
      )}

      <AgentInputBox
        running={running}
        onSend={handleSend}
        onAbort={handleAbort}
        isDark={isDark}
      />
    </div>
  );
}
