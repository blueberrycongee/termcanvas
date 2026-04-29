import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useGitLog } from "../../hooks/useGitLog";
import { useGitStatus } from "../../hooks/useGitStatus";
import { useT } from "../../i18n/useT";
import { useNotificationStore } from "../../stores/notificationStore";
import type {
  GitCommitDetail,
  GitFileDiff,
  GitMergeState,
  GitStashEntry,
  GitStatusEntry,
} from "../../types";
import { parseDiff } from "../../utils/diffParser";
import {
  buildGitGraphRailModel,
  buildAheadBehindLabel,
  getCommitRowTop,
  getExpandedVirtualCommitWindow,
  getStatusColor,
  getStatusDisplayPath,
  getStatusLabel,
  summarizeBranchInventory,
  summarizeCommitRefs,
  type GitGraphRailModel,
} from "./gitContentLayout";

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;
const ROW_HEIGHT = 40;

function IconGitBranch({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="6.5" r="1.5" />
      <path d="M5 5v6M11 8v-0.5c0-1.5-1-2.5-3-2.5H5" />
    </svg>
  );
}

function IconRefresh({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 8a5.5 5.5 0 019.3-4M13.5 8a5.5 5.5 0 01-9.3 4" />
      <path d="M12 1v3.5h-3.5M4 15v-3.5h3.5" />
    </svg>
  );
}

function IconArrowUp({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  );
}

function IconArrowDown({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
  );
}

function IconHydra({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7C4 3.5 7.5 2 10.5 5L12 7.5 10.5 10.5C7.5 14 4 12.5 4 9Z" />
      <circle cx="7.5" cy="5.8" r="1" fill="currentColor" stroke="none" />
      <path d="M12 7.5L14 7.5M14 7.5L15.5 6M14 7.5L15.5 9" />
    </svg>
  );
}

function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5l3.5 3.5 6.5-7" />
    </svg>
  );
}

function IconPlus({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function IconMinus({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M3 8h10" />
    </svg>
  );
}

function IconX({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function IconChevron({
  size = 12,
  expanded,
}: {
  size?: number;
  expanded: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform duration-quick"
      style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function IconSearch({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </svg>
  );
}

function IconArchive({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="3" rx="0.5" />
      <path d="M3 5v8.5a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V5" />
      <path d="M6.5 8h3" />
    </svg>
  );
}

function IconTag({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 2.5h5l6 6-5 5-6-6z" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconGlobe({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5c1.5-2 2-3.5 2-5.5s-.5-3.5-2-5.5" />
    </svg>
  );
}

function IconDownload({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M4 7l4 4 4-4M3 13h10" />
    </svg>
  );
}

function IconPencil({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11z" />
      <path d="M9 4.5l2.5 2.5" />
    </svg>
  );
}

function IconMerge({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <path d="M4 5.5v5M4 5.5c2 1 5 1.5 6.5 2.5" />
    </svg>
  );
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d`;
  return `${Math.floor(diffSec / 2592000)}mo`;
}

function ActionButton({
  title,
  onClick,
  children,
  disabled,
  className = "",
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--surface-hover)] disabled:opacity-40 ${className}`}
      style={{ color: "var(--text-secondary)" }}
    >
      {children}
    </button>
  );
}

function CollapsibleGroup({
  title,
  count,
  defaultExpanded = true,
  actions,
  children,
  className,
}: {
  title: string;
  count: number;
  defaultExpanded?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={className}>
      <button
        className="group flex w-full shrink-0 items-center gap-1 px-2 py-2 text-left hover:bg-[var(--surface-hover)] transition-colors duration-quick"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <IconChevron expanded={expanded} />
        <span
          className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider"
          style={{ ...MONO_STYLE, color: "var(--text-secondary)" }}
        >
          {title}
        </span>
        {count > 0 && (
          <span
            className="mr-1 rounded-full px-1.5 text-[10px]"
            style={{
              ...MONO_STYLE,
              color: "var(--text-muted)",
              backgroundColor:
                "color-mix(in srgb, var(--surface) 60%, transparent)",
            }}
          >
            {count}
          </span>
        )}
        {actions && (
          <span
            className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        )}
      </button>
      {expanded && (
        <div className="flex-1 min-h-0 flex flex-col border-b border-[var(--border)]">
          {children}
        </div>
      )}
    </div>
  );
}

function FileDiffInline({
  worktreePath,
  filePath,
  staged,
  onStageHunk,
  onUnstageHunk,
}: {
  worktreePath: string;
  filePath: string;
  staged: boolean;
  onStageHunk?: (hunkHeader: string) => void;
  onUnstageHunk?: (hunkHeader: string) => void;
}) {
  const [diff, setDiff] = useState<GitFileDiff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setDiff(null);
    window.termcanvas.git
      .fileDiff(worktreePath, filePath, staged)
      .then(setDiff)
      .catch(() => setDiff(null))
      .finally(() => setLoading(false));
  }, [worktreePath, filePath, staged]);

  if (loading) {
    return (
      <div className="px-4 py-1 text-[10px] text-[var(--text-faint)]" style={MONO_STYLE}>
        Loading diff...
      </div>
    );
  }
  if (!diff || (diff.hunks.length === 0 && !diff.isBinary)) return null;
  if (diff.isBinary) {
    return (
      <div className="px-4 py-1 text-[10px] text-[var(--text-faint)]" style={MONO_STYLE}>
        Binary file
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-t" style={{ borderColor: "color-mix(in srgb, var(--border) 50%, transparent)", backgroundColor: "var(--surface)" }}>
      {diff.hunks.map((hunkContent, hunkIdx) => {
        const hunkHeaderLine = hunkContent.split("\n")[0] ?? "";
        const hunkHeaderMatch = hunkHeaderLine.match(/@@ [^@]+ @@/)?.[0] ?? "";
        return (
          <div key={hunkIdx}>
            <div className="flex items-center gap-1 px-2 py-0.5" style={{ backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)" }}>
              <span className="flex-1 truncate text-[9px]" style={{ ...MONO_STYLE, color: "var(--accent)" }}>
                {hunkHeaderLine}
              </span>
              {!staged && onStageHunk && (
                <button
                  onClick={() => onStageHunk(hunkHeaderMatch)}
                  className="shrink-0 rounded px-1 text-[9px] hover:bg-[var(--surface-hover)]"
                  style={{ ...MONO_STYLE, color: "var(--cyan)" }}
                  title="Stage Hunk"
                >
                  +Stage
                </button>
              )}
              {staged && onUnstageHunk && (
                <button
                  onClick={() => onUnstageHunk(hunkHeaderMatch)}
                  className="shrink-0 rounded px-1 text-[9px] hover:bg-[var(--surface-hover)]"
                  style={{ ...MONO_STYLE, color: "var(--amber)" }}
                  title="Unstage Hunk"
                >
                  -Unstage
                </button>
              )}
            </div>
            {hunkContent.split("\n").slice(1).map((line, lineIdx) => {
              let lineColor = "var(--text-muted)";
              let lineBg = "transparent";
              if (line.startsWith("+")) { lineColor = "var(--cyan)"; lineBg = "color-mix(in srgb, var(--cyan) 8%, transparent)"; }
              else if (line.startsWith("-")) { lineColor = "var(--red)"; lineBg = "color-mix(in srgb, var(--red) 8%, transparent)"; }
              return (
                <div key={lineIdx} className="whitespace-pre text-[10px] px-2" style={{ ...MONO_STYLE, color: lineColor, backgroundColor: lineBg }}>
                  {line}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MergeStateBanner({
  mergeState,
  worktreePath,
  onRefresh,
}: {
  mergeState: GitMergeState;
  worktreePath: string;
  onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const { notify } = useNotificationStore();
  const [busy, setBusy] = useState(false);

  if (mergeState.type === "none") return null;

  const label =
    mergeState.type === "merge" ? t.git_merge_in_progress :
    mergeState.type === "cherry-pick" ? t.git_cherry_pick_in_progress :
    t.git_rebase_progress(mergeState.current, mergeState.total);

  const handleAbort = async () => {
    setBusy(true);
    try {
      if (mergeState.type === "merge") await window.termcanvas.git.mergeAbort(worktreePath);
      else if (mergeState.type === "rebase") await window.termcanvas.git.rebaseAbort(worktreePath);
      else if (mergeState.type === "cherry-pick") await window.termcanvas.git.cherryPickAbort(worktreePath);
      await onRefresh();
    } catch (err) {
      notify("error", String(err));
    } finally { setBusy(false); }
  };

  const handleContinue = async () => {
    setBusy(true);
    try {
      if (mergeState.type === "rebase") await window.termcanvas.git.rebaseContinue(worktreePath);
      await onRefresh();
    } catch (err) {
      notify("error", String(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="shrink-0 flex items-center gap-2 border-b px-3 py-1.5" style={{ borderColor: "var(--border)", backgroundColor: "color-mix(in srgb, var(--amber) 8%, transparent)" }}>
      <IconMerge size={12} />
      <span className="flex-1 truncate text-[11px] font-medium" style={{ ...MONO_STYLE, color: "var(--amber)" }}>
        {label}
      </span>
      {mergeState.type === "rebase" && (
        <button disabled={busy} onClick={handleContinue} className="rounded px-1.5 py-0.5 text-[10px] hover:bg-[var(--surface-hover)]" style={{ ...MONO_STYLE, color: "var(--cyan)" }}>
          {t.git_rebase_continue}
        </button>
      )}
      <button disabled={busy} onClick={handleAbort} className="rounded px-1.5 py-0.5 text-[10px] hover:bg-[var(--surface-hover)]" style={{ ...MONO_STYLE, color: "var(--red)" }}>
        Abort
      </button>
    </div>
  );
}

function StashSection({
  stashes,
  worktreePath,
  onStashCreate,
  onStashApply,
  onStashPop,
  onStashDrop,
}: {
  stashes: GitStashEntry[];
  worktreePath: string;
  onStashCreate: (message: string, includeUntracked: boolean) => Promise<void>;
  onStashApply: (index: number) => Promise<void>;
  onStashPop: (index: number) => Promise<void>;
  onStashDrop: (index: number) => Promise<void>;
}) {
  const t = useT();
  const { notify } = useNotificationStore();
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    setBusy(true);
    try {
      await onStashCreate("", true);
      notify("info", t.git_stash_success);
    } catch (err) { notify("error", t.git_stash_failed(String(err))); }
    finally { setBusy(false); }
  };

  return (
    <CollapsibleGroup
      title={t.git_stash}
      count={stashes.length}
      defaultExpanded={false}
      actions={
        <button title={t.git_stash_create} disabled={busy} onClick={handleCreate} className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-secondary)" }}>
          <IconArchive />
        </button>
      }
    >
      {stashes.length === 0 ? (
        <div className="px-4 py-2 text-[10px] text-[var(--text-faint)]" style={MONO_STYLE}>{t.git_stash_empty}</div>
      ) : stashes.map((s) => (
        <div key={s.index} className="group flex items-center gap-1.5 mx-1 px-3 py-1 rounded-md hover:bg-[var(--surface-hover)]" style={{ minHeight: 26 }}>
          {/*
            `truncate` (overflow:hidden + text-overflow:ellipsis +
            white-space:nowrap) only takes effect on a block-level
            element with a bounded width. The previous layout nested a
            plain inline <span> inside a `min-w-0 flex-1` wrapper —
            the wrapper was constrained, but the span stayed inline
            and kept painting to the right past the button area,
            under the opacity-hidden Pop / Apply / Drop buttons whose
            layout width is always reserved. Matches the
            `flex-1 truncate` pattern used on every other truncating
            row in this file (file tree nodes, commit subjects,
            branch names).

            `title` carries the full stash message so the ellipsis
            doesn't amount to lost information on hover.
          */}
          <span
            className="flex-1 truncate text-[11px]"
            style={{ ...MONO_STYLE, color: "var(--text-primary)" }}
            title={s.message || `stash@{${s.index}}`}
          >
            {s.message || `stash@{${s.index}}`}
          </span>
          <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button title={t.git_stash_pop} onClick={async () => { try { await onStashPop(s.index); } catch (err) { notify("error", t.git_stash_failed(String(err))); } }} className="rounded px-1 text-[9px] hover:bg-[var(--surface-hover)]" style={{ ...MONO_STYLE, color: "var(--cyan)" }}>Pop</button>
            <button title={t.git_stash_apply} onClick={async () => { try { await onStashApply(s.index); } catch (err) { notify("error", t.git_stash_failed(String(err))); } }} className="rounded px-1 text-[9px] hover:bg-[var(--surface-hover)]" style={{ ...MONO_STYLE, color: "var(--text-secondary)" }}>Apply</button>
            <button title={t.git_stash_drop} onClick={async () => { try { await onStashDrop(s.index); } catch (err) { notify("error", t.git_stash_failed(String(err))); } }} className="rounded px-1 text-[9px] hover:bg-[var(--surface-hover)]" style={{ ...MONO_STYLE, color: "var(--red)" }}>Drop</button>
          </span>
        </div>
      ))}
    </CollapsibleGroup>
  );
}

function FileListItem({
  entry,
  actions,
  expanded,
  onToggle,
  diffContent,
}: {
  entry: GitStatusEntry;
  actions: React.ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  diffContent?: React.ReactNode;
}) {
  const { fileName, directory } = getStatusDisplayPath(entry.path);
  const statusColor = getStatusColor(entry.status);
  const statusLabel = getStatusLabel(entry.status);

  return (
    <div>
      <div
        className="group flex items-center gap-1.5 mx-1 px-3 py-1 rounded-md hover:bg-[var(--surface-hover)] transition-colors duration-quick cursor-pointer"
        style={{ minHeight: 26 }}
        onClick={onToggle}
      >
        {onToggle && <IconChevron size={10} expanded={!!expanded} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="truncate text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-primary)" }}
            >
              {fileName}
            </span>
            {directory && (
              <span
                className="shrink-0 truncate text-[10px]"
                style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
              >
                {directory}
              </span>
            )}
          </div>
        </div>
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>{actions}</span>
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold"
          style={{ ...MONO_STYLE, color: statusColor }}
        >
          {statusLabel}
        </span>
      </div>
      {expanded && diffContent}
    </div>
  );
}

function BranchPopover({
  branches,
  currentBranch,
  onSelect,
  onClose,
  searchPlaceholder,
  onDelete,
  showNewBranch,
  onToggleNewBranch,
  newBranchName,
  onNewBranchNameChange,
  onCreateBranch,
}: {
  branches: string[];
  currentBranch: string | null;
  onSelect: (name: string) => void;
  onClose: () => void;
  searchPlaceholder: string;
  onDelete?: (name: string) => void;
  showNewBranch?: boolean;
  onToggleNewBranch?: () => void;
  newBranchName?: string;
  onNewBranchNameChange?: (name: string) => void;
  onCreateBranch?: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const newBranchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNewBranch) newBranchRef.current?.focus();
    else inputRef.current?.focus();
  }, [showNewBranch]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!query) return branches;
    const lower = query.toLowerCase();
    return branches.filter((b) => b.toLowerCase().includes(lower));
  }, [branches, query]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute left-2 right-2 z-50 overflow-hidden rounded-lg border shadow-lg"
        style={{
          top: "100%",
          marginTop: 4,
          backgroundColor: "var(--bg)",
          borderColor: "var(--border)",
        }}
      >
        <div
          className="flex items-center gap-1.5 border-b px-2 py-1.5"
          style={{ borderColor: "var(--border)" }}
        >
          <IconSearch />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
            style={MONO_STYLE}
          />
          {onToggleNewBranch && (
            <button
              onClick={onToggleNewBranch}
              className="shrink-0 rounded px-1 text-[10px] hover:bg-[var(--surface-hover)]"
              style={{ ...MONO_STYLE, color: "var(--accent)" }}
              title="New branch"
            >
              <IconPlus size={10} />
            </button>
          )}
        </div>
        {showNewBranch && onCreateBranch && onNewBranchNameChange && (
          <div className="flex items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
            <input
              ref={newBranchRef}
              value={newBranchName ?? ""}
              onChange={(e) => onNewBranchNameChange(e.target.value)}
              placeholder="Branch name..."
              className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
              style={MONO_STYLE}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCreateBranch(); } }}
            />
            <button onClick={onCreateBranch} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] hover:bg-[var(--surface-hover)]" style={{ ...MONO_STYLE, color: "var(--cyan)" }}>
              Create
            </button>
          </div>
        )}
        <div className="max-h-48 overflow-auto">
          {filtered.map((name) => (
            <div
              key={name}
              className="group flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--surface-hover)]"
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2"
                onClick={() => {
                  onSelect(name);
                  onClose();
                }}
              >
                <span className="w-3 text-center" style={{ color: "var(--accent)" }}>
                  {name === currentBranch ? "●" : ""}
                </span>
                <span className="truncate text-[11px]" style={{ ...MONO_STYLE, color: "var(--text-primary)" }}>
                  {name}
                </span>
              </button>
              {onDelete && name !== currentBranch && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(name); }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-[var(--surface-hover)]"
                  style={{ color: "var(--red)" }}
                  title="Delete branch"
                >
                  <IconX size={10} />
                </button>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-[var(--text-faint)]" style={MONO_STYLE}>
              No matching branches
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CommitDetailInline({
  contentInset = 24,
  worktreePath,
  hash,
}: {
  contentInset?: number;
  worktreePath: string;
  hash: string;
}) {
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setDetail(null);
    setExpandedFiles(new Set());

    window.termcanvas.git
      .commitDetail(worktreePath, hash)
      .then((result) => {
        if (mountedRef.current) {
          setDetail(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => {
      mountedRef.current = false;
    };
  }, [worktreePath, hash]);

  if (loading) {
    return (
      <div
        className="px-4 py-2 text-[10px] text-[var(--text-faint)]"
        style={MONO_STYLE}
      >
        Loading...
      </div>
    );
  }

  if (!detail) return null;

  const diffs = parseDiff(detail.diff, detail.files);
  const diffMap = new Map<string, string[]>();
  for (const d of diffs) {
    diffMap.set(d.file.name, d.hunks);
  }

  return (
    <div
      className="border-t"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 50%, transparent)",
        backgroundColor: "var(--surface)",
      }}
    >
      {detail.files.map((file) => {
        const isExpanded = expandedFiles.has(file.name);
        const hunks = diffMap.get(file.name);

        return (
          <div key={file.name}>
            <button
              className="flex w-full items-center gap-1.5 py-1 pr-6 text-left hover:bg-[var(--surface-hover)]"
              style={{ paddingLeft: contentInset }}
              onClick={() => {
                setExpandedFiles((prev) => {
                  const next = new Set(prev);
                  if (next.has(file.name)) next.delete(file.name);
                  else next.add(file.name);
                  return next;
                });
              }}
            >
              <IconChevron size={10} expanded={isExpanded} />
              <span
                className="min-w-0 flex-1 truncate text-[11px]"
                style={{ ...MONO_STYLE, color: "var(--text-secondary)" }}
              >
                {file.name}
              </span>
              <span
                className="text-[10px]"
                style={{ ...MONO_STYLE, color: "var(--cyan)" }}
              >
                {file.additions > 0 ? `+${file.additions}` : ""}
              </span>
              <span
                className="text-[10px]"
                style={{ ...MONO_STYLE, color: "var(--red)" }}
              >
                {file.deletions > 0 ? `-${file.deletions}` : ""}
              </span>
            </button>
            {isExpanded && hunks && hunks.length > 0 && (
              <div
                className="overflow-x-auto py-1 pr-6"
                style={{ paddingLeft: contentInset + 12 }}
              >
                {hunks.map((hunkContent, hunkIdx) => (
                  <div key={hunkIdx} style={{ minWidth: "fit-content" }}>
                    {hunkContent.split("\n").map((line, lineIdx) => {
                      let lineColor = "var(--text-muted)";
                      let lineBg = "transparent";
                      if (line.startsWith("+")) {
                        lineColor = "var(--cyan)";
                        lineBg =
                          "color-mix(in srgb, var(--cyan) 8%, transparent)";
                      } else if (line.startsWith("-")) {
                        lineColor = "var(--red)";
                        lineBg =
                          "color-mix(in srgb, var(--red) 8%, transparent)";
                      } else if (line.startsWith("@@")) {
                        lineColor = "var(--accent)";
                      }
                      return (
                        <div
                          key={lineIdx}
                          className="whitespace-pre text-[10px]"
                          style={{
                            ...MONO_STYLE,
                            color: lineColor,
                            backgroundColor: lineBg,
                          }}
                        >
                          {line}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GitGraphRail({
  model,
  totalHeight,
  onHoverCommit,
  onLeaveCommit,
  onSelectCommit,
}: {
  model: GitGraphRailModel;
  totalHeight: number;
  onHoverCommit: (hash: string) => void;
  onLeaveCommit: (hash: string) => void;
  onSelectCommit: (hash: string) => void;
}) {
  const hasInteractiveFocus = model.nodes.some(
    (node) => node.isSelected || node.isHovered,
  );
  const firstOverflowNode = model.nodes.find((node) => node.isOverflow) ?? null;

  return (
    <svg
      className="absolute left-0 top-0 z-10"
      width={model.railWidth}
      height={Math.max(totalHeight, 1)}
      viewBox={`0 0 ${model.railWidth} ${Math.max(totalHeight, 1)}`}
      fill="none"
      aria-hidden="true"
    >
      {model.edges.map((edge) => (
        <path
          key={`${edge.fromHash}-${edge.toHash}`}
          d={edge.path}
          stroke={edge.color}
          strokeWidth={edge.isFocused ? 1.6 : 1}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={hasInteractiveFocus ? (edge.isFocused ? 1 : 0.28) : 0.72}
        />
      ))}
      {model.nodes.map((node) => (
        <g
          key={node.hash}
          transform={`translate(${node.x} ${node.y})`}
          onClick={() => onSelectCommit(node.hash)}
          onMouseEnter={() => onHoverCommit(node.hash)}
          onMouseLeave={() => onLeaveCommit(node.hash)}
          style={{ cursor: "pointer" }}
        >
          {node.isSelected && (
            <circle
              r={8}
              fill="color-mix(in srgb, var(--accent) 16%, transparent)"
            />
          )}
          {node.isMerge && (
            <circle
              r={node.radius + 1.5}
              fill="transparent"
              stroke={node.color}
              strokeWidth={1}
              opacity={
                hasInteractiveFocus ? (node.isFocused ? 0.95 : 0.42) : 0.78
              }
            />
          )}
          <circle
            r={node.radius}
            fill={node.isOverflow ? "var(--surface)" : node.color}
            stroke={
              node.isOverflow
                ? node.color
                : "color-mix(in srgb, var(--bg) 78%, transparent)"
            }
            strokeWidth={node.isOverflow ? 1.2 : 0.8}
            opacity={
              hasInteractiveFocus
                ? node.isFocused || node.isSelected || node.isHovered
                  ? 1
                  : 0.42
                : 0.96
            }
          />
        </g>
      ))}
      {model.overflow && firstOverflowNode && (
        <text
          x={model.overflow.x + 8}
          y={firstOverflowNode.y + 3}
          style={{
            ...MONO_STYLE,
            fill: "var(--text-faint)",
            fontSize: "9px",
          }}
        >
          {model.overflow.label}
        </text>
      )}
    </svg>
  );
}

export function GitContent({
  worktreePath,
  onEnableHydra,
  hydraEnabling,
}: {
  worktreePath: string | null;
  onEnableHydra?: () => void;
  hydraEnabling?: boolean;
}) {
  const t = useT();
  const { notify } = useNotificationStore();

  const {
    commits,
    branches,
    edges,
    isGitRepo,
    loading,
    refreshing,
    loadingMore,
    refresh: refreshLog,
    loadMore,
    hasMore,
  } = useGitLog(worktreePath);
  const {
    stagedFiles,
    changedFiles,
    isLoading: statusLoading,
    refreshing: statusRefreshing,
    mergeState,
    stashes,
    refresh: refreshStatus,
    stageFiles,
    stageAll,
    unstageFiles,
    unstageAll,
    discardFiles,
    discardAll,
    commit,
    amend,
    push,
    pull,
    fetch: fetchRemote,
    stashCreate,
    stashApply,
    stashPop,
    stashDrop,
  } = useGitStatus(worktreePath);

  const branchInfo = useMemo(
    () => summarizeBranchInventory(branches),
    [branches],
  );
  const currentBranch = branches.find((b) => b.isCurrent);
  const aheadBehind = currentBranch
    ? buildAheadBehindLabel(currentBranch.ahead, currentBranch.behind)
    : null;
  const syncing = refreshing || statusRefreshing || loadingMore;

  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [initializingRepo, setInitializingRepo] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [amendMode, setAmendMode] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [hoveredCommitHash, setHoveredCommitHash] = useState<string | null>(
    null,
  );
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(
    null,
  );

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [detailHeight, setDetailHeight] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setViewportHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = detailRef.current;
    if (!el) {
      setDetailHeight(0);
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      setDetailHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedCommitHash]);

  const selectedIndex = useMemo(
    () =>
      selectedCommitHash
        ? commits.findIndex((commit) => commit.hash === selectedCommitHash)
        : -1,
    [commits, selectedCommitHash],
  );
  const effectiveDetailHeight = selectedIndex >= 0 ? detailHeight : 0;
  const effectiveViewportHeight = viewportHeight || 400;
  const commitWindow = useMemo(
    () =>
      getExpandedVirtualCommitWindow({
        itemCount: commits.length,
        rowHeight: ROW_HEIGHT,
        scrollTop,
        viewportHeight: effectiveViewportHeight,
        detailHeight: effectiveDetailHeight,
        selectedIndex,
      }),
    [
      commits.length,
      effectiveDetailHeight,
      effectiveViewportHeight,
      scrollTop,
      selectedIndex,
    ],
  );
  const historyHeight = commits.length * ROW_HEIGHT + effectiveDetailHeight;
  const graphRailModel = useMemo(
    () =>
      buildGitGraphRailModel({
        commits,
        detailHeight: effectiveDetailHeight,
        edges,
        hoveredCommitHash,
        rowHeight: ROW_HEIGHT,
        selectedCommitHash,
        selectedIndex,
        visibleEndIndex: commitWindow.endIndex,
        visibleStartIndex: commitWindow.startIndex,
      }),
    [
      commitWindow.endIndex,
      commitWindow.startIndex,
      commits,
      edges,
      effectiveDetailHeight,
      hoveredCommitHash,
      selectedCommitHash,
      selectedIndex,
    ],
  );
  const visibleCommits = commits.slice(
    commitWindow.startIndex,
    commitWindow.endIndex,
  );
  const handleCommitSelection = useCallback((hash: string) => {
    setDetailHeight(0);
    setSelectedCommitHash((prev) => (prev === hash ? null : hash));
  }, []);

  // Listen for external commit selection (from global search)
  useEffect(() => {
    const handler = (e: Event) => {
      const hash = (e as CustomEvent).detail;
      if (typeof hash === "string") {
        setDetailHeight(0);
        setSelectedCommitHash(hash);
      }
    };
    window.addEventListener("termcanvas:select-git-commit", handler);
    return () => window.removeEventListener("termcanvas:select-git-commit", handler);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshLog(), refreshStatus()]);
  }, [refreshLog, refreshStatus]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) {
      notify("warn", t.git_empty_commit_message);
      return;
    }
    setCommitting(true);
    try {
      if (amendMode) {
        const hash = await amend(commitMessage);
        setCommitMessage("");
        setAmendMode(false);
        notify("info", t.git_amend_success(hash.slice(0, 7)));
      } else {
        if (stagedFiles.length === 0 && changedFiles.length > 0) {
          await stageAll();
        }
        const hash = await commit(commitMessage);
        setCommitMessage("");
        notify("info", t.git_commit_success(hash.slice(0, 7)));
      }
      await refreshLog();
    } catch (error) {
      notify("error", amendMode ? t.git_amend_failed(String(error)) : t.git_commit_failed(String(error)));
    } finally {
      setCommitting(false);
    }
  }, [
    commitMessage,
    amendMode,
    stagedFiles,
    changedFiles,
    stageAll,
    commit,
    amend,
    refreshLog,
    notify,
    t,
  ]);

  const handlePush = useCallback(async () => {
    setPushing(true);
    try {
      await push();
      notify("info", t.git_push_success);
      await refreshLog();
    } catch (error) {
      notify("error", t.git_push_failed(String(error)));
    } finally {
      setPushing(false);
    }
  }, [push, refreshLog, notify, t]);

  const handlePull = useCallback(async () => {
    setPulling(true);
    try {
      await pull();
      notify("info", t.git_pull_success);
      await refreshAll();
    } catch (error) {
      notify("error", t.git_pull_failed(String(error)));
    } finally {
      setPulling(false);
    }
  }, [pull, refreshAll, notify, t]);

  const handleFetch = useCallback(async () => {
    setFetching(true);
    try {
      await fetchRemote();
      notify("info", t.git_fetch_success);
      await refreshLog();
    } catch (error) {
      notify("error", t.git_fetch_failed(String(error)));
    } finally {
      setFetching(false);
    }
  }, [fetchRemote, refreshLog, notify, t]);

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim() || !worktreePath) return;
    try {
      await window.termcanvas.git.branchCreate(worktreePath, newBranchName.trim());
      setNewBranchName("");
      setShowNewBranch(false);
      await refreshAll();
    } catch (error) {
      notify("error", t.git_branch_failed(String(error)));
    }
  }, [newBranchName, worktreePath, refreshAll, notify, t]);

  const handleDeleteBranch = useCallback(async (name: string) => {
    if (!worktreePath) return;
    try {
      await window.termcanvas.git.branchDelete(worktreePath, name, false);
      await refreshAll();
    } catch (error) {
      // Try force delete if normal delete fails
      try {
        await window.termcanvas.git.branchDelete(worktreePath, name, true);
        await refreshAll();
      } catch (err2) {
        notify("error", t.git_branch_failed(String(err2)));
      }
    }
  }, [worktreePath, refreshAll, notify, t]);

  const handleStageHunk = useCallback(async (filePath: string, hunkHeader: string) => {
    if (!worktreePath) return;
    try {
      await window.termcanvas.git.stageHunk(worktreePath, filePath, hunkHeader);
      await refreshStatus();
    } catch (error) {
      notify("error", t.git_hunk_failed(String(error)));
    }
  }, [worktreePath, refreshStatus, notify, t]);

  const handleUnstageHunk = useCallback(async (filePath: string, hunkHeader: string) => {
    if (!worktreePath) return;
    try {
      await window.termcanvas.git.unstageHunk(worktreePath, filePath, hunkHeader);
      await refreshStatus();
    } catch (error) {
      notify("error", t.git_hunk_failed(String(error)));
    }
  }, [worktreePath, refreshStatus, notify, t]);

  const handleBranchSwitch = useCallback(
    async (ref: string) => {
      setSwitchingBranch(true);
      try {
        await window.termcanvas.git.checkout(worktreePath!, ref);
        await refreshAll();
      } catch (error) {
        notify("error", t.git_checkout_failed(String(error)));
      } finally {
        setSwitchingBranch(false);
      }
    },
    [worktreePath, refreshAll, notify, t],
  );

  if (loading && !isGitRepo) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div
          className="h-4 w-4 animate-pulse rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
        />
      </div>
    );
  }

  if (!isGitRepo) {
    // Top-aligned, full-width block instead of a vertically-and-
    // horizontally centred card. The centred version floated in the
    // middle of the panel with a 260 px cap, which meant (a) at the
    // LeftPanel minimum of 200 px the card's max-width exceeded the
    // panel and the CTA button wrapped past the gutter, and (b) the
    // content didn't align with any of the other sidebar sections
    // (every other LeftPanel body pins content to the top-left).
    // Matches the spacing convention of the empty "No commits yet"
    // placeholder below — left-aligned, small mono copy, subtle
    // action.
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="px-3 py-3">
          <div
            className="text-[12px] font-medium text-[var(--text-primary)]"
            style={MONO_STYLE}
          >
            {t.git_not_repository}
          </div>
          <p
            className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]"
            style={MONO_STYLE}
          >
            {t.git_not_repository_hint}
          </p>
          <button
            className="mt-2 inline-flex h-7 items-center rounded-md border px-3 text-[11px] text-[var(--text-primary)] transition-colors duration-quick hover:bg-[var(--surface-hover)] disabled:opacity-60"
            style={{ ...MONO_STYLE, borderColor: "var(--border)" }}
            disabled={initializingRepo}
            onClick={async () => {
              setInitializingRepo(true);
              try {
                await window.termcanvas.git.init(worktreePath!);
                await refreshAll();
              } catch (error) {
                notify("error", t.git_init_failed(String(error)));
              } finally {
                setInitializingRepo(false);
              }
            }}
          >
            {initializingRepo ? t.git_init_busy : t.git_init}
          </button>
        </div>
      </div>
    );
  }

  const totalChanges = stagedFiles.length + changedFiles.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="relative shrink-0 border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-[var(--surface-hover)]"
            onClick={() => setBranchPopoverOpen((prev) => !prev)}
            disabled={switchingBranch}
            title={t.git_branch}
          >
            <span style={{ color: "var(--accent)" }}>
              <IconGitBranch size={14} />
            </span>
            <span
              className="truncate text-[12px] font-medium"
              style={{ ...MONO_STYLE, color: "var(--text-primary)" }}
            >
              {branchInfo.currentBranchName ?? "HEAD"}
            </span>
            {aheadBehind && (
              <span
                className="shrink-0 text-[10px]"
                style={{ ...MONO_STYLE, color: "var(--text-muted)" }}
              >
                {aheadBehind}
              </span>
            )}
          </button>

          <div className="flex items-center gap-0.5">
            <button
              title={t.git_fetch}
              disabled={fetching}
              onClick={handleFetch}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
              style={{ color: "var(--text-secondary)" }}
            >
              <IconDownload size={14} />
            </button>
            <button
              title={t.git_pull}
              disabled={pulling}
              onClick={handlePull}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
              style={{ color: "var(--text-secondary)" }}
            >
              <IconArrowDown size={14} />
            </button>
            <button
              title={t.git_push}
              disabled={pushing}
              onClick={handlePush}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
              style={{ color: "var(--text-secondary)" }}
            >
              <IconArrowUp size={14} />
            </button>
            <button
              title={t.git_refresh}
              onClick={refreshAll}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className={syncing ? "animate-spin" : undefined}>
                <IconRefresh size={14} />
              </span>
            </button>
            {onEnableHydra && (
              <button
                title="Hydra"
                disabled={hydraEnabling}
                onClick={onEnableHydra}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
                style={{ color: "var(--text-secondary)" }}
              >
                <IconHydra size={14} />
              </button>
            )}
          </div>
        </div>

        {branchPopoverOpen && (
          <BranchPopover
            branches={branchInfo.orderedLocalBranchNames}
            currentBranch={branchInfo.currentBranchName}
            onSelect={handleBranchSwitch}
            onClose={() => { setBranchPopoverOpen(false); setShowNewBranch(false); }}
            searchPlaceholder={t.git_search_branches}
            onDelete={handleDeleteBranch}
            showNewBranch={showNewBranch}
            onToggleNewBranch={() => setShowNewBranch((p) => !p)}
            newBranchName={newBranchName}
            onNewBranchNameChange={setNewBranchName}
            onCreateBranch={handleCreateBranch}
          />
        )}
      </div>

      {/* ── Merge state banner ── */}
      <MergeStateBanner mergeState={mergeState} worktreePath={worktreePath!} onRefresh={refreshAll} />

      <div
        className="shrink-0 border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={amendMode ? "Amend message..." : t.git_commit_message_placeholder}
              aria-label={t.git_commit_message_placeholder}
              className="h-7 min-w-0 w-full rounded-md border bg-transparent px-2 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
              style={{
                ...MONO_STYLE,
                borderColor: amendMode ? "var(--amber)" : "var(--border)",
                lineHeight: "18px",
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleCommit();
                }
              }}
            />
          </div>
          <button
            title={t.git_amend}
            onClick={() => setAmendMode((p) => !p)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: amendMode ? "var(--amber)" : "var(--text-faint)" }}
          >
            <IconPencil size={12} />
          </button>
          <button
            title={amendMode ? t.git_amend : t.git_commit}
            disabled={committing || !commitMessage.trim()}
            onClick={handleCommit}
            className="flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-md transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
            style={{
              color: commitMessage.trim()
                ? amendMode ? "var(--amber)" : "var(--accent)"
                : "var(--text-faint)",
            }}
          >
            <IconCheck size={16} />
          </button>
        </div>
      </div>

      {/* ── Changes area — shrinkable with cap ── */}
      {totalChanges > 0 ? (
        <div className="shrink-0 overflow-auto" style={{ maxHeight: "40%" }}>
          {stagedFiles.length > 0 && (
            <CollapsibleGroup
              title={t.git_staged_changes}
              count={stagedFiles.length}
              actions={
                <button
                  title={t.git_unstage_all}
                  onClick={async () => {
                    try {
                      await unstageAll();
                    } catch (error) {
                      notify("error", t.git_unstage_failed(String(error)));
                    }
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <IconMinus />
                </button>
              }
            >
              {stagedFiles.map((entry) => (
                <FileListItem
                  key={`staged-${entry.path}`}
                  entry={entry}
                  expanded={expandedFile === `staged:${entry.path}`}
                  onToggle={() => setExpandedFile((p) => p === `staged:${entry.path}` ? null : `staged:${entry.path}`)}
                  diffContent={
                    expandedFile === `staged:${entry.path}` && worktreePath ? (
                      <FileDiffInline
                        worktreePath={worktreePath}
                        filePath={entry.path}
                        staged={true}
                        onUnstageHunk={(hh) => handleUnstageHunk(entry.path, hh)}
                      />
                    ) : null
                  }
                  actions={
                    <ActionButton
                      title={t.git_unstage}
                      onClick={async () => {
                        try {
                          await unstageFiles([entry.path]);
                        } catch (error) {
                          notify("error", t.git_unstage_failed(String(error)));
                        }
                      }}
                    >
                      <IconMinus />
                    </ActionButton>
                  }
                />
              ))}
            </CollapsibleGroup>
          )}

          {changedFiles.length > 0 && (
            <CollapsibleGroup
              title={t.git_changes}
              count={changedFiles.length}
              actions={
                <>
                  <button
                    title={t.git_stage_all}
                    onClick={async () => {
                      try {
                        await stageAll();
                      } catch (error) {
                        notify("error", t.git_stage_failed(String(error)));
                      }
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <IconPlus />
                  </button>
                  <button
                    title={t.git_discard_all}
                    onClick={async () => {
                      try {
                        await discardAll();
                      } catch (error) {
                        notify("error", t.git_discard_failed(String(error)));
                      }
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <IconX />
                  </button>
                </>
              }
            >
              {changedFiles.map((entry) => (
                <FileListItem
                  key={`changed-${entry.path}`}
                  entry={entry}
                  expanded={expandedFile === `changed:${entry.path}`}
                  onToggle={() => setExpandedFile((p) => p === `changed:${entry.path}` ? null : `changed:${entry.path}`)}
                  diffContent={
                    expandedFile === `changed:${entry.path}` && worktreePath ? (
                      <FileDiffInline
                        worktreePath={worktreePath}
                        filePath={entry.path}
                        staged={false}
                        onStageHunk={(hh) => handleStageHunk(entry.path, hh)}
                      />
                    ) : null
                  }
                  actions={
                    <>
                      <ActionButton
                        title={t.git_stage}
                        onClick={async () => {
                          try {
                            await stageFiles([entry.path]);
                          } catch (error) {
                            notify("error", t.git_stage_failed(String(error)));
                          }
                        }}
                      >
                        <IconPlus />
                      </ActionButton>
                      <ActionButton
                        title={t.git_discard}
                        onClick={async () => {
                          try {
                            await discardFiles([entry]);
                          } catch (error) {
                            notify(
                              "error",
                              t.git_discard_failed(String(error)),
                            );
                          }
                        }}
                      >
                        <IconX />
                      </ActionButton>
                    </>
                  }
                />
              ))}
            </CollapsibleGroup>
          )}
        </div>
      ) : !statusLoading ? (
        <div
          className="shrink-0 px-4 py-6 text-center text-[11px]"
          style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
        >
          {t.git_nothing_to_commit}
        </div>
      ) : null}

      {/* ── Stash ── */}
      <StashSection
        stashes={stashes}
        worktreePath={worktreePath!}
        onStashCreate={stashCreate}
        onStashApply={stashApply}
        onStashPop={stashPop}
        onStashDrop={stashDrop}
      />

      {/* ── History — fills remaining space ── */}
      <CollapsibleGroup
        title={t.git_history}
        count={commits.length}
        // History defaults to expanded. The previous logic was
        // `totalChanges === 0` — collapse history whenever there
        // were uncommitted changes. The intent was "prioritize the
        // changes view when there's work to do", but in practice
        // most projects have at least one uncommitted file most of
        // the time, so the panel almost never showed history without
        // an extra click. The Changes panel above is already
        // height-capped at 40%, so history has dedicated space
        // either way; defaulting to expanded means a freshly-focused
        // project shows recent commits without a click.
        defaultExpanded
        className="flex-1 min-h-0 flex flex-col"
      >
        {commits.length === 0 ? (
          <div
            className="px-4 py-3 text-[11px]"
            style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
          >
            {t.git_no_commits}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="relative flex-1 min-h-0 overflow-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              setScrollTop(el.scrollTop);
              setViewportHeight(el.clientHeight);

              if (
                hasMore &&
                el.scrollHeight - el.scrollTop - el.clientHeight < 160
              ) {
                loadMore();
              }
            }}
          >
            <div style={{ height: historyHeight, position: "relative" }}>
              <GitGraphRail
                model={graphRailModel}
                totalHeight={historyHeight}
                onHoverCommit={setHoveredCommitHash}
                onLeaveCommit={(hash) => {
                  setHoveredCommitHash((prev) => (prev === hash ? null : prev));
                }}
                onSelectCommit={handleCommitSelection}
              />
              {visibleCommits.map((c, i) => {
                const actualIndex = commitWindow.startIndex + i;
                const isSelected = c.hash === selectedCommitHash;
                const isHovered = c.hash === hoveredCommitHash;
                const isMergeCommit = c.parents.length > 1;
                const { visibleRefs, hiddenCount } = summarizeCommitRefs(
                  c.refs,
                  {
                    currentBranchName: branchInfo.currentBranchName,
                    localBranchNames: branchInfo.orderedLocalBranchNames,
                    maxVisible: 3,
                  },
                );
                const rowTop = getCommitRowTop({
                  detailHeight: effectiveDetailHeight,
                  row: actualIndex,
                  rowHeight: ROW_HEIGHT,
                  selectedIndex,
                });

                return (
                  <div key={c.hash}>
                    <button
                      className="flex w-full items-center gap-2 pr-3 text-left transition-colors duration-quick"
                      style={{
                        position: "absolute",
                        top: rowTop,
                        height: ROW_HEIGHT,
                        width: "100%",
                        paddingLeft: graphRailModel.railWidth + 4,
                        backgroundColor: isSelected
                          ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                          : isHovered
                            ? "color-mix(in srgb, var(--surface-hover) 82%, transparent)"
                            : undefined,
                      }}
                      onClick={() => handleCommitSelection(c.hash)}
                      onMouseEnter={() => setHoveredCommitHash(c.hash)}
                      onMouseLeave={() => {
                        setHoveredCommitHash((prev) =>
                          prev === c.hash ? null : prev,
                        );
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="truncate text-[11px]"
                            style={{
                              ...MONO_STYLE,
                              color: isMergeCommit
                                ? "var(--text-secondary)"
                                : "var(--text-primary)",
                            }}
                          >
                            {c.message}
                          </span>
                          {isMergeCommit && (
                            <span
                              className="shrink-0 rounded px-1 text-[9px]"
                              style={{
                                ...MONO_STYLE,
                                color: "var(--text-secondary)",
                                backgroundColor:
                                  "color-mix(in srgb, var(--text-secondary) 10%, transparent)",
                              }}
                            >
                              merge
                            </span>
                          )}
                          {visibleRefs.map((ref) => (
                            <span
                              key={ref}
                              className="shrink-0 rounded px-1 text-[9px]"
                              style={{
                                ...MONO_STYLE,
                                color: ref.startsWith("HEAD")
                                  ? "var(--bg)"
                                  : "var(--accent)",
                                backgroundColor: ref.startsWith("HEAD")
                                  ? "var(--accent)"
                                  : "color-mix(in srgb, var(--accent) 14%, transparent)",
                              }}
                            >
                              {ref}
                            </span>
                          ))}
                          {hiddenCount > 0 && (
                            <span
                              className="shrink-0 text-[9px]"
                              style={{
                                ...MONO_STYLE,
                                color: "var(--text-faint)",
                              }}
                            >
                              +{hiddenCount}
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-0.5 flex items-center gap-2 text-[10px]"
                          style={MONO_STYLE}
                        >
                          <span style={{ color: "var(--text-faint)" }}>
                            {c.hash.slice(0, 7)}
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>
                            {c.author}
                          </span>
                          <span style={{ color: "var(--text-faint)" }}>
                            {formatRelativeTime(c.date)}
                          </span>
                        </div>
                      </div>
                    </button>
                    {isSelected && (
                      <div
                        ref={detailRef}
                        style={{
                          position: "absolute",
                          top: rowTop + ROW_HEIGHT,
                          left: graphRailModel.railWidth,
                          right: 0,
                          zIndex: 5,
                          backgroundColor: "var(--surface)",
                        }}
                      >
                        <CommitDetailInline
                          worktreePath={worktreePath!}
                          hash={c.hash}
                          contentInset={6}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CollapsibleGroup>
    </div>
  );
}
