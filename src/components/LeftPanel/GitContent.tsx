import { useEffect, useMemo, useRef, useState } from "react";

import { useGitLog } from "../../hooks/useGitLog";
import { useT } from "../../i18n/useT";
import { useLocaleStore } from "../../stores/localeStore";
import { useNotificationStore } from "../../stores/notificationStore";
import type { GitCommitDetail } from "../../types";
import { parseDiff, type FileDiff } from "../../utils/diffParser";
import {
  buildAheadBehindLabel,
  getVirtualCommitWindow,
  summarizeCommitRefs,
} from "./gitContentLayout";

const LANE_WIDTH = 14;
const ROW_HEIGHT = 46;
const GRAPH_WIDTH = 64;
const GRAPH_PADDING = 18;

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
        opacity="0.8"
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
      opacity="0.8"
    />
  );
}

function CommitFileList({ fileDiffs }: { fileDiffs: FileDiff[] }) {
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
    <div className="border-t border-[var(--border)]">
      {fileDiffs.map((fileDiff) => (
        <div key={fileDiff.file.name}>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-hover)]"
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
              className={`shrink-0 transition-transform duration-150 ${expandedFiles.has(fileDiff.file.name) ? "rotate-90" : ""}`}
            >
              <path
                d="M2 1L6 4L2 7"
                stroke="var(--text-muted)"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">
              {fileDiff.file.name}
            </span>
            {fileDiff.file.binary ? (
              <span className="text-[10px] text-[var(--text-muted)]">
                {t.binary_label}
              </span>
            ) : (
              <>
                <span className="shrink-0 text-[10px]" style={{ color: "var(--cyan)" }}>
                  +{fileDiff.file.additions}
                </span>
                <span className="shrink-0 text-[10px]" style={{ color: "var(--red)" }}>
                  -{fileDiff.file.deletions}
                </span>
                <ChangeBar
                  additions={fileDiff.file.additions}
                  deletions={fileDiff.file.deletions}
                />
              </>
            )}
          </button>
          {expandedFiles.has(fileDiff.file.name) && (
            <div
              className="overflow-x-auto border-y border-[var(--border)] bg-[var(--bg)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {fileDiff.file.binary ? (
                <div className="px-3 py-3 text-[11px] text-[var(--text-muted)]">
                  {t.binary_changed}
                </div>
              ) : (
                <pre className="px-3 py-1 text-[11px] leading-relaxed">
                  {fileDiff.hunks.join("\n").split("\n").map((line, index) => {
                    let color = "var(--text-secondary)";
                    let backgroundColor = "transparent";
                    if (line.startsWith("+") && !line.startsWith("+++")) {
                      color = "var(--cyan)";
                      backgroundColor = "rgba(80, 227, 194, 0.06)";
                    } else if (line.startsWith("-") && !line.startsWith("---")) {
                      color = "var(--red)";
                      backgroundColor = "rgba(238, 0, 0, 0.06)";
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
      ))}
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
  const branchStatus = currentBranch
    ? buildAheadBehindLabel(currentBranch.ahead, currentBranch.behind)
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
          className="w-full max-w-[248px] rounded-lg border border-[var(--border)] px-4 py-4"
          style={{
            background:
              "color-mix(in srgb, var(--bg) 72%, var(--surface) 28%)",
          }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.left_panel_git}
          </div>
          <div
            className="mt-2 text-[12px] text-[var(--text-primary)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.git_not_repository}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
            {t.git_not_repository_hint}
          </p>
          <button
            className="mt-4 rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-hover)] disabled:opacity-60"
            style={{ fontFamily: '"Geist Mono", monospace' }}
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
      <div className="shrink-0 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              <span>{t.left_panel_git}</span>
              {refreshing && <span className="status-pulse">{t.loading}</span>}
            </div>
            <div className="mt-1.5 flex min-w-0 items-center gap-2">
              {repoName && (
                <span
                  className="min-w-0 truncate rounded-full border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                >
                  {repoName}
                </span>
              )}
              {branchStatus && (
                <span
                  className="shrink-0 rounded-full border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)]"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                >
                  {branchStatus}
                </span>
              )}
            </div>
          </div>
          <button
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            onClick={() => {
              void refresh().catch((error) => {
                notify("error", t.git_refresh_failed(String(error)));
              });
            }}
          >
            {t.git_refresh}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {t.git_branch}
            </div>
            <select
              className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
              disabled={switchingBranch || localBranches.length === 0}
              value={currentBranch?.name ?? ""}
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
              {localBranches.map((branch) => (
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
            ? "minmax(0,1fr) 40px"
            : "minmax(0,1fr) minmax(188px, 34%)",
        }}
      >
        <div
          ref={scrollRef}
          className="relative min-h-0 overflow-auto"
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
                  fontFamily: '"Geist Mono", monospace',
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
                    visibleEdges.find(
                      (edge) =>
                        edge.fromRow === commit.row && edge.fromLane === commit.lane,
                    )?.color ?? "var(--accent)";
                  const refSummary = summarizeCommitRefs(commit.refs, 1);

                  return (
                    <button
                      key={commit.hash}
                      className={`absolute left-0 right-0 grid grid-cols-[64px,minmax(0,1fr)] text-left transition-colors duration-150 ${
                        selected ? "" : "hover:bg-[var(--surface-hover)]"
                      }`}
                      style={{
                        top: commit.row * ROW_HEIGHT,
                        height: ROW_HEIGHT,
                        background: selected
                          ? "color-mix(in srgb, var(--surface-hover) 82%, var(--accent) 18%)"
                          : undefined,
                      }}
                      onClick={() => {
                        setSelectedHash(commit.hash);
                        setDetailCollapsed(false);
                      }}
                    >
                      <div className="relative h-full" style={{ width: GRAPH_WIDTH }}>
                        <span
                          className="absolute rounded-full border"
                          style={{
                            top: ROW_HEIGHT / 2 - 4,
                            left: GRAPH_PADDING + commit.lane * LANE_WIDTH - 4,
                            width: 8,
                            height: 8,
                            borderColor: nodeColor,
                            backgroundColor: selected ? nodeColor : "var(--surface)",
                          }}
                        />
                      </div>

                      <div className="min-w-0 border-b border-[color-mix(in_srgb,var(--border)_65%,transparent)] py-2 pr-3">
                        <div className="truncate text-[11px] text-[var(--text-primary)]">
                          {commit.message}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                          <span className="shrink-0">{commit.hash.slice(0, 7)}</span>
                          <div className="min-w-0 flex flex-1 items-center gap-1 overflow-hidden">
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
                          <span className="shrink-0 text-[var(--text-faint)]">
                            {formatRelativeTime(commit.date, locale)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {(loadingMore || hasMore) && (
                <div
                  className="sticky bottom-0 flex justify-center border-t border-[color-mix(in_srgb,var(--border)_65%,transparent)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-3 py-2 backdrop-blur"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                >
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {loadingMore ? t.git_load_more : ""}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="min-h-0 border-t border-[var(--border)]"
          style={{
            background:
              "color-mix(in srgb, var(--bg) 76%, var(--surface) 24%)",
          }}
        >
          <button
            className="flex w-full items-center justify-between border-b border-[var(--border)] px-3 py-2 text-left"
            onClick={() => setDetailCollapsed((current) => !current)}
          >
            <div className="min-w-0">
              <div
                className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {t.git_commit_detail}
              </div>
              {selectedHash && !detailCollapsed && (
                <div
                  className="mt-1 text-[11px] text-[var(--text-secondary)]"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                >
                  {selectedHash.slice(0, 7)}
                </div>
              )}
            </div>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`transition-transform duration-150 ${detailCollapsed ? "" : "rotate-180"}`}
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
            <div className="min-h-0 overflow-auto" style={{ height: "calc(100% - 41px)" }}>
              {detailLoading ? (
                <div className="flex h-full items-center justify-center">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.loading}
                  </span>
                </div>
              ) : selectedCommit && selectedDetail ? (
                <>
                  <div className="border-b border-[var(--border)] px-3 py-3">
                    <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text-primary)]">
                      {selectedDetail.message}
                    </pre>
                    <div
                      className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]"
                      style={{ fontFamily: '"Geist Mono", monospace' }}
                    >
                      <span>{selectedCommit.author}</span>
                      <span className="text-[var(--text-faint)]">•</span>
                      <span>{formatAbsoluteTime(selectedCommit.date, locale)}</span>
                    </div>
                  </div>
                  <CommitFileList fileDiffs={detailFileDiffs} />
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
