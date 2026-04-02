import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStreamEvent } from "../../types";
import { MessageBubble } from "./MessageBubble";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";
import { AgentInputBox } from "./AgentInputBox";
import { AgentStatusBar } from "./AgentStatusBar";

// Internal message model accumulated from stream events
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

interface AgentRendererProps {
  terminalId: string;
  sessionId: string;
  height: number;
  width: number;
}

export function AgentRenderer({ terminalId: _, sessionId, height, width }: AgentRendererProps) {
  const [segments, setSegments] = useState<MessageSegment[]>([]);
  const [running, setRunning] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const autoScrollRef = useRef(true);
  const lastSegmentRef = useRef<"text" | "thinking" | "tool" | null>(null);

  // Subscribe to agent events
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
        lastSegmentRef.current = null;
        break;

      case "stream_end":
        setRunning(false);
        // Mark any streaming thinking as done
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming ? { ...s, streaming: false } : s,
          ),
        );
        break;

      case "text_delta":
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
        lastSegmentRef.current = "tool";
        setSegments((prev) => [
          ...prev,
          { kind: "tool", id: event.id, name: event.name, input: {} },
        ]);
        break;

      case "tool_start":
        setSegments((prev) => {
          // Update the last tool segment with input
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
        // Close any streaming thinking from previous message
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming ? { ...s, streaming: false } : s,
          ),
        );
        lastSegmentRef.current = null;
        break;

      case "message_delta":
        // Turn ended, finalize thinking
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming ? { ...s, streaming: false } : s,
          ),
        );
        lastSegmentRef.current = null;
        break;

      case "error":
        lastSegmentRef.current = "text";
        setSegments((prev) => [
          ...prev,
          { kind: "text", text: `Error: ${event.error.message}` },
        ]);
        setRunning(false);
        break;

      case "turn_start":
      case "turn_end":
        break;
    }
  }, []);

  // Auto-scroll logic
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
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    autoScrollRef.current = true;
    setUserScrolledUp(false);
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
      className="flex flex-col bg-zinc-900 text-zinc-100 overflow-hidden"
      style={{ height, width }}
    >
      <AgentStatusBar generating={running} tokenUsage={tokenUsage} />

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
                return <MessageBubble key={i} text={seg.text} />;
              case "thinking":
                return <ThinkingBlock key={i} text={seg.text} streaming={seg.streaming} />;
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
                  />
                );
            }
          })}
          {segments.length === 0 && !running && (
            <div className="flex items-center justify-center h-32 text-zinc-600 text-sm">
              Send a message to start
            </div>
          )}
        </div>
      </div>

      {/* Scroll to bottom indicator */}
      {userScrolledUp && running && (
        <button
          className="absolute bottom-16 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-zinc-700 text-zinc-300 text-xs shadow-lg hover:bg-zinc-600 transition-colors duration-150"
          onClick={scrollToBottom}
        >
          Scroll to bottom
        </button>
      )}

      <AgentInputBox
        running={running}
        onSend={handleSend}
        onAbort={handleAbort}
      />
    </div>
  );
}
