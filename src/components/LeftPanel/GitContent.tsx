import { useEffect, useMemo, useRef, useState } from "react";

import { useGitLog } from "../../hooks/useGitLog";
import { useT } from "../../i18n/useT";
import { useLocaleStore } from "../../stores/localeStore";
import { useNotificationStore } from "../../stores/notificationStore";
import type { GitBranchInfo, GitCommitDetail } from "../../types";
import { parseDiff, type FileDiff } from "../../utils/diffParser";
import {
  buildAheadBehindLabel,
  getVirtualCommitWindow,
  summarizeBranchInventory,
  summarizeCommitFileStats,
  summarizeCommitRefs,
  summarizeGitHistoryMetrics,
  type CommitFileStats,
} from "./gitContentLayout";

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;
const LANE_WIDTH = 14;
const ROW_HEIGHT = 54;
const GRAPH_WIDTH = 72;
const GRAPH_PADDING = 20;

type ChipTone = "neutral" | "accent" | "cyan" | "amber" | "danger";

const CHIP_TONE_STYLES: Record<ChipTone, React.CSSProperties> = {
  neutral: {
    color: "var(--text-secondary)",
    backgroundColor: "color-mix(in srgb, var(--surface) 82%, transparent)",
    borderColor: "var(--border)",
  },
  accent: {
    color: "color-mix(in srgb, var(--accent) 76%, var(--text-primary) 24%)",
    backgroundColor: "color-mix(in srgb, var(--accent) 11%, transparent)",
    borderColor: "color-mix(in srgb, var(--accent) 24%, transparent)",
  },
  cyan: {
    color: "color-mix(in srgb, var(--cyan) 80%, var(--text-primary) 20%)",
    backgroundColor: "color-mix(in srgb, var(--cyan) 11%, transparent)",
    borderColor: "color-mix(in srgb, var(--cyan) 24%, transparent)",
  },
  amber: {
    color: "color-mix(in srgb, var(--amber) 82%, var(--text-primary) 18%)",
    backgroundColor: "color-mix(in srgb, var(--amber) 11%, transparent)",
    borderColor: "color-mix(in srgb, var(--amber) 24%, transparent)",
  },
  danger: {
    color: "color-mix(in srgb, var(--red) 80%, var(--text-primary) 20%)",
    backgroundColor: "color-mix(in srgb, var(--red) 10%, transparent)",
    borderColor: "color-mix(in srgb, var(--red) 24%, transparent)",
  },
};

function ChangeBar({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const total = additions + deletions;
  if (total === 0) return null;

  const max = 5;
  const addBlocks = Math.round((additions / total) * max);
  const delBlocks = max - addBlocks;

  return (
    <span className="ml-1 inline-flex gap-px">
      {Array.from({ length: addBlocks }, (_, index) => (
        <span
          key={`a${index}`}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "var(--cyan)" }}
        />
      ))}
      {Array.from({ length: delBlocks }, (_, index) => (
        <span
          key={`d${index}`}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "var(--red)" }}
        />
      ))}
    </span>
  );
}

function MetricTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  tone?: ChipTone;
}) {
  const toneStyle = CHIP_TONE_STYLES[tone];

  return (
    <div
      className="rounded-xl border px-2.5 py-2"
      style={{
        backgroundColor: toneStyle.backgroundColor,
        borderColor: toneStyle.borderColor,
      }}
    >
      <div
        className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-faint)]"
        style={MONO_STYLE}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[15px] leading-none tabular-nums"
        style={{ ...MONO_STYLE, color: toneStyle.color }}
      >
        {value}
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value?: React.ReactNode;
  tone?: ChipTone;
}) {
  const toneStyle = CHIP_TONE_STYLES[tone];
  const hasValue = value !== undefined && value !== null && value !== "";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1"
      style={{
        color: toneStyle.color,
        backgroundColor: toneStyle.backgroundColor,
        borderColor: toneStyle.borderColor,
      }}
    >
      <span className="text-[9px] uppercase tracking-[0.12em] opacity-80" style={MONO_STYLE}>
        {label}
      </span>
      {hasValue && (
        <span className="text-[10px] tabular-nums" style={MONO_STYLE}>
          {value}
        </span>
      )}
    </span>
  );
}

function formatRelativeTime(dateString: string, locale: string) {
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) {
    return dateString;
  }

  const elapsedSeconds = Math.round((target.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units = [
    { unit: "year" as const, seconds: 60 * 60 * 24 * 365 },
    { unit: "month" as const, seconds: 60 * 60 * 24 * 30 },
    { unit: "week" as const, seconds: 60 * 60 * 24 * 7 },
    { unit: "day" as const, seconds: 60 * 60 * 24 },
    { unit: "hour" as const, seconds: 60 * 60 },
    { unit: "minute" as const, seconds: 60 },
  ];

  for (const { unit, seconds } of units) {
    if (Math.abs(elapsedSeconds) >= seconds) {
      return formatter.format(Math.round(elapsedSeconds / seconds), unit);
    }
  }

  return formatter.format(elapsedSeconds, "second");
}

function formatAbsoluteTime(dateString: string, locale: string) {
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(target);
}

function refBadgeStyle(ref: string): React.CSSProperties {
  if (ref.startsWith("HEAD")) {
    return {
      color: "var(--bg)",
      backgroundColor: "var(--accent)",
      borderColor: "color-mix(in srgb, var(--accent) 86%, transparent)",
    };
  }

  if (ref.startsWith("tag:")) {
    return {
      color: "color-mix(in srgb, var(--amber) 92%, var(--text-primary) 8%)",
      backgroundColor: "color-mix(in srgb, var(--amber) 12%, transparent)",
      borderColor: "color-mix(in srgb, var(--amber) 26%, transparent)",
    };
  }

  if (ref.startsWith("origin/")) {
    return {
      color: "color-mix(in srgb, var(--accent) 72%, var(--text-primary) 28%)",
      backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
      borderColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
    };
  }

  return {
    color: "var(--text-secondary)",
    backgroundColor: "color-mix(in srgb, var(--surface) 76%, transparent)",
    borderColor: "var(--border)",
  };
}

function renderEdge(edge: {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: string;
}) {
  const fromX = GRAPH_PADDING + edge.fromLane * LANE_WIDTH;
  const toX = GRAPH_PADDING + edge.toLane * LANE_WIDTH;
  const fromY = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const toY = edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

  if (fromX === toX) {
    return (
      <line
        key={`${edge.fromLane}-${edge.fromRow}-${edge.toLane}-${edge.toRow}`}
        x1={fromX}
        y1={fromY}
        x2={toX}
        y2={toY}
        stroke={edge.color}
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.84"
      />
    );
  }

  const controlY = fromY + (toY - fromY) / 2;
  const path = `M ${fromX} ${fromY} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${toY}`;

  return (
    <path
      key={`${edge.fromLane}-${edge.fromRow}-${edge.toLane}-${edge.toRow}`}
      d={path}
      fill="none"
      stroke={edge.color}
      strokeWidth="1.25"
      strokeLinecap="round"
      opacity="0.84"
    />
  );
}

function getDisplayPath(fileName: string): { baseName: string; directory: string } {
  const normalized = fileName.includes("=>")
    ? fileName.slice(fileName.lastIndexOf("=>") + 2).replace(/[{}]/g, "").trim()
    : fileName.replace(/[{}]/g, "").trim();
  const segments = normalized.split("/").filter(Boolean);
  const baseName = segments.pop() ?? normalized;

  return {
    baseName,
    directory: segments.join("/"),
  };
}

function CommitFileList({
  fileDiffs,
  summary,
}: {
  fileDiffs: FileDiff[];
  summary: CommitFileStats | null;
}) {
  const t = useT();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  if (fileDiffs.length === 0) {
    return (
      <div className="px-3 py-4 text-[11px] text-[var(--text-muted)]">
        {t.no_changes}
      </div>
    );
  }

  return (
    <div className="min-h-0">
      {summary && (
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-3 py-2 backdrop-blur"
          style={{
            backgroundColor: "color-mix(in srgb, var(--surface) 90%, transparent)",
          }}
        >
          <StatChip label={t.git_files} value={summary.totalFiles} />
          <StatChip label="+" value={summary.additions} tone="cyan" />
          <StatChip label="-" value={summary.deletions} tone="danger" />
          {summary.binaryCount > 0 && (
            <StatChip label={t.binary_label} value={summary.binaryCount} tone="amber" />
          )}
          {summary.imageCount > 0 && (
            <StatChip label={t.git_images} value={summary.imageCount} tone="accent" />
          )}
          {summary.renamedCount > 0 && (
            <StatChip label={t.git_renames} value={summary.renamedCount} tone="neutral" />
          )}
        </div>
      )}

      {fileDiffs.map((fileDiff) => {
        const expanded = expandedFiles.has(fileDiff.file.name);
        const path = getDisplayPath(fileDiff.file.name);
        const renamed = fileDiff.file.name.includes("=>");

        return (
          <div key={fileDiff.file.name} className="border-b border-[color-mix(in_srgb,var(--border)_55%,transparent)] last:border-b-0">
            <button
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--surface-hover)]"
              onClick={() =>
                setExpandedFiles((current) => {
                  const next = new Set(current);
                  if (next.has(fileDiff.file.name)) {
                    next.delete(fileDiff.file.name);
                  } else {
                    next.add(fileDiff.file.name);
                  }
                  return next;
                })
              }
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="none"
                className={`mt-1 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
              >
                <path
                  d="M2 1L6 4L2 7"
                  stroke="var(--text-muted)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 truncate text-[11px] text-[var(--text-primary)]">
                    {path.baseName}
                  </span>
                  {renamed && (
                    <StatChip label={t.git_rename_label} value="" tone="neutral" />
                  )}
                  {fileDiff.file.isImage && (
                    <StatChip label={t.git_image_label} value="" tone="accent" />
                  )}
                  {fileDiff.file.binary && !fileDiff.file.isImage && (
                    <StatChip label={t.binary_label} value="" tone="amber" />
                  )}
                </div>
                {path.directory && (
                  <div className="mt-1 truncate text-[10px] text-[var(--text-faint)]" style={MONO_STYLE}>
                    {path.directory}
                  </div>
                )}
              </div>

              {fileDiff.file.binary ? (
                <span className="mt-0.5 shrink-0 text-[10px] text-[var(--text-muted)]">
                  {t.binary_label}
                </span>
              ) : (
                <div className="mt-0.5 shrink-0 text-right">
                  <div className="flex items-center justify-end gap-1 text-[10px]" style={MONO_STYLE}>
                    <span style={{ color: "var(--cyan)" }}>+{fileDiff.file.additions}</span>
                    <span style={{ color: "var(--red)" }}>-{fileDiff.file.deletions}</span>
                  </div>
                  <div className="mt-1 flex justify-end">
                    <ChangeBar
                      additions={fileDiff.file.additions}
                      deletions={fileDiff.file.deletions}
                    />
                  </div>
                </div>
              )}
            </button>

            {expanded && (
              <div
                className="overflow-x-auto border-t border-[var(--border)]"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--bg) 86%, var(--surface) 14%)",
                }}
              >
                {fileDiff.file.isImage ? (
                  <div className="flex items-start gap-3 px-3 py-3">
                    {fileDiff.file.imageOld && (
                      <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <span className="text-[11px] text-[var(--red)]">{t.removed}</span>
                        <img
                          src={fileDiff.file.imageOld}
                          alt="old"
                          className="max-h-40 max-w-full rounded border border-[var(--border)] object-contain"
                          style={{
                            background:
                              "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%) 50% / 12px 12px",
                          }}
                        />
                      </div>
                    )}
                    {fileDiff.file.imageOld && fileDiff.file.imageNew && (
                      <span className="self-center text-[13px] text-[var(--text-muted)]">→</span>
                    )}
                    {fileDiff.file.imageNew && (
                      <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <span className="text-[11px]" style={{ color: "var(--cyan)" }}>
                          {fileDiff.file.imageOld ? t.file_new : t.added}
                        </span>
                        <img
                          src={fileDiff.file.imageNew}
                          alt="new"
                          className="max-h-40 max-w-full rounded border border-[var(--border)] object-contain"
                          style={{
                            background:
                              "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%) 50% / 12px 12px",
                          }}
                        />
                      </div>
                    )}
                    {!fileDiff.file.imageOld && !fileDiff.file.imageNew && (
                      <div className="w-full py-2 text-center text-[11px] text-[var(--text-muted)]">
                        {t.image_changed}
                      </div>
                    )}
                  </div>
                ) : fileDiff.file.binary ? (
                  <div className="px-3 py-3 text-center text-[11px] text-[var(--text-muted)]">
                    {t.binary_changed}
                  </div>
                ) : (
                  <pre className="px-3 py-2 text-[11px] leading-relaxed" style={MONO_STYLE}>
                    {fileDiff.hunks.join("\n").split("\n").map((line, index) => {
                      let color = "var(--text-secondary)";
                      let backgroundColor = "transparent";

                      if (line.startsWith("+") && !line.startsWith("+++")) {
                        color = "var(--cyan)";
                        backgroundColor = "color-mix(in srgb, var(--cyan) 10%, transparent)";
                      } else if (line.startsWith("-") && !line.startsWith("---")) {
                        color = "var(--red)";
                        backgroundColor = "color-mix(in srgb, var(--red) 10%, transparent)";
                      } else if (line.startsWith("@@")) {
                        color = "var(--accent)";
                      } else if (
                        line.startsWith("index ") ||
                        line.startsWith("---") ||
                        line.startsWith("+++")
                      ) {
                        color = "var(--text-muted)";
                      }

                      return (
                        <div
                          key={`${fileDiff.file.name}-${index}`}
                          style={{ color, backgroundColor }}
                        >
                          {line || " "}
                        </div>
                      );
                    })}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  worktreePath: string | null;
}

export function GitContent({ worktreePath }: Props) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const notify = useNotificationStore((state) => state.notify);
  const {
    commits,
    branches,
    edges,
    isGitRepo,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    refresh,
    loadMore,
  } = useGitLog(worktreePath);

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, GitCommitDetail | null>>({});
  const [detailLoadingHash, setDetailLoadingHash] = useState<string | null>(null);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [initializingRepo, setInitializingRepo] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const detailRequestSeqRef = useRef(0);

  const repoName = useMemo(() => {
    if (!worktreePath) return null;
    const parts = worktreePath.split(/[/\\]+/).filter(Boolean);
    return parts[parts.length - 1] ?? worktreePath;
  }, [worktreePath]);

  const currentBranch = useMemo(
    () => branches.find((branch) => branch.isCurrent) ?? null,
    [branches],
  );
  const localBranches = useMemo(
    () => branches.filter((branch) => !branch.isRemote),
    [branches],
  );
  const branchInventory = useMemo(
    () => summarizeBranchInventory(branches),
    [branches],
  );
  const orderedLocalBranches = useMemo(() => {
    const byName = new Map(localBranches.map((branch) => [branch.name, branch]));
    return branchInventory.orderedLocalBranchNames
      .map((name) => byName.get(name))
      .filter((branch): branch is GitBranchInfo => Boolean(branch));
  }, [branchInventory.orderedLocalBranchNames, localBranches]);
  const historyMetrics = useMemo(
    () => summarizeGitHistoryMetrics(commits),
    [commits],
  );
  const selectedCommit = useMemo(
    () => commits.find((commit) => commit.hash === selectedHash) ?? null,
    [commits, selectedHash],
  );
  const selectedDetail =
    selectedHash && Object.prototype.hasOwnProperty.call(detailCache, selectedHash)
      ? detailCache[selectedHash]
      : undefined;
  const detailLoading = detailLoadingHash === selectedHash && selectedDetail === undefined;
  const detailFileDiffs = useMemo(
    () => (selectedDetail ? parseDiff(selectedDetail.diff, selectedDetail.files) : []),
    [selectedDetail],
  );
  const detailSummary = useMemo(
    () => (selectedDetail ? summarizeCommitFileStats(selectedDetail.files) : null),
    [selectedDetail],
  );
  const branchStatus = currentBranch
    ? buildAheadBehindLabel(currentBranch.ahead, currentBranch.behind) ?? t.git_up_to_date
    : null;

  useEffect(() => {
    setSelectedHash(null);
    setDetailCache({});
    setDetailLoadingHash(null);
    setDetailCollapsed(false);
    setScrollTop(0);
  }, [worktreePath]);

  useEffect(() => {
    if (commits.length === 0) {
      setSelectedHash(null);
      return;
    }

    if (!selectedHash || !commits.some((commit) => commit.hash === selectedHash)) {
      setSelectedHash(commits[0].hash);
    }
  }, [commits, selectedHash]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    setViewportHeight(element.clientHeight);
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!worktreePath || !selectedHash || !window.termcanvas) {
      setDetailLoadingHash(null);
      return;
    }

    if (selectedDetail !== undefined) {
      setDetailLoadingHash((current) => (current === selectedHash ? null : current));
      return;
    }

    const requestSeq = ++detailRequestSeqRef.current;
    let cancelled = false;
    setDetailLoadingHash(selectedHash);

    window.termcanvas.git
      .commitDetail(worktreePath, selectedHash)
      .then((nextDetail) => {
        if (cancelled || requestSeq !== detailRequestSeqRef.current) {
          return;
        }
        setDetailCache((current) => ({
          ...current,
          [selectedHash]: nextDetail,
        }));
      })
      .catch((error) => {
        if (cancelled || requestSeq !== detailRequestSeqRef.current) {
          return;
        }
        notify("error", t.git_commit_detail_failed(String(error)));
      })
      .finally(() => {
        if (cancelled || requestSeq !== detailRequestSeqRef.current) {
          return;
        }
        setDetailLoadingHash((current) => (current === selectedHash ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [notify, selectedDetail, selectedHash, t, worktreePath]);

  const { startIndex, endIndex } = getVirtualCommitWindow({
    itemCount: commits.length,
    rowHeight: ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  });
  const visibleCommits = commits.slice(startIndex, endIndex);
  const visibleEdges = edges.filter((edge) => {
    const minRow = Math.min(edge.fromRow, edge.toRow);
    const maxRow = Math.max(edge.fromRow, edge.toRow);
    return maxRow >= startIndex - 1 && minRow <= endIndex + 1;
  });

  if (!worktreePath) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-[11px] text-[var(--text-muted)]">
          {t.no_worktree_selected}
        </span>
      </div>
    );
  }

  if (loading && commits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-[11px] text-[var(--text-muted)]">{t.loading}</span>
      </div>
    );
  }

  if (!isGitRepo) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div
          className="w-full max-w-[272px] rounded-2xl border px-4 py-4"
          style={{
            borderColor: "var(--border)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--bg) 82%, var(--surface) 18%) 0%, color-mix(in srgb, var(--bg) 72%, var(--surface) 28%) 100%)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "var(--amber)" }}
            />
            <div
              className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
              style={MONO_STYLE}
            >
              {t.left_panel_git}
            </div>
          </div>
          <div className="mt-2 text-[13px] text-[var(--text-primary)]" style={MONO_STYLE}>
            {t.git_not_repository}
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">
            {t.git_not_repository_hint}
          </p>
          <button
            className="mt-4 inline-flex h-8 items-center rounded-full border px-3 text-[11px] text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-hover)] disabled:opacity-60"
            style={MONO_STYLE}
            disabled={initializingRepo}
            onClick={async () => {
              setInitializingRepo(true);
              try {
                await window.termcanvas.git.init(worktreePath);
                await refresh();
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="shrink-0 border-b border-[var(--border)] px-3 py-3"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--bg) 86%, var(--surface) 14%) 0%, color-mix(in srgb, var(--bg) 76%, var(--surface) 24%) 100%)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
              style={MONO_STYLE}
            >
              <span>{t.left_panel_git}</span>
              {refreshing && <span className="status-pulse">{t.loading}</span>}
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
              {repoName && (
                <StatChip label={t.left_panel_git} value={repoName} tone="neutral" />
              )}
              {branchInventory.currentBranchName && (
                <StatChip label={t.git_branch} value={branchInventory.currentBranchName} tone="accent" />
              )}
              {branchStatus && (
                <StatChip label={t.git_sync} value={branchStatus} tone="cyan" />
              )}
            </div>
          </div>

          <button
            className="inline-flex h-8 items-center rounded-full border border-[var(--border)] px-3 text-[10px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            style={MONO_STYLE}
            onClick={() => {
              void refresh().catch((error) => {
                notify("error", t.git_refresh_failed(String(error)));
              });
            }}
          >
            {t.git_refresh}
          </button>
        </div>

        <div
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))" }}
        >
          <MetricTile
            label={t.git_loaded_commits}
            value={historyMetrics.commitCount}
            tone="accent"
          />
          <MetricTile
            label={t.git_contributors}
            value={historyMetrics.contributorCount}
            tone="neutral"
          />
          <MetricTile label={t.git_refs} value={historyMetrics.referencedCommitCount} tone="cyan" />
          <MetricTile label={t.git_merges} value={historyMetrics.mergeCount} tone="amber" />
        </div>

        <div
          className="mt-3 rounded-2xl border border-[var(--border)]"
          style={{
            backgroundColor: "color-mix(in srgb, var(--surface) 88%, transparent)",
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">
              <div
                className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-faint)]"
                style={MONO_STYLE}
              >
                {t.git_branch}
              </div>
              <div className="mt-1.5 min-w-0 text-[12px] text-[var(--text-primary)]">
                {branchInventory.currentBranchName ?? "HEAD"}
              </div>
              {branchInventory.trackingName && (
                <div className="mt-1 text-[10px] text-[var(--text-muted)]" style={MONO_STYLE}>
                  {t.git_tracking} {branchInventory.trackingName}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <StatChip label={t.git_local_branches} value={branchInventory.localBranchCount} />
              <StatChip label={t.git_remote_branches} value={branchInventory.remoteBranchCount} tone="neutral" />
            </div>
          </div>

          <div className="border-t border-[var(--border)] px-3 py-2.5">
            <label
              className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
              style={MONO_STYLE}
            >
              {t.git_branch}
            </label>
            <select
              className="w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
              style={MONO_STYLE}
              disabled={switchingBranch || orderedLocalBranches.length === 0}
              value={currentBranch?.name ?? branchInventory.currentBranchName ?? ""}
              onChange={async (event) => {
                const nextBranch = event.target.value;
                if (!nextBranch || nextBranch === currentBranch?.name) {
                  return;
                }

                setSwitchingBranch(true);
                try {
                  await window.termcanvas.git.checkout(worktreePath, nextBranch);
                  await refresh();
                } catch (error) {
                  notify("error", t.git_checkout_failed(String(error)));
                } finally {
                  setSwitchingBranch(false);
                }
              }}
            >
              {orderedLocalBranches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateRows: detailCollapsed
            ? "minmax(0,1fr) 52px"
            : "minmax(0,1fr) minmax(224px, 38%)",
          transition: "grid-template-rows 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div
            className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2"
            style={{
              backgroundColor: "color-mix(in srgb, var(--surface) 84%, transparent)",
            }}
          >
            <div className="min-w-0">
              <div
                className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
                style={MONO_STYLE}
              >
                {t.git_history}
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--text-muted)]" style={MONO_STYLE}>
                {historyMetrics.commitCount} {t.git_loaded_commits.toLowerCase()}
              </div>
            </div>
            {selectedHash && (
              <StatChip label={t.git_selected} value={selectedHash.slice(0, 7)} tone="neutral" />
            )}
          </div>

          <div
            ref={scrollRef}
            className="relative min-h-0 flex-1 overflow-auto"
            onScroll={(event) => {
              const element = event.currentTarget;
              setScrollTop(element.scrollTop);
              if (
                hasMore &&
                !loadingMore &&
                element.scrollHeight - element.scrollTop - element.clientHeight < 160
              ) {
                loadMore();
              }
            }}
          >
            {commits.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <span className="text-[11px] text-[var(--text-muted)]">
                  {t.git_no_commits}
                </span>
              </div>
            ) : (
              <>
                <div
                  className="relative"
                  style={{
                    height: commits.length * ROW_HEIGHT,
                    ...MONO_STYLE,
                  }}
                >
                  <svg
                    className="pointer-events-none absolute left-0 top-0"
                    width={GRAPH_WIDTH}
                    height={commits.length * ROW_HEIGHT}
                  >
                    {visibleEdges.map((edge) => renderEdge(edge))}
                  </svg>

                  {visibleCommits.map((commit) => {
                    const selected = commit.hash === selectedHash;
                    const nodeColor =
                      edges.find(
                        (edge) =>
                          edge.fromRow === commit.row && edge.fromLane === commit.lane,
                      )?.color ?? "var(--accent)";
                    const refSummary = summarizeCommitRefs(commit.refs, 2);

                    return (
                      <button
                        key={commit.hash}
                        className={`absolute left-0 right-0 grid grid-cols-[72px,minmax(0,1fr)] text-left transition-colors duration-150 ${
                          selected ? "" : "hover:bg-[var(--surface-hover)]"
                        }`}
                        style={{
                          top: commit.row * ROW_HEIGHT,
                          height: ROW_HEIGHT,
                          background: selected
                            ? "linear-gradient(90deg, color-mix(in srgb, var(--accent) 16%, transparent) 0%, color-mix(in srgb, var(--surface-hover) 88%, var(--accent) 12%) 100%)"
                            : undefined,
                        }}
                        onClick={() => {
                          setSelectedHash(commit.hash);
                          setDetailCollapsed(false);
                        }}
                      >
                        <div className="relative h-full" style={{ width: GRAPH_WIDTH }}>
                          <span
                            className="absolute left-0 top-2.5 h-[calc(100%-20px)] w-px rounded-full"
                            style={{
                              backgroundColor: selected
                                ? "color-mix(in srgb, var(--accent) 55%, transparent)"
                                : "transparent",
                            }}
                          />
                          <span
                            className="absolute rounded-full border"
                            style={{
                              top: ROW_HEIGHT / 2 - 4.5,
                              left: GRAPH_PADDING + commit.lane * LANE_WIDTH - 4.5,
                              width: 9,
                              height: 9,
                              borderColor: nodeColor,
                              backgroundColor: selected
                                ? nodeColor
                                : "color-mix(in srgb, var(--surface) 92%, transparent)",
                              boxShadow: selected
                                ? `0 0 0 3px color-mix(in srgb, ${nodeColor} 18%, transparent)`
                                : undefined,
                            }}
                          />
                        </div>

                        <div className="min-w-0 border-b border-[color-mix(in_srgb,var(--border)_60%,transparent)] py-2.5 pr-3">
                          <div className="flex min-w-0 items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[11px] text-[var(--text-primary)]">
                                {commit.message}
                              </div>
                              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                                <span className="shrink-0">{commit.hash.slice(0, 7)}</span>
                                <span className="text-[var(--text-faint)]">•</span>
                                <span className="min-w-0 truncate">{commit.author}</span>
                                <span className="text-[var(--text-faint)]">•</span>
                                <span className="shrink-0">{formatRelativeTime(commit.date, locale)}</span>
                                {commit.parents.length > 1 && (
                                  <StatChip
                                    label={t.git_merge_label}
                                    value={commit.parents.length}
                                    tone="amber"
                                  />
                                )}
                              </div>
                            </div>

                            <div className="mt-0.5 flex max-w-[42%] flex-wrap justify-end gap-1 overflow-hidden">
                              {refSummary.visibleRefs.map((ref) => (
                                <span
                                  key={`${commit.hash}-${ref}`}
                                  className="truncate rounded-full border px-1.5 py-0.5 whitespace-nowrap text-[9px]"
                                  style={refBadgeStyle(ref)}
                                >
                                  {ref.replace(/^tag:\s*/, "")}
                                </span>
                              ))}
                              {refSummary.hiddenCount > 0 && (
                                <span
                                  className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]"
                                  style={{
                                    borderColor: "var(--border)",
                                    backgroundColor:
                                      "color-mix(in srgb, var(--surface) 72%, transparent)",
                                  }}
                                >
                                  +{refSummary.hiddenCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {loadingMore && (
                  <div
                    className="sticky bottom-0 flex justify-center border-t border-[color-mix(in_srgb,var(--border)_65%,transparent)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-3 py-2 backdrop-blur"
                    style={MONO_STYLE}
                  >
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {t.git_load_more}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div
          className="flex min-h-0 flex-col overflow-hidden border-t border-[var(--border)]"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--bg) 84%, var(--surface) 16%) 0%, color-mix(in srgb, var(--bg) 74%, var(--surface) 26%) 100%)",
          }}
        >
          <button
            className="flex w-full items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 text-left"
            onClick={() => setDetailCollapsed((current) => !current)}
          >
            <div className="min-w-0 flex-1">
              <div
                className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
                style={MONO_STYLE}
              >
                {t.git_inspector}
              </div>
              {selectedCommit && (
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <span
                    className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                    style={MONO_STYLE}
                  >
                    {selectedHash?.slice(0, 7)}
                  </span>
                  {!detailCollapsed && (
                    <span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">
                      {selectedCommit.message}
                    </span>
                  )}
                </div>
              )}
            </div>

            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`mt-1 shrink-0 transition-transform duration-150 ${detailCollapsed ? "" : "rotate-180"}`}
            >
              <path
                d="M2 4L5 7L8 4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {!detailCollapsed && (
            <div className="min-h-0 flex-1 overflow-auto">
              {detailLoading ? (
                <div className="flex h-full items-center justify-center">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.loading}
                  </span>
                </div>
              ) : selectedCommit && selectedDetail ? (
                <>
                  <div className="border-b border-[var(--border)] px-3 py-3">
                    <div className="text-[12px] leading-5 text-[var(--text-primary)]">
                      {selectedCommit.message}
                    </div>

                    <div
                      className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]"
                      style={MONO_STYLE}
                    >
                      <span>{selectedCommit.author}</span>
                      <span className="text-[var(--text-faint)]">•</span>
                      <span>{formatAbsoluteTime(selectedCommit.date, locale)}</span>
                    </div>

                    {selectedDetail.message.trim() !== selectedCommit.message.trim() && (
                      <pre className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text-secondary)]">
                        {selectedDetail.message.trim()}
                      </pre>
                    )}
                  </div>

                  <CommitFileList
                    fileDiffs={detailFileDiffs}
                    summary={detailSummary}
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.git_no_commit_selected}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
