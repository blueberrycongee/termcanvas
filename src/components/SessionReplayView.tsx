import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { marked } from "marked";
import { useSessionStore } from "../stores/sessionStore";
import { useT } from "../i18n/useT";
import type { TimelineEvent } from "../../shared/sessions";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";
import { createTerminalInScene } from "../actions/terminalSceneActions";
import { createTerminal } from "../stores/projectStore";
import { panToTerminal } from "../utils/panToTerminal";
import type { TerminalType } from "../types";

// Claude and Codex both emit markdown in their user-facing prose.
// Rendering it as literal whitespace-preserved text turned headings,
// code fences, bullet lists and inline code into wall-of-text noise.
// `marked` is already a dependency (also used by LeftPanel's preview),
// so we reuse it for the transcript. Synchronous parse keeps the
// render path simple — no suspense boundaries, no loading flashes.
const markdownClassName =
  "prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed text-[var(--text-primary)] " +
  "[&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 " +
  "[&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 " +
  "[&_p]:my-1.5 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 " +
  "[&_a]:text-[var(--accent)] [&_a]:cursor-pointer " +
  "[&_code]:text-[var(--amber)] [&_code]:bg-[var(--bg)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] " +
  "[&_pre]:bg-[var(--bg)] [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:text-[11px] [&_pre]:overflow-x-auto " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-hover)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-muted)] " +
  "[&_hr]:border-[var(--border)]";

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false, breaks: true }) as string;
}

/*
 * Replay as a chat transcript.
 *
 * Old design: every event was rendered as a uniform 10 px sidebar
 * row (user prompts, assistant prose, tool calls, tool results,
 * thinking — all at the same visual weight). Reading a real
 * conversation end-to-end was miserable because the actual dialog
 * was buried in a wall of identically-sized telemetry lines.
 *
 * New design prioritizes what a human reading back a session cares
 * about most (topic → own questions → agent replies → tool noise,
 * in that order):
 *
 *   Layer 1 — Topic header.
 *     First user prompt promoted to a big title; meta line beneath.
 *     The first thing on screen answers "what is this conversation
 *     about?" without any scrolling.
 *
 *   Layer 2 — Chat body.
 *     User prompts:  accent-bordered left rail, prose-sized text,
 *                    no timestamp clutter on the same line.
 *     Assistant text: plain prose, clear separation from tools.
 *     Tool calls:    single-line collapsed pills (verb + brief
 *                    subject + optional file path). Click to expand
 *                    input + output. Default COLLAPSED so they
 *                    don't chop up the prose flow.
 *     tool_result:   never a top-level row; appears only inside its
 *                    parent tool pill's expanded detail.
 *     thinking:      hidden by default behind a toggle.
 *
 *   Layer 3 — Playback footer.
 *     Thin progress bar + compact play/pause/seek + speed + show-
 *     details toggle. Demoted from "primary UI" to "occasional tool".
 *
 * The existing currentIndex / isPlaying / seekTo state machine is
 * preserved — this is a presentational rewrite, not a state model
 * change. currentIndex highlights whichever rendered block contains
 * it (user bubble, tool pill, assistant text block, etc.) and auto-
 * scrolls during playback.
 */

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatRelativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function projectName(projectDir: string): string {
  const normalized = projectDir.replace(/\\/g, "/");
  if (normalized.includes("/")) {
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || projectDir;
  }
  return projectDir.replace(/^-/, "").split("-").pop() || projectDir;
}

/**
 * Infer the agent provider ("claude" | "codex" | …) from the path of
 * the session's JSONL file.
 */
function providerFromFilePath(filePath: string): TerminalType | null {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/.claude/")) return "claude";
  if (normalized.includes("/.codex/")) return "codex";
  return null;
}

/**
 * A single conversation turn. `userEvent` may be null for events
 * before the first user message (session headers, system setup).
 */
interface Turn {
  startIndex: number;
  userEvent: TimelineEvent | null;
  assistantEvents: TimelineEvent[];
}

/**
 * Logical assistant block — what we actually render in-flow inside a
 * turn.
 *
 * Tool runs are collected into a single group: Claude and Codex
 * typically emit N tool_use events followed by N tool_result events
 * (the agent batches calls, the harness returns them in order). An
 * earlier rendering emitted one "pill" per tool and one row per
 * result, which flooded the transcript with low-signal chrome and
 * buried the actual prose. The reader usually only cares that the
 * agent "did some lookups" — the specific tools are noise unless they
 * want to dig in. So we collapse the whole run into one block with a
 * count, and let the reader expand it to see individual calls (and
 * expand each call further to see input / output).
 *
 * Pairing tool_use → tool_result is done by position within the run
 * rather than by call_id because the existing TimelineEvent shape
 * doesn't carry call_ids; the interleaved pattern is stable enough
 * in practice that index-pairing yields the right grouping.
 */
interface ToolGroupItem {
  tool: TimelineEvent;
  result?: TimelineEvent;
}

interface AssistantNode {
  type: "text" | "thinking" | "tool_group" | "error";
  index: number;
  primary: TimelineEvent;
  items?: ToolGroupItem[];
}

function buildTurns(events: TimelineEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const event of events) {
    if (event.type === "user_prompt") {
      if (current) turns.push(current);
      current = {
        startIndex: event.index,
        userEvent: event,
        assistantEvents: [],
      };
    } else {
      if (!current) {
        current = {
          startIndex: event.index,
          userEvent: null,
          assistantEvents: [],
        };
      }
      current.assistantEvents.push(event);
    }
  }
  if (current) turns.push(current);
  return turns;
}

function buildAssistantNodes(events: TimelineEvent[]): AssistantNode[] {
  const nodes: AssistantNode[] = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i];

    if (ev.type === "tool_use" || ev.type === "tool_result") {
      // Greedily consume the contiguous tool run (any mix of
      // tool_use / tool_result events) into one group node. Pair the
      // k-th tool_use with the k-th tool_result within the run.
      const tools: TimelineEvent[] = [];
      const results: TimelineEvent[] = [];
      let j = i;
      while (j < events.length) {
        const e = events[j];
        if (e.type === "tool_use") tools.push(e);
        else if (e.type === "tool_result") results.push(e);
        else break;
        j += 1;
      }
      if (tools.length > 0) {
        const items: ToolGroupItem[] = tools.map((tool, k) => ({
          tool,
          result: results[k],
        }));
        nodes.push({
          type: "tool_group",
          index: tools[0].index,
          primary: tools[0],
          items,
        });
      }
      i = j;
      continue;
    }

    if (ev.type === "assistant_text") {
      nodes.push({ type: "text", index: ev.index, primary: ev });
    } else if (ev.type === "thinking") {
      nodes.push({ type: "thinking", index: ev.index, primary: ev });
    } else if (ev.type === "error") {
      nodes.push({ type: "error", index: ev.index, primary: ev });
    }
    // turn_complete is metadata, not content — dropped.
    i += 1;
  }
  return nodes;
}

function toolVerb(toolName: string | undefined): string {
  if (!toolName) return "Tool";
  // Claude tool names come Pascal-cased ("Read", "Edit", "Bash"),
  // codex as snake_case function names. Normalize lightly for display
  // without losing the identifier meaning.
  return toolName;
}

function toolSubjectHint(event: TimelineEvent): string {
  // Prefer the detected file path (most user-recognisable anchor),
  // fall back to the first line of the tool input preview.
  if (event.filePath) {
    return event.filePath.split(/[\\/]/).filter(Boolean).pop() ?? event.filePath;
  }
  if (event.textPreview) {
    const firstLine = event.textPreview.split("\n", 1)[0].trim();
    if (firstLine.length > 80) return firstLine.slice(0, 80) + "…";
    return firstLine;
  }
  return "";
}

/* ------------ Layer-1: topic header ------------------------------- */

function TopicHeader({
  topic,
  project,
  provider,
  age,
  messageCount,
  resumeDisabled,
  resumeTooltip,
  resumeLabel,
  onBack,
  onResume,
  backLabel,
}: {
  topic: string;
  project: string;
  provider: string;
  age: string;
  messageCount: number;
  resumeDisabled: boolean;
  resumeTooltip: string;
  resumeLabel: string;
  onBack: () => void;
  onResume: () => void;
  backLabel: string;
}) {
  return (
    <div className="shrink-0 border-b border-[var(--border)] px-3 py-3">
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          onClick={onBack}
          title={backLabel}
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
            <path
              d="M8 1L3 6l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          {/*
            Topic = first user prompt. line-clamp-2 keeps the header
            bounded even for wordy first turns; hover tooltip gives
            the full content if clamping hides the tail. 14 px prose
            with accent colour announces it as "the thing this
            conversation is about" without needing any chrome.
          */}
          <div
            className="text-[14px] font-medium leading-snug text-[var(--text-primary)] line-clamp-2"
            title={topic}
          >
            {topic || (
              <span className="italic text-[var(--text-muted)]">(no prompt captured)</span>
            )}
          </div>
          <div
            className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-faint)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            <span>{project}</span>
            <span>·</span>
            <span>{provider}</span>
            <span>·</span>
            <span>{age}</span>
            <span>·</span>
            <span>{messageCount} msgs</span>
          </div>
        </div>
        <button
          className="mt-0.5 shrink-0 inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            color: !resumeDisabled ? "var(--accent)" : "var(--text-muted)",
            backgroundColor: !resumeDisabled
              ? "color-mix(in srgb, var(--accent) 12%, transparent)"
              : "transparent",
          }}
          onClick={onResume}
          disabled={resumeDisabled}
          title={resumeTooltip}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 1l6 4-6 4V1z" fill="currentColor" />
          </svg>
          <span>{resumeLabel}</span>
        </button>
      </div>
    </div>
  );
}

/* ------------ Layer-2: chat content ------------------------------- */

function UserBubble({
  event,
  isCurrent,
  onClick,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="group w-full text-left block"
      onClick={onClick}
      data-current={isCurrent || undefined}
    >
      <div
        className="rounded-md border-l-[3px] px-3 py-2 transition-colors"
        style={{
          borderColor: isCurrent ? "var(--accent)" : "color-mix(in srgb, var(--accent) 40%, transparent)",
          backgroundColor: isCurrent
            ? "color-mix(in srgb, var(--accent) 8%, transparent)"
            : "color-mix(in srgb, var(--accent) 3%, transparent)",
        }}
      >
        <div
          className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider"
          style={{ fontFamily: '"Geist Mono", monospace', color: "var(--accent)" }}
        >
          <span>you</span>
          <span className="text-[var(--text-faint)] normal-case tracking-normal">
            {formatTimestamp(event.timestamp)}
          </span>
        </div>
        <div
          className={markdownClassName}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(event.textPreview) }}
        />
      </div>
    </button>
  );
}

function AssistantTextRow({
  event,
  isCurrent,
  onClick,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left"
      onClick={onClick}
      data-current={isCurrent || undefined}
    >
      <div
        className="rounded-md px-3 py-2 transition-colors"
        style={{
          backgroundColor: isCurrent
            ? "color-mix(in srgb, var(--text-muted) 10%, transparent)"
            : "transparent",
        }}
      >
        <div
          className={markdownClassName}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(event.textPreview) }}
        />
      </div>
    </button>
  );
}

function ThinkingRow({
  event,
  isCurrent,
  onClick,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left"
      onClick={onClick}
      data-current={isCurrent || undefined}
    >
      <div
        className="rounded-md px-3 py-1.5 transition-colors border-l-[2px]"
        style={{
          borderColor: "color-mix(in srgb, var(--text-muted) 40%, transparent)",
          backgroundColor: isCurrent
            ? "color-mix(in srgb, var(--text-muted) 6%, transparent)"
            : "transparent",
        }}
      >
        <div
          className="mb-0.5 text-[9px] uppercase tracking-wider text-[var(--text-faint)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          thinking
        </div>
        <div className="text-[12px] italic leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap break-words">
          {event.textPreview}
        </div>
      </div>
    </button>
  );
}

function summarizeToolNames(items: ToolGroupItem[]): string {
  // Build a "Read · Grep · Edit" style summary, collapsing duplicates
  // with a count. Cap at three distinct names to keep the pill header
  // on one line; the rest get folded into "+N more".
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const item of items) {
    const name = toolVerb(item.tool.toolName);
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const first = order.slice(0, 3).map((name) => {
    const c = counts.get(name) ?? 1;
    return c > 1 ? `${name} ×${c}` : name;
  });
  const rest = order.length - 3;
  if (rest > 0) first.push(`+${rest} more`);
  return first.join(" · ");
}

function ToolSubItem({
  item,
  isCurrent,
  expanded,
  onToggle,
  onClick,
}: {
  item: ToolGroupItem;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const verb = toolVerb(item.tool.toolName);
  const subject = toolSubjectHint(item.tool);
  return (
    <div
      className="rounded px-2 py-1 transition-colors"
      style={{
        backgroundColor: isCurrent
          ? "color-mix(in srgb, var(--accent) 6%, transparent)"
          : "transparent",
      }}
    >
      <button
        className="flex w-full items-center gap-1.5 text-left cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
          onToggle();
        }}
      >
        <span className="shrink-0 text-[9px] text-[var(--text-faint)]">
          {expanded ? "▾" : "▸"}
        </span>
        <span
          className="shrink-0 text-[10px] font-medium"
          style={{
            fontFamily: '"Geist Mono", monospace',
            color: "var(--text-secondary)",
          }}
        >
          {verb}
        </span>
        {subject && (
          <span
            className="truncate text-[10px] text-[var(--text-muted)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {subject}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 border-t border-[var(--border)] pt-1.5 pl-3">
          {item.tool.textPreview && (
            <div>
              <div
                className="mb-0.5 text-[9px] uppercase tracking-wider text-[var(--text-faint)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                input
              </div>
              <pre
                className="whitespace-pre-wrap break-words text-[11px] leading-snug text-[var(--text-secondary)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {item.tool.textPreview}
              </pre>
            </div>
          )}
          {item.result?.textPreview && (
            <div>
              <div
                className="mb-0.5 text-[9px] uppercase tracking-wider text-[var(--text-faint)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                output
              </div>
              <pre
                className="whitespace-pre-wrap break-words text-[11px] leading-snug text-[var(--text-secondary)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {item.result.textPreview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolGroup({
  node,
  currentIndex,
  expanded,
  onToggle,
  expandedItems,
  onToggleItem,
  onSeek,
}: {
  node: AssistantNode;
  currentIndex: number;
  expanded: boolean;
  onToggle: () => void;
  expandedItems: Set<number>;
  onToggleItem: (index: number) => void;
  onSeek: (index: number) => void;
}) {
  const items = node.items ?? [];
  const isGroupCurrent = items.some(
    (it) => it.tool.index === currentIndex || it.result?.index === currentIndex,
  );
  const count = items.length;
  const summary = count === 1
    ? `${toolVerb(items[0].tool.toolName)}${
        toolSubjectHint(items[0].tool) ? " " + toolSubjectHint(items[0].tool) : ""
      }`
    : summarizeToolNames(items);

  return (
    <div
      className="rounded-md border px-2 py-1.5 transition-colors"
      style={{
        borderColor: isGroupCurrent ? "var(--accent)" : "var(--border)",
        backgroundColor: isGroupCurrent
          ? "color-mix(in srgb, var(--accent) 6%, transparent)"
          : "color-mix(in srgb, var(--text-muted) 4%, transparent)",
      }}
      data-current={isGroupCurrent || undefined}
    >
      <button
        className="flex w-full items-center gap-1.5 text-left cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onSeek(node.index);
          onToggle();
        }}
      >
        <span className="shrink-0 text-[10px]" style={{ color: "#f59e0b" }}>
          {expanded ? "▾" : "▸"}
        </span>
        {count > 1 && (
          <span
            className="shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {count} tools
          </span>
        )}
        <span
          className="truncate text-[11px]"
          style={{
            fontFamily: '"Geist Mono", monospace',
            color: count === 1 ? "var(--text-primary)" : "var(--text-muted)",
            fontWeight: count === 1 ? 500 : 400,
          }}
        >
          {summary}
        </span>
        <span className="flex-1" />
        <span
          className="shrink-0 text-[9px] tabular-nums text-[var(--text-faint)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {formatTimestamp(node.primary.timestamp)}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-0.5 border-t border-[var(--border)] pt-2">
          {items.map((item) => {
            const isItemCurrent =
              item.tool.index === currentIndex ||
              item.result?.index === currentIndex;
            return (
              <ToolSubItem
                key={item.tool.index}
                item={item}
                isCurrent={isItemCurrent}
                expanded={expandedItems.has(item.tool.index)}
                onToggle={() => onToggleItem(item.tool.index)}
                onClick={() => onSeek(item.tool.index)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ErrorRow({
  event,
  isCurrent,
  onClick,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left"
      onClick={onClick}
      data-current={isCurrent || undefined}
    >
      <div
        className="rounded-md border px-2 py-1.5 transition-colors"
        style={{
          borderColor: "#ef4444",
          backgroundColor: "color-mix(in srgb, #ef4444 6%, transparent)",
        }}
      >
        <div
          className="mb-0.5 text-[9px] uppercase tracking-wider"
          style={{ fontFamily: '"Geist Mono", monospace', color: "#ef4444" }}
        >
          error
        </div>
        <div className="text-[12px] text-[var(--text-primary)] whitespace-pre-wrap break-words">
          {event.textPreview}
        </div>
      </div>
    </button>
  );
}

/* ------------ Main component -------------------------------------- */

const SPEEDS = [1, 2, 4, 8];

export function SessionReplayView() {
  const timeline = useSessionStore((s) => s.replayTimeline);
  const replayError = useSessionStore((s) => s.replayError);
  const currentIndex = useSessionStore((s) => s.replayCurrentIndex);
  const isPlaying = useSessionStore((s) => s.replayIsPlaying);
  const speed = useSessionStore((s) => s.replaySpeed);
  const exitReplay = useSessionStore((s) => s.exitReplay);
  const seekTo = useSessionStore((s) => s.seekTo);
  const stepForward = useSessionStore((s) => s.stepForward);
  const stepBackward = useSessionStore((s) => s.stepBackward);
  const togglePlayback = useSessionStore((s) => s.togglePlayback);
  const stopPlayback = useSessionStore((s) => s.stopPlayback);
  const setSpeed = useSessionStore((s) => s.setSpeed);
  const { notify } = useNotificationStore();
  const t = useT();

  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLElement | null>(null);

  // View toggles. Kept as local component state (not in the session
  // store) — they're purely ergonomic read-mode preferences, don't
  // need to round-trip through IPC or persist across sessions. Tool
  // pills stay collapsed by default even when "details" is on; the
  // toggle affects visibility of thinking rows only, plus it auto-
  // expands pills if the user flips it after already reading the
  // prose. Same design pattern as Slack's "show more" affordance.
  const [showThinking, setShowThinking] = useState(false);
  // Tool groups (the whole run) vs individual tool items inside an
  // expanded group have independent collapsed/expanded state. Keep
  // them in separate sets keyed by the first-tool's timeline index
  // so re-renders don't clobber one when toggling the other.
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleGroup = useCallback((index: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleTool = useCallback((index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const resumeTarget = useMemo(() => {
    if (!timeline) return null;
    const provider = providerFromFilePath(timeline.filePath);
    if (!provider) return null;
    const projects = useProjectStore.getState().projects;
    for (const project of projects) {
      for (const worktree of project.worktrees) {
        if (worktree.path === timeline.projectDir) {
          return {
            provider,
            projectId: project.id,
            worktreeId: worktree.id,
            sessionId: timeline.sessionId,
          };
        }
      }
    }
    return null;
  }, [timeline]);

  const handleResume = useCallback(() => {
    if (!resumeTarget) return;
    const base = createTerminal(resumeTarget.provider, undefined, undefined, undefined, "user");
    base.sessionId = resumeTarget.sessionId;

    const created = createTerminalInScene({
      projectId: resumeTarget.projectId,
      worktreeId: resumeTarget.worktreeId,
      terminal: base,
      origin: "user",
    });

    exitReplay();
    panToTerminal(created.id);
    notify(
      "info",
      (t.session_replay_resume_toast as unknown as string) ??
        `Resumed session in new ${resumeTarget.provider} terminal`,
    );
  }, [resumeTarget, exitReplay, notify, t]);

  // Scroll the current-highlighted element into view when it changes.
  // Applies to both click-seek and playback. Smooth scroll works well
  // for small gaps; large jumps fall back to "nearest" behaviour.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  useEffect(() => {
    if (!isPlaying || !timeline) return;
    const events = timeline.events;
    if (currentIndex >= events.length - 1) {
      stopPlayback();
      return;
    }
    const current = events[currentIndex];
    const next = events[currentIndex + 1];
    const realDelta = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
    const interval = Math.max(50, Math.min(2000, realDelta / speed));
    const timer = setTimeout(() => stepForward(), interval);
    return () => clearTimeout(timer);
  }, [isPlaying, currentIndex, speed, timeline, stepForward, stopPlayback]);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timeline) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      seekTo(Math.round(fraction * (timeline.events.length - 1)));
    },
    [timeline, seekTo],
  );

  const turns = useMemo(() => (timeline ? buildTurns(timeline.events) : []), [timeline]);

  // Loading / error panels — same shape as before.
  if (!timeline) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2">
        {replayError ? (
          <>
            <div className="text-[11px] text-[#ef4444]">{replayError}</div>
            <button
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              onClick={exitReplay}
            >
              {t.sessions_load_error_back}
            </button>
          </>
        ) : (
          <div className="text-[11px] text-[var(--text-faint)]">{t.sessions_loading}</div>
        )}
      </div>
    );
  }

  const topicEvent = timeline.events.find((e) => e.type === "user_prompt");
  const topic = topicEvent?.textPreview ?? "";
  const provider = providerFromFilePath(timeline.filePath) ?? "agent";
  const age = formatRelativeAge(timeline.startedAt || timeline.endedAt || "");
  const progress =
    timeline.events.length > 1 ? currentIndex / (timeline.events.length - 1) : 0;

  const assignCurrentRef = (
    el: HTMLElement | null,
    isCurrent: boolean,
  ) => {
    if (isCurrent && el) currentRef.current = el;
  };

  return (
    <div className="flex flex-col h-full">
      <TopicHeader
        topic={topic}
        project={projectName(timeline.projectDir)}
        provider={provider}
        age={age}
        messageCount={timeline.events.length}
        resumeDisabled={!resumeTarget}
        resumeTooltip={
          resumeTarget
            ? ((t.session_replay_resume_tooltip as unknown as string) ??
                `Resume in a new ${resumeTarget.provider} terminal (--resume ${resumeTarget.sessionId.slice(0, 8)})`)
            : ((t.session_replay_resume_unavailable as unknown as string) ??
                "Add this project to the canvas to resume")
        }
        resumeLabel={(t.session_replay_resume as unknown as string) ?? "Resume"}
        onBack={exitReplay}
        onResume={handleResume}
        backLabel={(t.sessions_load_error_back as unknown as string) ?? "Back"}
      />

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4"
      >
        {turns.map((turn, turnIdx) => {
          const nodes = buildAssistantNodes(turn.assistantEvents);
          return (
            <div
              key={`turn-${turn.startIndex}-${turnIdx}`}
              className="space-y-2"
            >
              {turn.userEvent && (
                <div
                  ref={(el) =>
                    assignCurrentRef(el, turn.userEvent!.index === currentIndex)
                  }
                >
                  <UserBubble
                    event={turn.userEvent}
                    isCurrent={turn.userEvent.index === currentIndex}
                    onClick={() => seekTo(turn.userEvent!.index)}
                  />
                </div>
              )}
              {nodes.length > 0 && (
                <div className="space-y-1.5">
                  {nodes.map((node) => {
                    if (node.type === "tool_group") {
                      const items = node.items ?? [];
                      const isCurrent = items.some(
                        (it) =>
                          it.tool.index === currentIndex ||
                          it.result?.index === currentIndex,
                      );
                      const attachRef = (el: HTMLElement | null) =>
                        assignCurrentRef(el, isCurrent);
                      return (
                        <div key={node.index} ref={attachRef}>
                          <ToolGroup
                            node={node}
                            currentIndex={currentIndex}
                            expanded={expandedGroups.has(node.index)}
                            onToggle={() => toggleGroup(node.index)}
                            expandedItems={expandedTools}
                            onToggleItem={toggleTool}
                            onSeek={seekTo}
                          />
                        </div>
                      );
                    }

                    const isCurrent = node.index === currentIndex;
                    const attachRef = (el: HTMLElement | null) =>
                      assignCurrentRef(el, isCurrent);

                    if (node.type === "text") {
                      return (
                        <div key={node.index} ref={attachRef}>
                          <AssistantTextRow
                            event={node.primary}
                            isCurrent={isCurrent}
                            onClick={() => seekTo(node.index)}
                          />
                        </div>
                      );
                    }
                    if (node.type === "thinking") {
                      if (!showThinking) return null;
                      return (
                        <div key={node.index} ref={attachRef}>
                          <ThinkingRow
                            event={node.primary}
                            isCurrent={isCurrent}
                            onClick={() => seekTo(node.index)}
                          />
                        </div>
                      );
                    }
                    if (node.type === "error") {
                      return (
                        <div key={node.index} ref={attachRef}>
                          <ErrorRow
                            event={node.primary}
                            isCurrent={isCurrent}
                            onClick={() => seekTo(node.index)}
                          />
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ------------ Layer-3: compact footer --------------------- */}
      <div className="shrink-0 border-t border-[var(--border)] px-3 py-1.5">
        <div
          className="h-1 bg-[var(--border)] rounded-full mb-1.5 cursor-pointer"
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-75"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            onClick={() => seekTo(0)}
            title="First"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2v6M8 2L4 5l4 3V2z" fill="currentColor" />
            </svg>
          </button>
          <button
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            onClick={stepBackward}
            title="Previous"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M7 2L3 5l4 3V2z" fill="currentColor" />
            </svg>
          </button>
          <button
            className="p-1 text-[var(--text-primary)] cursor-pointer"
            onClick={togglePlayback}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="2" width="3" height="8" rx="0.5" fill="currentColor" />
                <rect x="7" y="2" width="3" height="8" rx="0.5" fill="currentColor" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            onClick={stepForward}
            title="Next"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 2l4 3-4 3V2z" fill="currentColor" />
            </svg>
          </button>
          <button
            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            onClick={() => seekTo(timeline.events.length - 1)}
            title="Last"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M8 2v6M2 2l4 3-4 3V2z" fill="currentColor" />
            </svg>
          </button>

          <div className="flex-1" />

          <button
            className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer px-1"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            onClick={() => setShowThinking((v) => !v)}
            title="Show internal reasoning (thinking blocks)"
          >
            {showThinking ? "● thinking" : "○ thinking"}
          </button>

          <button
            className="text-[9px] tabular-nums text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer px-1"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            onClick={() => {
              const idx = SPEEDS.indexOf(speed);
              setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
            }}
            title="Playback speed"
          >
            {speed}x
          </button>

          <span
            className="text-[9px] tabular-nums text-[var(--text-faint)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {currentIndex + 1}/{timeline.events.length}
          </span>
        </div>
      </div>
    </div>
  );
}
