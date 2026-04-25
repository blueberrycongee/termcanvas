import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { marked } from "marked";
import { useSessionStore } from "../stores/sessionStore";
import { useCanvasStore } from "../stores/canvasStore";
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
//
// Sizes here intentionally read from the typography scale tokens
// (--text-base/md/sm/xs) instead of hand-rolled px values, so a future
// scale tweak ripples through without grep-and-replace.
//
// Inline `<code>` was previously amber-on-bg, which clashed with the
// (also-amber) Assistant role label in code-heavy replies and read as
// a "highlight" rather than "this is code". Switched to text-primary
// on a faint --surface tint — quiet, IDE-style. `<pre>` blocks gain a
// real --surface bg too: the previous --bg matched the page background
// and made fenced blocks invisible.
const markdownClassName =
  "prose prose-sm prose-invert max-w-none text-[length:var(--text-md)] leading-relaxed text-[var(--text-primary)] " +
  "[&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 " +
  "[&_h2]:text-[length:var(--text-md)] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-[length:var(--text-base)] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 " +
  "[&_p]:my-1.5 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 " +
  "[&_a]:text-[var(--accent)] [&_a]:cursor-pointer " +
  "[&_code]:text-[var(--text-primary)] [&_code]:bg-[var(--surface)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[length:var(--text-xs)] " +
  "[&_pre]:bg-[var(--surface)] [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:text-[length:var(--text-xs)] [&_pre]:overflow-x-auto " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-hover)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-muted)] " +
  "[&_hr]:border-[var(--border)]";

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false, breaks: true }) as string;
}

/*
 * Replay as a chat transcript.
 *
 * Three layers, in order of importance to a human reading back a
 * session: topic → dialog → playback controls.
 *
 *   Layer 1 — Topic header.
 *     First user prompt promoted to a big title; meta line beneath.
 *     The first thing on screen answers "what is this conversation
 *     about?" without any scrolling.
 *
 *   Layer 2 — Chat body.
 *     One row vocabulary, one rail. Each row is rail (left, 2 px,
 *     accent — only visible when the row is the current event) +
 *     gutter + content. Speakers are differentiated by typography:
 *       User prompt → "›" accent gutter glyph + prose at weight 500
 *       Assistant   → no glyph, prose at weight 400 (same indent)
 *       Thinking    → italic muted, deeper indent
 *       Tool group  → muted mono label, deeper indent, click-to-expand
 *     One timestamp per turn, on the user prompt. tool_result never
 *     appears at the top level — only inside its parent tool's
 *     expanded detail.
 *
 *   Layer 3 — Playback footer.
 *     Thin progress bar + compact play/pause/seek + speed + show-
 *     details toggle. Demoted from "primary UI" to "occasional tool".
 *
 * The existing currentIndex / isPlaying / seekTo state machine is
 * preserved — this is a presentational rewrite, not a state model
 * change. currentIndex highlights whichever rendered block contains
 * it and auto-scrolls during playback.
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
 * CLI command the user can run to resume the session from their own
 * terminal (i.e. outside the in-app Resume button). Two providers need
 * two different flag conventions:
 *
 *   claude  →  `claude --resume <id>`
 *   codex   →  `codex resume <id>`
 *
 * Returns `null` when the provider is unknown — we fall back to just
 * surfacing the raw ID so the user can at least grep / paste it by
 * hand.
 */
function buildResumeCommand(
  provider: TerminalType | null,
  sessionId: string,
): string | null {
  if (provider === "claude") return `claude --resume ${sessionId}`;
  if (provider === "codex") return `codex resume ${sessionId}`;
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
  sessionId,
  resumeCommand,
  onCopyResume,
  copyCmdTooltip,
  copyIdTooltip,
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
  sessionId: string;
  resumeCommand: string | null;
  onCopyResume: () => void;
  copyCmdTooltip: string;
  copyIdTooltip: string;
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
            className="text-[length:var(--text-md)] font-medium leading-snug text-[var(--text-primary)] line-clamp-2"
            title={topic}
          >
            {topic || (
              <span className="italic text-[var(--text-muted)]">(no prompt captured)</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 tc-meta tc-mono">
            <span>{project}</span>
            <span className="text-[var(--text-faint)]">·</span>
            <span>{provider}</span>
            <span className="text-[var(--text-faint)]">·</span>
            <span>{age}</span>
            <span className="text-[var(--text-faint)]">·</span>
            <span className="tabular-nums">{messageCount} msgs</span>
          </div>
          {/*
            Shell command the user can paste into their own terminal if
            they don't want to resume via the in-app button. Showing
            the full command (not just an ID) answers the "ok great, I
            see this — now how do I actually resume it?" question in
            the most literal way possible. Click anywhere on the row to
            copy; tooltip signals the interaction. Falls back to the
            raw session id for unknown providers.

            The previous design prefixed this with "$" / "id" labels —
            dropped here as part of the eyebrow-density cleanup. The
            command itself starts with the provider name ("claude
            --resume …"), so the "$" prompt was redundant chrome.
          */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCopyResume();
            }}
            className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--surface-hover)] cursor-pointer"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            title={resumeCommand ? copyCmdTooltip : copyIdTooltip}
          >
            <span className="flex-1 truncate text-[length:var(--text-xs)] text-[var(--text-secondary)]">
              {resumeCommand ?? sessionId}
            </span>
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              className="shrink-0 text-[var(--text-muted)]"
            >
              <rect
                x="3.5"
                y="1.5"
                width="6"
                height="7.5"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <path
                d="M2.5 3.5v6.5a1 1 0 001 1H8"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <button
          className="mt-0.5 shrink-0 inline-flex h-6 items-center gap-1 rounded-md px-2 text-[length:var(--text-xs)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
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

/* ------------ Layer-2: chat content -------------------------------
 *
 * Every row in this layer shares one visual contract:
 *
 *   [ rail ] [ gutter ] [ content                                  ]
 *     ^         ^         ^
 *     │         │         └── prose / label / chevron, indented per
 *     │         │              row kind so subordination reads as
 *     │         │              indent depth, not as container chrome
 *     │         │
 *     │         └── 20 px-wide column. User prompts hang an accent
 *     │              "›" glyph here as a speaker mark, replacing the
 *     │              old "You" / "Assistant" eyebrows.
 *     │
 *     └── the ONE rail in this view. 2 px wide, accent-coloured, only
 *         visible on the current event. Replaces three different rail
 *         widths from the previous design (3 px user, 2 px thinking,
 *         1 px tool group), which were too similar to feel intentional
 *         and too present to feel quiet.
 *
 * Speaker differentiation is now purely typographic:
 *   - User prompt:   --text-md, weight 500, accent "›" gutter glyph
 *   - Assistant:     --text-md, weight 400, no glyph
 *   - Thinking:      --text-xs italic muted, deeper indent
 *   - Tool group:    --text-xs muted mono label, deeper indent
 *
 * No bubbles, no per-row backgrounds, no rounded containers. */

const ROW_RAIL_CLS = "absolute left-0 top-0 bottom-0 w-[2px] transition-colors";

function railColor(isCurrent: boolean): string {
  return isCurrent ? "var(--accent)" : "transparent";
}

function UserPrompt({
  event,
  isCurrent,
  onClick,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
}) {
  // Right-aligned neutral bubble, iMessage-style. The bubble +
  // alignment ARE the speaker mark — no glyph, no eyebrow, no avatar,
  // no "You" label. Background uses --bubble-bg (a neutral surface
  // lift, NOT the accent color) so a turn full of user prompts reads
  // as quiet containers instead of a stack of colored highlights.
  //
  // Width: max-w-[78%] on the inner column. Picked over 70/85 because
  // 78% lets a real-world prompt (a couple of sentences) wrap at most
  // once or twice, and short prompts hug content because the column
  // is items-end + auto-sized in the cross axis. The bubble never
  // pushes past the column even with very long prompts.
  //
  // Current event indicator: a 1px accent border on the bubble. The
  // resting bubble carries a 1px transparent border so flipping the
  // color doesn't shift the layout. We deliberately do NOT use a bg
  // tint or accent-soft fill: the resting bubble is supposed to be
  // the user-picked neutral, not a variable accent.
  //
  // Timestamp lives BELOW the bubble, right-aligned, muted mono. Below
  // (not above) because the eye lands on the bubble itself first; the
  // timestamp then sits next to where the assistant's reply begins,
  // anchoring the bottom of the turn instead of crowding the top.
  return (
    <div className="flex justify-end">
      <div className="flex flex-col items-end max-w-[78%]">
        <button
          type="button"
          onClick={onClick}
          data-current={isCurrent || undefined}
          className="rounded-xl px-3 py-2 text-left cursor-pointer transition-colors"
          style={{
            backgroundColor: "var(--bubble-bg)",
            border: `1px solid ${isCurrent ? "var(--accent)" : "transparent"}`,
          }}
        >
          <div
            className={markdownClassName}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(event.textPreview) }}
          />
        </button>
        <span
          className="mt-1 tc-mono tabular-nums"
          style={{
            fontSize: "var(--text-tiny)",
            color: "var(--text-faint)",
          }}
        >
          {formatTimestamp(event.timestamp)}
        </span>
      </div>
    </div>
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
      className="block w-full text-left"
      onClick={onClick}
      data-current={isCurrent || undefined}
    >
      <div className="relative pl-5 pr-3 py-1 transition-colors">
        <span aria-hidden className={ROW_RAIL_CLS} style={{ backgroundColor: railColor(isCurrent) }} />
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
  // Internal-monologue rows. Subordination is expressed with deeper
  // indent (pl-9 vs pl-5 for prose) plus italic + dim color, not with
  // a container or its own rail.
  return (
    <button
      className="block w-full text-left"
      onClick={onClick}
      data-current={isCurrent || undefined}
    >
      <div className="relative pl-9 pr-3 py-0.5 transition-colors">
        <span aria-hidden className={ROW_RAIL_CLS} style={{ backgroundColor: railColor(isCurrent) }} />
        <div
          className="italic whitespace-pre-wrap break-words"
          style={{
            fontSize: "var(--text-xs)",
            lineHeight: "var(--leading-normal)",
            color: "var(--text-muted)",
          }}
        >
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
  // Sub-items live inside an already-indented tool group. They get one
  // more notch of indent (pl-3) and no fill — current-state is implied
  // by the parent group's rail. Eyebrows survive only on input/output:
  // those are the rare case where typography alone can't tell the
  // reader whether they're looking at a tool's argv or its stdout.
  return (
    <div className="pl-3" data-current={isCurrent || undefined}>
      <button
        className="flex w-full items-center gap-1.5 text-left cursor-pointer py-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
          onToggle();
        }}
      >
        <span className="shrink-0" style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
          {expanded ? "▾" : "▸"}
        </span>
        <span
          className="shrink-0 tc-mono"
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: isCurrent ? "var(--text-primary)" : "var(--text-secondary)",
          }}
        >
          {verb}
        </span>
        {subject && (
          <span
            className="truncate tc-mono"
            style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
          >
            {subject}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 space-y-2 pl-3 pb-1">
          {item.tool.textPreview && (
            <div>
              <div className="mb-0.5 tc-eyebrow tc-mono">input</div>
              <pre
                className="whitespace-pre-wrap break-words tc-mono m-0"
                style={{
                  fontSize: "var(--text-xs)",
                  lineHeight: "var(--leading-snug)",
                  color: "var(--text-secondary)",
                }}
              >
                {item.tool.textPreview}
              </pre>
            </div>
          )}
          {item.result?.textPreview && (
            <div>
              <div className="mb-0.5 tc-eyebrow tc-mono">output</div>
              <pre
                className="whitespace-pre-wrap break-words tc-mono m-0"
                style={{
                  fontSize: "var(--text-xs)",
                  lineHeight: "var(--leading-snug)",
                  color: "var(--text-secondary)",
                }}
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

  // Tool runs read as subordinate via deeper indent (pl-9 vs pl-5 for
  // prose) + smaller muted mono label. No always-on rail: only the
  // current-event rail (shared with user/assistant rows) is visible.
  return (
    <div
      className="group relative pl-9 pr-3 transition-colors"
      data-current={isGroupCurrent || undefined}
    >
      <span aria-hidden className={ROW_RAIL_CLS} style={{ backgroundColor: railColor(isGroupCurrent) }} />
      <button
        className="flex w-full items-center gap-1.5 text-left cursor-pointer py-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onSeek(node.index);
          onToggle();
        }}
      >
        <span className="shrink-0" style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>
          {expanded ? "▾" : "▸"}
        </span>
        {count > 1 && (
          <span className="shrink-0 tc-mono tabular-nums" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            {count}
          </span>
        )}
        <span
          className="truncate tc-mono"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            fontWeight: "var(--weight-regular)",
          }}
        >
          {summary}
        </span>
      </button>
      {expanded && (
        <div className="mt-0.5 mb-1 space-y-0.5">
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

/**
 * Determine which assistant node is the "final answer" and which
 * nodes form the working slice that the WorkingFold will hide by
 * default.
 *
 * Rule: a turn ends with a final answer iff its last node is a
 * user-facing terminus — `text` (the agent's reply) or `error`
 * (which the user must always see immediately, never folded). A
 * trailing `tool_group` / `thinking` means the turn ran out of
 * runway without producing an answer; everything is working in
 * that case.
 */
function determineFoldSplit(nodes: AssistantNode[]): {
  working: AssistantNode[];
  answer: AssistantNode | null;
} {
  if (nodes.length === 0) return { working: [], answer: null };
  const last = nodes[nodes.length - 1];
  if (last.type === "text" || last.type === "error") {
    return { working: nodes.slice(0, -1), answer: last };
  }
  return { working: nodes, answer: null };
}

function nodeContainsIndex(node: AssistantNode, idx: number): boolean {
  if (node.type === "tool_group") {
    return (node.items ?? []).some(
      (it) => it.tool.index === idx || it.result?.index === idx,
    );
  }
  return node.index === idx;
}

function collectFoldToolSummary(nodes: AssistantNode[]): string {
  const items: ToolGroupItem[] = [];
  for (const n of nodes) {
    if (n.type === "tool_group" && n.items) items.push(...n.items);
  }
  if (items.length === 0) return "";
  return summarizeToolNames(items);
}

function formatFoldDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * One-line summary of a turn's intermediate working (tools / thinking
 * / mid-turn assistant text). Default-collapsed; expanded view defers
 * to the existing per-node components so visual treatment of those
 * rows stays exactly as shipped in 229ddee.
 *
 * Step count semantics: one step per AssistantNode in the working
 * slice. A tool_group counts as 1 step regardless of how many
 * sub-tools it batches — counting individual tools would push the
 * step number into the high-double-digits and turn the label into
 * noise. The label users actually want is "the agent did 12 things",
 * not "the agent issued 47 tool calls".
 *
 * No rail: when playback enters the working slice the fold auto-
 * expands (see `effectiveExpanded` in the main render), so a
 * collapsed fold is guaranteed to never hide the active event from
 * the rail.
 */
function WorkingFold({
  stepCount,
  toolSummary,
  duration,
  expanded,
  onToggle,
  children,
}: {
  stepCount: number;
  toolSummary: string;
  duration: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left cursor-pointer pl-9 pr-3 py-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <span
          className="shrink-0"
          style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}
        >
          {expanded ? "▾" : "▸"}
        </span>
        <span
          className="truncate tc-mono"
          style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
        >
          <span className="tabular-nums">{stepCount}</span>{" "}
          {stepCount === 1 ? "step" : "steps"}
          {toolSummary && (
            <>
              <span style={{ color: "var(--text-faint)" }}> · </span>
              {toolSummary}
            </>
          )}
          {duration && (
            <>
              <span style={{ color: "var(--text-faint)" }}> · </span>
              <span className="tabular-nums">{duration}</span>
            </>
          )}
        </span>
      </button>
      {expanded && <div className="mt-0.5 space-y-1">{children}</div>}
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
  // Errors are rare and semantically different — the row breaks the
  // "no fills" rule on purpose. The fill itself reads "this went wrong"
  // at a glance; no eyebrow needed (red color carries the label).
  // The current-event rail is always-red here so the accent rail
  // doesn't fight the error semantic.
  return (
    <button
      className="block w-full text-left"
      onClick={onClick}
      data-current={isCurrent || undefined}
    >
      <div
        className="relative pl-5 pr-3 py-1.5 transition-colors rounded-sm"
        style={{ backgroundColor: "var(--red-soft)" }}
      >
        <span
          aria-hidden
          className={ROW_RAIL_CLS}
          style={{ backgroundColor: "var(--red)" }}
        />
        <div
          className="whitespace-pre-wrap break-words"
          style={{
            fontSize: "var(--text-xs)",
            lineHeight: "var(--leading-normal)",
            color: "var(--text-primary)",
          }}
        >
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
  const closeSessionsOverlay = useCanvasStore((s) => s.closeSessionsOverlay);
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
  // Per-turn fold state, keyed by `turn.startIndex` (the timeline
  // index of the turn's first event — stable across re-renders even
  // if turns get re-grouped). Auto-expansion during playback is
  // computed at render time as an OR with this set; we don't write
  // playback state into the set so toggling a fold while it's
  // auto-expanded doesn't permanently latch it open after playback
  // moves on.
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(new Set());

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

  const toggleFold = useCallback((key: number) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

    // Close the replay drawer BEFORE panning. In the old full-screen
    // modal, exitReplay was enough — modal dismissed itself. Now the
    // drawer is a left-anchored canvas-gap panel that covers ~60% of
    // the canvas; leaving it open means the brand-new terminal spawns
    // and pans underneath the drawer, invisible to the user.
    exitReplay();
    closeSessionsOverlay();
    panToTerminal(created.id);
    notify(
      "info",
      (t.session_replay_resume_toast as unknown as string) ??
        `Resumed session in new ${resumeTarget.provider} terminal`,
    );
  }, [resumeTarget, exitReplay, closeSessionsOverlay, notify, t]);

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
            <div className="text-[length:var(--text-xs)] text-[var(--red)]">
              {replayError}
            </div>
            <button
              className="tc-label hover:text-[var(--text-primary)] cursor-pointer"
              onClick={exitReplay}
            >
              {t.sessions_load_error_back}
            </button>
          </>
        ) : (
          <div className="tc-meta">{t.sessions_loading}</div>
        )}
      </div>
    );
  }

  const topicEvent = timeline.events.find((e) => e.type === "user_prompt");
  const topic = topicEvent?.textPreview ?? "";
  const providerType = providerFromFilePath(timeline.filePath);
  const provider = providerType ?? "agent";
  const age = formatRelativeAge(timeline.startedAt || timeline.endedAt || "");
  const progress =
    timeline.events.length > 1 ? currentIndex / (timeline.events.length - 1) : 0;
  const resumeCommand = buildResumeCommand(providerType, timeline.sessionId);

  const handleCopyResume = () => {
    const text = resumeCommand ?? timeline.sessionId;
    void navigator.clipboard.writeText(text).catch(() => {});
    notify(
      "info",
      (resumeCommand
        ? (t.session_replay_resume_cmd_copied as unknown as string)
        : (t.session_replay_resume_id_copied as unknown as string)) ??
        "Copied",
    );
  };

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
        sessionId={timeline.sessionId}
        resumeCommand={resumeCommand}
        onCopyResume={handleCopyResume}
        copyCmdTooltip={
          (t.session_replay_resume_cmd_tooltip as unknown as string) ??
          "Click to copy resume command"
        }
        copyIdTooltip={
          (t.session_replay_resume_id_tooltip as unknown as string) ??
          "Click to copy session ID"
        }
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
        className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-6"
      >
        {turns.map((turn, turnIdx) => {
          const nodes = buildAssistantNodes(turn.assistantEvents);

          // Render any single AssistantNode using its existing
          // component. Used both inside expanded WorkingFolds and as
          // the answer renderer at the top level — same code path,
          // identical visual treatment, no per-context branching.
          const renderNode = (node: AssistantNode) => {
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
          };

          // The fold only makes sense in a question→answer frame.
          // For headless turns (system events before the first
          // user_prompt) just render assistant nodes as-is.
          if (!turn.userEvent) {
            return (
              <div
                key={`turn-${turn.startIndex}-${turnIdx}`}
                className="space-y-2"
              >
                {nodes.length > 0 && (
                  <div className="space-y-1">{nodes.map(renderNode)}</div>
                )}
              </div>
            );
          }

          const { working, answer } = determineFoldSplit(nodes);
          const hasFold = working.length > 0;
          const foldKey = turn.startIndex;
          const userExpandedFold = expandedFolds.has(foldKey);
          // Auto-expand whenever currentIndex falls inside any
          // working node's range — otherwise the rail would be
          // hidden inside a collapsed fold during playback. Simple
          // OR: we don't try to remember "user collapsed while
          // playing", on purpose. When playback exits the range,
          // the auto-expand goes away and the fold returns to the
          // user's preferred state.
          const playbackInWorking =
            hasFold && working.some((n) => nodeContainsIndex(n, currentIndex));
          const foldExpanded = userExpandedFold || playbackInWorking;

          // End-of-working timestamp for the duration label. Prefer
          // the answer's timestamp (matches what the reader sees as
          // "the turn ended here"); fall back to the last working
          // node when there is no answer.
          const endIso =
            answer?.primary.timestamp ??
            working[working.length - 1]?.primary.timestamp ??
            turn.userEvent.timestamp;
          const duration = formatFoldDuration(
            turn.userEvent.timestamp,
            endIso,
          );

          return (
            <div
              key={`turn-${turn.startIndex}-${turnIdx}`}
              className="space-y-2"
            >
              <div
                ref={(el) =>
                  assignCurrentRef(el, turn.userEvent!.index === currentIndex)
                }
              >
                <UserPrompt
                  event={turn.userEvent}
                  isCurrent={turn.userEvent.index === currentIndex}
                  onClick={() => seekTo(turn.userEvent!.index)}
                />
              </div>
              {(hasFold || answer) && (
                <div className="space-y-1">
                  {hasFold && (
                    <WorkingFold
                      stepCount={working.length}
                      toolSummary={collectFoldToolSummary(working)}
                      duration={duration}
                      expanded={foldExpanded}
                      onToggle={() => toggleFold(foldKey)}
                    >
                      {working.map(renderNode)}
                    </WorkingFold>
                  )}
                  {answer && renderNode(answer)}
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
            className="tc-mono tc-label hover:text-[var(--text-primary)] cursor-pointer px-1"
            onClick={() => setShowThinking((v) => !v)}
            title="Show internal reasoning (thinking blocks)"
          >
            {showThinking ? "● thinking" : "○ thinking"}
          </button>

          <button
            className="tc-mono tc-label tabular-nums hover:text-[var(--text-primary)] cursor-pointer px-1"
            onClick={() => {
              const idx = SPEEDS.indexOf(speed);
              setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
            }}
            title="Playback speed"
          >
            {speed}x
          </button>

          <span className="tc-mono tc-caption tabular-nums">
            {currentIndex + 1}/{timeline.events.length}
          </span>
        </div>
      </div>
    </div>
  );
}
