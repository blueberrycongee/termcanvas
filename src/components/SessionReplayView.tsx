import { useEffect, useRef, useCallback, useMemo, useState } from "react";
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
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { markdownClassName, renderMarkdown } from "../utils/markdownClass";

/*
 * Session transcript.
 *
 * Two layers, in order of importance to a human reading back a
 * session: topic → dialog.
 *
 *   Layer 1 — Topic header.
 *     First user prompt promoted to a big title; meta line beneath.
 *     The first thing on screen answers "what is this conversation
 *     about?" without any scrolling.
 *
 *   Layer 2 — Chat body.
 *     One row vocabulary. Speakers are differentiated by typography
 *     and placement:
 *       User prompt → right-aligned neutral bubble
 *       Assistant   → no glyph, prose at weight 400 (same indent)
 *       Thinking    → italic muted, deeper indent
 *       Tool group  → muted mono label, deeper indent, click-to-expand
 *     One timestamp per turn, on the user prompt. tool_result never
 *     appears at the top level — only inside its parent tool's
 *     expanded detail.
 *
 * The existing currentIndex / seekTo state machine is preserved —
 * this is a presentational rewrite, not a state model change.
 */

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
    return (
      event.filePath.split(/[\\/]/).filter(Boolean).pop() ?? event.filePath
    );
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
      <div className="mx-auto max-w-[720px]">
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
                <span className="italic text-[var(--text-muted)]">
                  (no prompt captured)
                </span>
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
    </div>
  );
}

/* ------------ Layer-2: chat content -------------------------------
 *
 * Every row in this layer keeps content quiet: no selected-row accent,
 * no coloured current marker, and no per-row label chrome.
 *
 * Speaker differentiation is now purely typographic:
 *   - User prompt:   neutral right-aligned bubble
 *   - Assistant:     --text-md, weight 400, no glyph
 *   - Thinking:      --text-xs italic muted, deeper indent
 *   - Tool group:    --text-xs muted mono label, deeper indent
 *
 * No bubbles, no per-row backgrounds, no rounded containers. */

const ROW_RAIL_CLS = "absolute left-0 top-0 bottom-0 w-[2px] transition-colors";

function railColor(_isCurrent: boolean): string {
  return "transparent";
}

/** Muted copy button. Click writes `text` to the clipboard and the
 *  icon swaps to a check for ~1.2s. Same hover-brighten treatment as
 *  the fork affordance; never opacity-gated. Caller renders it inside
 *  whatever flex/absolute container the row needs. */
function CopyMessageButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!text) return;
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
      title={label}
      aria-label={label}
      className="cursor-pointer p-0.5 transition-colors"
      style={{ color: copied ? "var(--accent)" : "var(--text-muted)" }}
      onMouseEnter={(e) => {
        if (copied) return;
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        if (copied) return;
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-muted)";
      }}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M3 7.5L6 10.5L11.5 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect
            x="4"
            y="4"
            width="7"
            height="8"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M2.5 9.5V3.2C2.5 2.5 3 2 3.7 2H8.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
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
  // Timestamp lives BELOW the bubble, right-aligned, muted mono. Below
  // (not above) because the eye lands on the bubble itself first; the
  // timestamp then sits next to where the assistant's reply begins,
  // anchoring the bottom of the turn instead of crowding the top.
  //
  // Fork affordance lives on the assistant's final answer row, not
  // here — putting it on the user prompt was ambiguous ("before this
  // message? after?"). Anchoring it to the answer reads unambiguously
  // as "this exchange is complete; branch a new direction from here".
  return (
    <div className="flex justify-end">
      <div className="flex flex-col items-end max-w-[78%] min-w-0">
        <button
          type="button"
          onClick={onClick}
          data-current={isCurrent || undefined}
          className="rounded-xl px-3 py-2 text-left cursor-pointer transition-colors min-w-0 max-w-full overflow-hidden"
          style={{
            backgroundColor: "var(--bubble-bg)",
            border: "1px solid transparent",
          }}
        >
          <div
            className={markdownClassName}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(event.textPreview),
            }}
          />
        </button>
        <div className="mt-1 flex items-center gap-1.5">
          <CopyMessageButton text={event.textPreview} label="Copy prompt" />
          <span
            className="tc-mono tabular-nums"
            style={{
              fontSize: "var(--text-tiny)",
              color: "var(--text-faint)",
            }}
          >
            {formatTimestamp(event.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}

function AssistantTextRow({
  event,
  isCurrent,
  onClick,
  onFork,
  forkLabel,
  forkClaudeLabel,
  forkCodexLabel,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
  /** When provided, a muted fork button sits at the bottom-right of
   *  the row (always visible, brightens on hover). Hovering opens a
   *  menu with one option per supported target provider; clicking an
   *  option fires `onFork(target)`. Caller gates which rows render
   *  the affordance — only the turn's "final answer" assistant text
   *  gets it, so the action reads as "fork after this exchange ended". */
  onFork?: (target: "claude" | "codex") => void;
  forkLabel?: string;
  forkClaudeLabel?: string;
  forkCodexLabel?: string;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="block w-full text-left"
        onClick={onClick}
        data-current={isCurrent || undefined}
      >
        <div className="relative pl-5 pr-3 py-1 transition-colors">
          <span
            aria-hidden
            className={ROW_RAIL_CLS}
            style={{ backgroundColor: railColor(isCurrent) }}
          />
          <div
            className={markdownClassName}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(event.textPreview),
            }}
          />
        </div>
      </button>
      <div className="absolute right-3 bottom-1 flex items-center gap-1">
        <CopyMessageButton text={event.textPreview} label="Copy reply" />
        {onFork && (
          <div className="group/fork relative">
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              title={forkLabel ?? "Fork from here"}
              aria-label={forkLabel ?? "Fork from here"}
              className="cursor-pointer p-0.5 transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--text-muted)";
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M4 12V8.5C4 7.4 4.9 6.5 6 6.5H8C9.1 6.5 10 5.6 10 4.5V2"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4 12V2"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <circle cx="4" cy="13" r="0.9" fill="currentColor" />
                <circle cx="4" cy="2" r="0.9" fill="currentColor" />
                <circle cx="10" cy="2" r="0.9" fill="currentColor" />
              </svg>
            </button>
            {/* Outer wrapper has pt-1 so the 4px visual gap between the
              icon and the menu sits INSIDE the hover-tracked element.
              Without this, the cursor crossing the gap leaves the
              fork group's bounding box, group-hover/fork flips to
              false, and the menu hides before the cursor reaches it
              — the classic "hover gap" bug. */}
            <div className="hidden group-hover/fork:block absolute right-0 top-full pt-1 z-10">
              <div
                className="flex flex-col rounded-md shadow-lg overflow-hidden whitespace-nowrap"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFork("claude");
                  }}
                  className="px-3 py-1.5 text-left tc-mono cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-primary)",
                  }}
                >
                  {forkClaudeLabel ?? "Continue in Claude"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFork("codex");
                  }}
                  className="px-3 py-1.5 text-left tc-mono cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-primary)",
                  }}
                >
                  {forkCodexLabel ?? "Continue in Codex"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
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
        <span
          aria-hidden
          className={ROW_RAIL_CLS}
          style={{ backgroundColor: railColor(isCurrent) }}
        />
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
        <span
          className="shrink-0"
          style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}
        >
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
  const summary =
    count === 1
      ? `${toolVerb(items[0].tool.toolName)}${
          toolSubjectHint(items[0].tool)
            ? " " + toolSubjectHint(items[0].tool)
            : ""
        }`
      : summarizeToolNames(items);

  // Tool runs read as subordinate via deeper indent (pl-9 vs pl-5 for
  // prose) + smaller muted mono label. No selected-row accent.
  return (
    <div
      className="group relative pl-9 pr-3 transition-colors"
      data-current={isGroupCurrent || undefined}
    >
      <span
        aria-hidden
        className={ROW_RAIL_CLS}
        style={{ backgroundColor: railColor(isGroupCurrent) }}
      />
      <button
        className="flex w-full items-center gap-1.5 text-left cursor-pointer py-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onSeek(node.index);
          onToggle();
        }}
      >
        <span
          className="shrink-0"
          style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}
        >
          {expanded ? "▾" : "▸"}
        </span>
        {count > 1 && (
          <span
            className="shrink-0 tc-mono tabular-nums"
            style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
          >
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
 * When playback enters the working slice the fold auto-expands (see
 * `effectiveExpanded` in the main render), so a collapsed fold is
 * guaranteed to never hide the active event.
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

export function SessionReplayView() {
  const timeline = useSessionStore((s) => s.replayTimeline);
  const replayError = useSessionStore((s) => s.replayError);
  const currentIndex = useSessionStore((s) => s.replayCurrentIndex);
  const exitReplay = useSessionStore((s) => s.exitReplay);
  const closeSessionsOverlay = useCanvasStore((s) => s.closeSessionsOverlay);
  const seekTo = useSessionStore((s) => s.seekTo);
  const { notify } = useNotificationStore();
  const t = useT();

  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLElement | null>(null);

  // Thinking rows stay hidden in this stripped-down transcript view.
  const showThinking = false;
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
    const base = createTerminal(
      resumeTarget.provider,
      undefined,
      undefined,
      undefined,
      "user",
    );
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

  // Fork affordance state. The user picks a turn (the userPromptIndex
  // of any user_prompt bubble), confirms, and we mint a new session
  // JSONL truncated through that turn, then spawn a terminal of the
  // matching provider that resumes the new session id. Enabled
  // providers are listed explicitly: claude and codex today; kimi
  // and any future provider stay disabled until added here.
  const forkSession = useSessionStore((s) => s.forkSession);
  const [forkRequest, setForkRequest] = useState<{
    turnIndex: number;
    target: "claude" | "codex";
  } | null>(null);
  const [forkBusy, setForkBusy] = useState(false);
  const canFork =
    !!resumeTarget &&
    (resumeTarget.provider === "claude" || resumeTarget.provider === "codex");

  const requestFork = useCallback(
    (turnIdx: number, target: "claude" | "codex") => {
      setForkRequest({ turnIndex: turnIdx, target });
    },
    [],
  );

  const cancelFork = useCallback(() => {
    if (forkBusy) return;
    setForkRequest(null);
  }, [forkBusy]);

  const confirmFork = useCallback(async () => {
    if (!resumeTarget || !forkRequest || !timeline) return;
    const target = forkRequest.target;
    setForkBusy(true);
    try {
      const { newSessionId } = await forkSession(
        timeline.filePath,
        forkRequest.turnIndex,
        target,
      );

      // Spawn a terminal of the TARGET provider, not the source. A
      // Claude→Codex fork must open a Codex terminal so `codex resume
      // <new-uuid>` can attach to the freshly-translated rollout.
      const base = createTerminal(
        target,
        undefined,
        undefined,
        undefined,
        "user",
      );
      base.sessionId = newSessionId;

      const created = createTerminalInScene({
        projectId: resumeTarget.projectId,
        worktreeId: resumeTarget.worktreeId,
        terminal: base,
        origin: "user",
      });

      exitReplay();
      closeSessionsOverlay();
      panToTerminal(created.id);
      notify(
        "info",
        (t.session_replay_fork_toast as unknown as string) ??
          "Forked session in new terminal",
      );
      setForkRequest(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fork session";
      notify("error", message);
    } finally {
      setForkBusy(false);
    }
  }, [
    resumeTarget,
    forkRequest,
    timeline,
    forkSession,
    exitReplay,
    closeSessionsOverlay,
    notify,
    t,
  ]);

  // Scroll the current element into view when click-seek changes it.
  useEffect(() => {
    currentRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [currentIndex]);

  const turns = useMemo(
    () => (timeline ? buildTurns(timeline.events) : []),
    [timeline],
  );

  // Per-turn user-prompt index, parallel to `turns`. The fork backend
  // counts user prompts (zero-indexed) — same predicate the replay
  // timeline uses — so a turn's position in `turns` only equals its
  // user-prompt index when there's no headless leading turn. Compute
  // explicitly so this stays correct regardless of session shape.
  const userPromptIndices = useMemo(() => {
    const indices: (number | null)[] = [];
    let n = 0;
    for (const turn of turns) {
      if (turn.userEvent) {
        indices.push(n);
        n += 1;
      } else {
        indices.push(null);
      }
    }
    return indices;
  }, [turns]);

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
  const resumeCommand = buildResumeCommand(providerType, timeline.sessionId);

  const handleCopyResume = () => {
    const text = resumeCommand ?? timeline.sessionId;
    void navigator.clipboard.writeText(text).catch(() => {});
    notify(
      "info",
      (resumeCommand
        ? (t.session_replay_resume_cmd_copied as unknown as string)
        : (t.session_replay_resume_id_copied as unknown as string)) ?? "Copied",
    );
  };

  const assignCurrentRef = (el: HTMLElement | null, isCurrent: boolean) => {
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

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3">
        <div className="mx-auto max-w-[720px] py-4 space-y-6">
          {turns.map((turn, turnIdx) => {
            const nodes = buildAssistantNodes(turn.assistantEvents);

            // Render any single AssistantNode using its existing
            // component. Used both inside expanded WorkingFolds and as
            // the answer renderer at the top level — same code path,
            // identical visual treatment, no per-context branching.
            const renderNode = (
              node: AssistantNode,
              forkProps?: {
                onFork: (target: "claude" | "codex") => void;
                forkLabel: string;
                forkClaudeLabel: string;
                forkCodexLabel: string;
              },
            ) => {
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
                      onFork={forkProps?.onFork}
                      forkLabel={forkProps?.forkLabel}
                      forkClaudeLabel={forkProps?.forkClaudeLabel}
                      forkCodexLabel={forkProps?.forkCodexLabel}
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
                    <div className="space-y-1">
                      {nodes.map((n) => renderNode(n))}
                    </div>
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
              hasFold &&
              working.some((n) => nodeContainsIndex(n, currentIndex));
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
                        {working.map((n) => renderNode(n))}
                      </WorkingFold>
                    )}
                    {answer &&
                      renderNode(
                        answer,
                        canFork && userPromptIndices[turnIdx] !== null
                          ? {
                              onFork: (target) =>
                                requestFork(
                                  userPromptIndices[turnIdx]!,
                                  target,
                                ),
                              forkLabel:
                                (t.session_replay_fork_button as unknown as string) ??
                                "Fork from here",
                              forkClaudeLabel:
                                (t.session_replay_fork_target_claude as unknown as string) ??
                                "Continue in Claude",
                              forkCodexLabel:
                                (t.session_replay_fork_target_codex as unknown as string) ??
                                "Continue in Codex",
                            }
                          : undefined,
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={forkRequest !== null}
        title={
          (t.session_replay_fork_title as unknown as string) ??
          "Fork conversation?"
        }
        body={(() => {
          const sourceProvider = providerFromFilePath(timeline.filePath);
          const target = forkRequest?.target ?? sourceProvider;
          const isCross = !!target && target !== sourceProvider;
          if (isCross && target) {
            const template =
              (t.session_replay_fork_body_cross as unknown as string) ??
              "Start a new {{target}} session with the conversation history up to this point. Tool call history won't be transferred — only user prompts and assistant text replies. The original session won't be modified.";
            return template.replace("{{target}}", target);
          }
          return (
            (t.session_replay_fork_body as unknown as string) ??
            "Start a new session with the conversation history up to this point. The original session won't be modified."
          );
        })()}
        confirmLabel={
          (t.session_replay_fork_confirm as unknown as string) ?? "Fork"
        }
        busyLabel={
          (t.session_replay_fork_busy as unknown as string) ?? "Forking…"
        }
        busy={forkBusy}
        onCancel={cancelFork}
        onConfirm={() => {
          void confirmFork();
        }}
      />
    </div>
  );
}
