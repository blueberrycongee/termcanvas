import { useEffect, useMemo, useRef, useState } from "react";

import { useGitLog } from "../../hooks/useGitLog";
import { useT } from "../../i18n/useT";
import { useLocaleStore } from "../../stores/localeStore";
import { useNotificationStore } from "../../stores/notificationStore";
import type { GitCommitDetail } from "../../types";
import { parseDiff, type FileDiff } from "../../utils/diffParser";
import { summarizeCommitRefs } from "./gitContentLayout";

const LANE_WIDTH = 16;
const ROW_HEIGHT = 52;
const GRAPH_WIDTH = 84;
const GRAPH_PADDING = 18;

function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;

  const max = 5;
  const addBlocks = Math.round((additions / total) * max);
  const delBlocks = max - addBlocks;

  return (
    <span className="inline-flex gap-px ml-1">
      {Array.from({ length: addBlocks }, (_, index) => (
        <span
          key={`a${index}`}
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: "var(--cyan)" }}
        />
      ))}
      {Array.from({ length: delBlocks }, (_, index) => (
        <span
          key={`d${index}`}
          className="w-1.5 h-1.5 rounded-full"
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

function refBadgeStyle(ref: string): React.CSSProperties {
  if (ref.startsWith("HEAD")) {
    return {
      color: "var(--bg)",
      backgroundColor: "var(--accent)",
      borderColor: "var(--accent)",
    };
  }
  if (ref.startsWith("tag:")) {
    return {
      color: "#f1b94c",
      backgroundColor: "rgba(241, 185, 76, 0.14)",
      borderColor: "rgba(241, 185, 76, 0.3)",
    };
  }
  if (ref.startsWith("origin/")) {
    return {
      color: "#7ec6ff",
      backgroundColor: "rgba(126, 198, 255, 0.14)",
      borderColor: "rgba(126, 198, 255, 0.3)",
    };
  }
  return {
    color: "var(--text-primary)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "var(--border)",
  };
}

function renderEdge(
  edge: {
    fromLane: number;
    fromRow: number;
    toLane: number;
    toRow: number;
    color: string;
  },
) {
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
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.85"
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
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.85"
    />
  );
}

function CommitFileList({
  fileDiffs,
}: {
  fileDiffs: FileDiff[];
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
    <div className="border-t border-[var(--border)]">
      {fileDiffs.map((fileDiff) => (
        <div key={fileDiff.file.name}>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-hover)] transition-colors duration-150 text-left"
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
            <span className="truncate flex-1 text-[var(--text-primary)]">
              {fileDiff.file.name}
            </span>
            {fileDiff.file.binary ? (
              <span className="text-[11px] text-[var(--text-muted)]">
                {t.binary_label}
              </span>
            ) : (
              <>
                <span style={{ color: "var(--cyan)" }}>+{fileDiff.file.additions}</span>
                <span style={{ color: "var(--red)" }}>-{fileDiff.file.deletions}</span>
                <ChangeBar
                  additions={fileDiff.file.additions}
                  deletions={fileDiff.file.deletions}
                />
              </>
            )}
          </button>
          {expandedFiles.has(fileDiff.file.name) && (
            <div
              className="bg-[var(--bg)] border-y border-[var(--border)] overflow-x-auto"
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
                      <div key={`${fileDiff.file.name}-${index}`} style={{ color, backgroundColor }}>
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
  const { commits, branches, edges, isGitRepo, loading, hasMore, refresh, loadMore } =
    useGitLog(worktreePath);

  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [initializingRepo, setInitializingRepo] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastDetailKeyRef = useRef<string | null>(null);

  const currentBranch = useMemo(
    () => branches.find((branch) => branch.isCurrent) ?? null,
    [branches],
  );
  const localBranches = useMemo(
    () => branches.filter((branch) => !branch.isRemote),
    [branches],
  );
  const hasSelectedCommit = useMemo(
    () => (selectedHash ? commits.some((commit) => commit.hash === selectedHash) : false),
    [commits, selectedHash],
  );

  useEffect(() => {
    if (commits.length === 0) {
      setSelectedHash(null);
      setDetail(null);
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
    if (!worktreePath || !selectedHash || !window.termcanvas || !hasSelectedCommit) {
      setDetail(null);
      setDetailLoading(false);
      lastDetailKeyRef.current = null;
      return;
    }

    const detailKey = `${worktreePath}:${selectedHash}`;
    if (lastDetailKeyRef.current === detailKey && detail !== null) {
      return;
    }

    let cancelled = false;
    lastDetailKeyRef.current = detailKey;
    setDetailLoading(true);

    window.termcanvas.git.commitDetail(worktreePath, selectedHash).then((nextDetail) => {
      if (cancelled) return;
      if (nextDetail === null) {
        setDetail(null);
        setDetailLoading(false);
        lastDetailKeyRef.current = null;
        return;
      }
      setDetail(nextDetail);
      setDetailLoading(false);
    }).catch((error) => {
      if (cancelled) return;
      setDetail(null);
      setDetailLoading(false);
      notify("error", t.git_commit_detail_failed(String(error)));
      lastDetailKeyRef.current = null;
    });

    return () => {
      cancelled = true;
    };
  }, [detail, hasSelectedCommit, notify, selectedHash, worktreePath]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
  const endIndex = Math.min(
    commits.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 8,
  );
  const visibleCommits = commits.slice(startIndex, endIndex);
  const visibleEdges = edges.filter((edge) => {
    const minRow = Math.min(edge.fromRow, edge.toRow);
    const maxRow = Math.max(edge.fromRow, edge.toRow);
    return maxRow >= startIndex - 1 && minRow <= endIndex + 1;
  });
  const detailFileDiffs = detail ? parseDiff(detail.diff, detail.files) : [];

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[var(--text-muted)] text-[11px]">{t.no_worktree_selected}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[var(--text-muted)] text-[11px]">{t.loading}</span>
      </div>
    );
  }

  if (!isGitRepo) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-[240px] rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-5 text-center">
          <div
            className="text-[12px] text-[var(--text-primary)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.git_not_repository}
          </div>
          <button
            className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150 disabled:opacity-60"
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
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-[var(--border)] shrink-0 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.git_branch}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <select
              className="min-w-0 max-w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
              disabled={switchingBranch || localBranches.length === 0}
              value={currentBranch?.name ?? ""}
              onChange={async (event) => {
                const nextBranch = event.target.value;
                if (!nextBranch || nextBranch === currentBranch?.name) return;

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
            {currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) && (
              <div
                className="shrink-0 rounded-full border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {currentBranch.ahead > 0 ? `↑${currentBranch.ahead}` : ""}
                {currentBranch.ahead > 0 && currentBranch.behind > 0 ? " " : ""}
                {currentBranch.behind > 0 ? `↓${currentBranch.behind}` : ""}
              </div>
            )}
          </div>
        </div>
        <button
          className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
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

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto min-h-0 relative"
        onScroll={(event) => {
          const element = event.currentTarget;
          setScrollTop(element.scrollTop);
          if (
            hasMore &&
            element.scrollHeight - element.scrollTop - element.clientHeight < 160
          ) {
            loadMore();
          }
        }}
      >
        {commits.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-[var(--text-muted)] text-[11px]">{t.git_no_commits}</span>
          </div>
        ) : (
          <div
            className="relative"
            style={{
              height: commits.length * ROW_HEIGHT,
              fontFamily: '"Geist Mono", monospace',
            }}
          >
            <svg
              className="absolute left-0 top-0 pointer-events-none"
              width={GRAPH_WIDTH}
              height={commits.length * ROW_HEIGHT}
            >
              {visibleEdges.map((edge) => renderEdge(edge))}
            </svg>

            {visibleCommits.map((commit) => {
              const selected = commit.hash === selectedHash;
              const nodeColor = visibleEdges.find(
                (edge) => edge.fromRow === commit.row && edge.fromLane === commit.lane,
              )?.color ?? "var(--accent)";
              const refSummary = summarizeCommitRefs(commit.refs);

              return (
                <button
                  key={commit.hash}
                  className={`absolute left-0 right-0 grid grid-cols-[84px,minmax(0,1fr)] text-left px-2 ${
                    selected ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]"
                  }`}
                  style={{
                    top: commit.row * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    transition: "background-color 0.15s ease",
                  }}
                  onClick={() => {
                    setSelectedHash(commit.hash);
                    setDetailCollapsed(false);
                  }}
                >
                  <div className="relative h-full" style={{ width: GRAPH_WIDTH }}>
                    <span
                      className="absolute rounded-full border-2"
                      style={{
                        top: ROW_HEIGHT / 2 - 4,
                        left: GRAPH_PADDING + commit.lane * LANE_WIDTH - 4,
                        width: 8,
                        height: 8,
                        borderColor: nodeColor,
                        backgroundColor: "var(--surface)",
                      }}
                    />
                  </div>
                  <div className="min-w-0 py-1.5 pr-1">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[10px] text-[var(--text-muted)]">
                        {commit.hash.slice(0, 7)}
                      </span>
                      <span className="truncate text-[11px] text-[var(--text-primary)]">
                        {commit.message}
                      </span>
                    </div>
                    <div className="mt-1 min-w-0 flex items-center gap-2">
                      <span className="truncate text-[10px] text-[var(--text-muted)]">
                        {commit.author}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                        {formatRelativeTime(commit.date, locale)}
                      </span>
                      <div className="min-w-0 flex flex-1 gap-1 overflow-hidden">
                        {refSummary.visibleRefs.map((ref) => (
                          <span
                            key={`${commit.hash}-${ref}`}
                            className="truncate rounded-full border px-1.5 py-0.5 text-[9px] whitespace-nowrap"
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
                              backgroundColor: "rgba(255, 255, 255, 0.04)",
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

            {hasMore && (
              <div
                className="absolute left-0 right-0 flex items-center justify-center text-[10px] text-[var(--text-muted)]"
                style={{ top: commits.length * ROW_HEIGHT - 24 }}
              >
                {t.git_load_more}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedHash && (
        <div
          className={`border-t border-[var(--border)] bg-[var(--bg)] shrink-0 ${
            detailCollapsed ? "h-10" : "max-h-[42%] min-h-[180px]"
          }`}
        >
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-left border-b border-[var(--border)]"
            onClick={() => setDetailCollapsed((current) => !current)}
          >
            <span
              className="text-[11px] text-[var(--text-primary)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {t.git_commit_detail}
            </span>
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
            <div className="h-[calc(100%-41px)] overflow-auto min-h-0">
              {detailLoading ? (
                <div className="flex items-center justify-center h-full">
                  <span className="text-[var(--text-muted)] text-[11px]">{t.loading}</span>
                </div>
              ) : detail ? (
                <>
                  <div className="px-3 py-3 border-b border-[var(--border)]">
                    <div
                      className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] mb-2"
                      style={{ fontFamily: '"Geist Mono", monospace' }}
                    >
                      {selectedHash.slice(0, 7)}
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-[11px] text-[var(--text-primary)] leading-relaxed">
                      {detail.message}
                    </pre>
                  </div>
                  <CommitFileList fileDiffs={detailFileDiffs} />
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="text-[var(--text-muted)] text-[11px]">
                    {t.git_no_commit_selected}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
