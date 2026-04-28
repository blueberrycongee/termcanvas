import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStreamEvent } from "../../types";
import { useThemeStore } from "../../stores/themeStore";
import { useTerminalRuntimeStateStore } from "../../stores/terminalRuntimeStateStore";
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

interface UserSegment {
  kind: "user";
  text: string;
}

type MessageSegment = ThinkingSegment | TextSegment | ToolSegment | UserSegment;

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
  resumeSessionId?: string;
  projectId: string;
  worktreeId: string;
  cwd: string;
  height: number;
  width: number;
}

let errorIdCounter = 0;

export function AgentRenderer({
  terminalId,
  sessionId,
  resumeSessionId,
  projectId,
  worktreeId,
  cwd,
  height,
  width,
}: AgentRendererProps) {
  const isDark = useThemeStore((s) => s.theme) === "dark";
  const [segments, setSegments] = useState<MessageSegment[]>([]);
  const [running, setRunning] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<{
    input: number;
    output: number;
  } | null>(null);
  const [errors, setErrors] = useState<ErrorBanner[]>([]);
  const [statusInfo, setStatusInfo] = useState<StatusInfo>({});
  const [slashCommands, setSlashCommands] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const autoScrollRef = useRef(true);
  const lastSegmentRef = useRef<"text" | "thinking" | "tool" | null>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const startedRef = useRef(false);

  const handleEvent = useCallback((event: AgentStreamEvent) => {
    switch (event.type) {
      case "stream_start":
        setRunning(true);
        setErrors([]);
        lastSegmentRef.current = null;
        break;

      case "stream_end":
        setRunning(false);
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming
              ? { ...s, streaming: false }
              : s,
          ),
        );
        break;

      case "text_delta":
        if (!autoScrollRef.current) setHasNewMessages(true);
        setSegments((prev) => {
          if (lastSegmentRef.current === "text" && prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last.kind === "text") {
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + event.text },
              ];
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
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + event.thinking },
              ];
            }
          }
          lastSegmentRef.current = "thinking";
          return [
            ...prev,
            { kind: "thinking", text: event.thinking, streaming: true },
          ];
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
            if (
              prev[i].kind === "tool" &&
              (prev[i] as ToolSegment).name === event.name
            ) {
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
            if (
              prev[i].kind === "tool" &&
              (prev[i] as ToolSegment).name === event.name
            ) {
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
            s.kind === "thinking" && s.streaming
              ? { ...s, streaming: false }
              : s,
          ),
        );
        lastSegmentRef.current = null;
        break;

      case "message_delta":
        setSegments((prev) =>
          prev.map((s) =>
            s.kind === "thinking" && s.streaming
              ? { ...s, streaming: false }
              : s,
          ),
        );
        lastSegmentRef.current = null;
        break;

      case "error":
        setErrors((prev) => [
          ...prev,
          { id: ++errorIdCounter, message: event.error.message },
        ]);
        setRunning(false);
        break;

      case "system_init":
        setStatusInfo((prev) => ({
          ...prev,
          model: event.model,
          toolsCount: event.tools_count,
        }));
        if (event.slash_commands) {
          setSlashCommands(event.slash_commands);
        }
        if (event.session_id) {
          useTerminalRuntimeStateStore
            .getState()
            .setSessionId(terminalId, event.session_id);
        }
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

  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!window.termcanvas?.agent) return;

    if (!startedRef.current) {
      startedRef.current = true;
      window.termcanvas.agent
        .start(sessionId, {
          type: "claude-code",
          baseURL: "",
          apiKey: "",
          model: "",
          cwd,
          resumeSessionId,
        })
        .then((result) => {
          if (result?.slashCommands?.length) {
            setSlashCommands(result.slashCommands);
          }
        })
        .catch(() => {});
    }

    if (!subscribedRef.current) {
      subscribedRef.current = true;
      window.termcanvas.agent.onEvent(
        (evtSessionId: string, event: AgentStreamEvent) => {
          if (evtSessionId !== sessionIdRef.current) return;
          if (
            event.type === "system_init" &&
            "slash_commands" in event &&
            Array.isArray(event.slash_commands)
          ) {
            setSlashCommands(event.slash_commands as string[]);
          }
          handleEventRef.current(event);
        },
      );
    }
  }, [sessionId, cwd, resumeSessionId]);

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
      setSegments((prev) => [...prev, { kind: "user", text }]);
      lastSegmentRef.current = null;
      window.termcanvas.agent.send(sessionId, text, {
        type: "claude-code",
        baseURL: "",
        apiKey: "",
        model: "",
        cwd,
        resumeSessionId,
      });
    },
    [sessionId],
  );

  const handleAbort = useCallback(() => {
    if (!window.termcanvas?.agent) return;
    window.termcanvas.agent.abort(sessionId);
  }, [sessionId]);

  const handleApprove = useCallback((sid: string, requestId: string) => {
    window.termcanvas?.agent?.approve(sid, requestId);
  }, []);

  const handleDeny = useCallback((sid: string, requestId: string) => {
    window.termcanvas?.agent?.deny(sid, requestId);
  }, []);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        height,
        width,
        background: "var(--bg)",
        color: "var(--text-primary)",
      }}
    >
      <AgentStatusBar
        generating={running}
        tokenUsage={tokenUsage}
        model={statusInfo.model}
        costUsd={statusInfo.costUsd}
        durationMs={statusInfo.durationMs}
        isDark={isDark}
      />

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div className="mx-auto max-w-[720px] px-4 py-4">
          {segments.map((seg, i) => {
            switch (seg.kind) {
              case "user":
                /* Right-aligned neutral bubble. --bubble-bg matches the
                   replay-view convention (lifted neutral surface, NOT
                   accent fill) so a turn full of prompts reads as quiet
                   containers, not stacked accent highlights. */
                return (
                  <div
                    key={`seg-${i}`}
                    className="my-2 flex justify-end tc-enter-fade-up-quick"
                  >
                    <div
                      className="tc-body-sm rounded-xl px-3 py-2 whitespace-pre-wrap max-w-[78%]"
                      style={{
                        background: "var(--bubble-bg)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {seg.text}
                    </div>
                  </div>
                );
              case "text":
                /* Assistant prose: pl-5 indent, no chrome. The indent is
                   the speaker mark; no avatar, no eyebrow, no badge. */
                return (
                  <div
                    key={`seg-${i}`}
                    className="pl-5 pr-1 py-1 tc-enter-fade-quick"
                  >
                    <MessageBubble text={seg.text} isDark={isDark} />
                  </div>
                );
              case "thinking":
                /* Subordinate to assistant prose — deeper indent (pl-9)
                   matches the SessionReplayView ThinkingRow vocabulary. */
                return (
                  <div
                    key={`seg-${i}`}
                    className="pl-9 pr-1 tc-enter-fade-quick"
                  >
                    <ThinkingBlock
                      text={seg.text}
                      streaming={seg.streaming}
                      isDark={isDark}
                    />
                  </div>
                );
              case "tool":
                return (
                  <div key={seg.id} className="pl-9 pr-1 tc-enter-fade-quick">
                    <ToolCard
                      name={seg.name}
                      input={seg.input}
                      result={seg.result}
                      isError={seg.isError}
                      approval={
                        seg.approval
                          ? { requestId: seg.approval.requestId, sessionId }
                          : undefined
                      }
                      onApprove={handleApprove}
                      onDeny={handleDeny}
                      isDark={isDark}
                    />
                  </div>
                );
            }
          })}
          {segments.length === 0 && !running && (
            <div
              className="tc-label flex items-center justify-center h-32"
              style={{ color: "var(--text-faint)" }}
            >
              Send a message to start
            </div>
          )}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="shrink-0 px-3 space-y-1 pb-1">
          {errors.map((err) => (
            <div
              key={err.id}
              className="flex items-start gap-2 px-3 py-2 rounded-md tc-label tc-enter-fade-up-quick"
              style={{
                background: "var(--red-soft)",
                border:
                  "1px solid color-mix(in srgb, var(--red) 30%, transparent)",
                color: "var(--red)",
              }}
            >
              <span className="flex-1 min-w-0 break-words">{err.message}</span>
              <button
                className="shrink-0"
                onClick={() => dismissError(err.id)}
                aria-label="Dismiss error"
                style={{
                  transition:
                    "opacity var(--duration-quick) var(--ease-out-soft)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.opacity = "0.7")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.opacity = "1")
                }
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {userScrolledUp && (
        <div className="relative shrink-0">
          <button
            className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 h-7 rounded-full tc-label backdrop-blur-md tc-enter-fade-up-quick"
            style={{
              background: "color-mix(in srgb, var(--surface) 86%, transparent)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              boxShadow:
                "0 4px 14px color-mix(in srgb, var(--shadow-color) 28%, transparent)",
              transition:
                "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
            }}
            onClick={scrollToBottom}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "var(--surface)";
              el.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background =
                "color-mix(in srgb, var(--surface) 86%, transparent)";
              el.style.color = "var(--text-secondary)";
            }}
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
        slashCommands={slashCommands}
      />
    </div>
  );
}
