import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import {
  useCardLayoutStore,
  resolveAllCardPositions,
} from "../stores/cardLayoutStore";
import { useProjectStore, getProjectBounds } from "../stores/projectStore";
import { useT } from "../i18n/useT";
import { toggleExpandedFiles } from "./diffCardExpansion";

interface FileInfo {
  name: string;
  additions: number;
  deletions: number;
  binary: boolean;
  isImage: boolean;
  imageOld: string | null;
  imageNew: string | null;
}

interface Hunk {
  header: string; // The @@ line
  lines: string[];
}

interface FileDiff {
  file: FileInfo;
  hunks: Hunk[];
  rawContent: string; // Full diff content for copy
}

interface Props {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  anchorX: number;
  anchorY: number;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function parseHunks(content: string): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = content.split("\n");
  let currentHunk: Hunk | null = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { header: line, lines: [] };
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    }
    // Lines before first @@ (index, ---, +++) are skipped from hunks
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

function parseDiff(raw: string, files: FileInfo[]): FileDiff[] {
  const fileMap = new Map(files.map((f) => [f.name, f]));
  const result: FileDiff[] = [];
  // Split by "diff --git" markers
  const sections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split("\n");
    // Extract filename from "a/path b/path"
    const header = lines[0] ?? "";
    const match = header.match(/b\/(.+)$/);
    const name = match?.[1] ?? "";
    const file = fileMap.get(name) ?? {
      name,
      additions: 0,
      deletions: 0,
      binary: false,
      isImage: false,
      imageOld: null,
      imageNew: null,
    };
    // Everything after the header is the diff content
    const content = lines.slice(1).join("\n");
    const hunks = parseHunks(content);
    result.push({ file, hunks, rawContent: content });
  }

  // Add files from numstat that have no diff section (binary only)
  for (const f of files) {
    if (f.binary && !result.find((r) => r.file.name === f.name)) {
      result.push({ file: f, hunks: [], rawContent: "" });
    }
  }

  return result;
}

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
    <span className="inline-flex gap-px ml-1">
      {Array.from({ length: addBlocks }, (_, i) => (
        <span
          key={`a${i}`}
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: "var(--cyan)" }}
        />
      ))}
      {Array.from({ length: delBlocks }, (_, i) => (
        <span
          key={`d${i}`}
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: "var(--red)" }}
        />
      ))}
    </span>
  );
}

export function DiffCard({
  projectId,
  worktreeId,
  worktreePath,
  anchorX,
  anchorY,
  pinned,
  onPin,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const t = useT();
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());
  const [collapsedHunks, setCollapsedHunks] = useState<Set<string>>(() => new Set());
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [pos, setPos] = useState({ x: anchorX + 16, y: anchorY });
  const [size, setSize] = useState({ w: 400, h: 340 });
  const [justPinned, setJustPinned] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);
  const hasDragged = useRef(false);

  const { register, unregister } = useCardLayoutStore();
  const cards = useCardLayoutStore((s) => s.cards);

  // Register this card's anchor position and size
  useEffect(() => {
    register(worktreeId, { x: pos.x, y: pos.y, w: size.w, h: size.h });
    return () => unregister(worktreeId);
  }, [worktreeId, pos.x, pos.y, size.w, size.h, register, unregister]);

  // Collect all project bounds as obstacles for DiffCard deconfliction
  const projects = useProjectStore((s) => s.projects);
  const obstacles = useMemo(
    () => projects.map((p) => getProjectBounds(p)),
    [projects],
  );

  // Compute non-overlapping positions: push right past projects, push down past other DiffCards
  const allResolved = resolveAllCardPositions(cards, obstacles);
  const resolved = allResolved[worktreeId] ?? { x: pos.x, y: pos.y };
  const resolvedX = resolved.x;
  const resolvedY = resolved.y;

  useEffect(() => {
    if (!window.termcanvas) return;
    const fetchDiff = () => {
      window.termcanvas.project.diff(worktreePath).then((result) => {
        setFileDiffs(parseDiff(result.diff, result.files));
        setLoading(false);
      });
    };
    setLoading(true);
    fetchDiff();

    // Layer 1: Watch .git/HEAD + .git/index for structural git changes
    window.termcanvas.git.watch(worktreePath);
    const removeGitChanged = window.termcanvas.git.onChanged((changedPath) => {
      if (changedPath === worktreePath) fetchDiff();
    });

    // Layer 2: Re-fetch on terminal activity (already throttled at source)
    const handleActivity = (e: Event) => {
      if ((e as CustomEvent).detail === worktreePath) fetchDiff();
    };
    // Layer 3: Re-fetch on window focus (covers external tool changes)
    const handleFocus = () => fetchDiff();

    window.addEventListener("termcanvas:worktree-activity", handleActivity);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.termcanvas.git.unwatch(worktreePath);
      removeGitChanged();
      window.removeEventListener(
        "termcanvas:worktree-activity",
        handleActivity,
      );
      window.removeEventListener("focus", handleFocus);
    };
  }, [worktreePath]);

  useEffect(() => {
    if (!pinned) setPos({ x: anchorX + 16, y: anchorY });
  }, [anchorX, anchorY, pinned]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      hasDragged.current = false;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        hasDragged.current = true;
        setPos({
          x:
            dragRef.current.origX +
            (ev.clientX - dragRef.current.startX) / scale,
          y:
            dragRef.current.origY +
            (ev.clientY - dragRef.current.startY) / scale,
        });
      };
      const handleUp = () => {
        if (hasDragged.current && !pinned) {
          onPin();
          setJustPinned(true);
          setTimeout(() => setJustPinned(false), 200);
        }
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [pos, pinned, onPin],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: size.w,
        origH: size.h,
      };
      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        setSize({
          w: Math.max(
            280,
            resizeRef.current.origW +
              (ev.clientX - resizeRef.current.startX) / scale,
          ),
          h: Math.max(
            150,
            resizeRef.current.origH +
              (ev.clientY - resizeRef.current.startY) / scale,
          ),
        });
      };
      const handleUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [size],
  );

  const totalAdd = fileDiffs.reduce((s, f) => s + f.file.additions, 0);
  const totalDel = fileDiffs.reduce((s, f) => s + f.file.deletions, 0);

  // Build flat list of all hunk anchors for navigation
  const allHunkIds = useMemo(() => {
    const ids: string[] = [];
    for (const fd of fileDiffs) {
      for (let i = 0; i < fd.hunks.length; i++) {
        ids.push(`${fd.file.name}:${i}`);
      }
    }
    return ids;
  }, [fileDiffs]);

  const toggleHunkCollapse = useCallback((hunkId: string) => {
    setCollapsedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(hunkId)) next.delete(hunkId);
      else next.add(hunkId);
      return next;
    });
  }, []);

  const scrollToHunk = useCallback((hunkId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-hunk-id="${hunkId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const navigateHunk = useCallback(
    (direction: "prev" | "next") => {
      if (allHunkIds.length === 0) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      // Find which hunk is currently most visible
      let currentIdx = -1;
      const containerRect = container.getBoundingClientRect();
      for (let i = 0; i < allHunkIds.length; i++) {
        const el = container.querySelector(
          `[data-hunk-id="${allHunkIds[i]}"]`,
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= containerRect.top + containerRect.height / 3) {
            currentIdx = i;
          }
        }
      }

      const targetIdx =
        direction === "next"
          ? Math.min(currentIdx + 1, allHunkIds.length - 1)
          : Math.max(currentIdx - 1, 0);

      // Ensure the file containing this hunk is expanded
      const targetHunkId = allHunkIds[targetIdx];
      if (!targetHunkId) return;
      const fileName = targetHunkId.substring(
        0,
        targetHunkId.lastIndexOf(":"),
      );
      setExpandedFiles((prev) => {
        if (prev.has(fileName)) return prev;
        const next = new Set(prev);
        next.add(fileName);
        return next;
      });
      // Also uncollapse the target hunk if it's collapsed
      setCollapsedHunks((prev) => {
        if (!prev.has(targetHunkId)) return prev;
        const next = new Set(prev);
        next.delete(targetHunkId);
        return next;
      });

      // Scroll after a tick so the DOM can update
      requestAnimationFrame(() => scrollToHunk(targetHunkId));
    },
    [allHunkIds, scrollToHunk],
  );

  const handleCopyDiff = useCallback(() => {
    const fullText = fileDiffs
      .map((fd) => {
        const hunkText = fd.hunks
          .map((h) => h.header + "\n" + h.lines.join("\n"))
          .join("\n");
        return `diff --git a/${fd.file.name} b/${fd.file.name}\n${hunkText}`;
      })
      .join("\n");
    navigator.clipboard.writeText(fullText).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    });
  }, [fileDiffs]);

  // Connection line endpoints: worktree right edge → DiffCard left edge
  const lineX1 = anchorX;
  const lineY1 = anchorY + 20;
  const lineX2 = resolvedX;
  const lineY2 = resolvedY + 20;
  const lineSvgLeft = Math.min(lineX1, lineX2);
  const lineSvgTop = Math.min(lineY1, lineY2);
  const lineSvgW = Math.abs(lineX2 - lineX1) || 1;
  const lineSvgH = Math.abs(lineY2 - lineY1) || 1;

  return (
    <>
      <svg
        className="absolute pointer-events-none"
        style={{
          left: lineSvgLeft,
          top: lineSvgTop,
          overflow: "visible",
        }}
        width={lineSvgW}
        height={lineSvgH}
      >
        <line
          x1={lineX1 - lineSvgLeft}
          y1={lineY1 - lineSvgTop}
          x2={lineX2 - lineSvgLeft}
          y2={lineY2 - lineSvgTop}
          stroke="var(--text-muted)"
          strokeWidth="1.5"
          strokeDasharray={pinned ? "none" : "4 3"}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        className="absolute rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col"
        style={{
          left: resolvedX,
          top: resolvedY,
          width: size.w,
          height: size.h,
          opacity: pinned ? 1 : 0.85,
          transition: justPinned
            ? "transform 150ms ease, opacity 150ms ease"
            : "opacity 150ms ease",
          transform: justPinned ? "scale(1.02)" : "scale(1)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none shrink-0"
          onMouseDown={handleDragStart}
        >
          <span
            className="text-[11px] font-medium text-[var(--accent)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.diff}
          </span>
          {!loading && (
            <span className="text-[11px] text-[var(--text-muted)]">
              {t.file_count(fileDiffs.length)}
              <span className="ml-1.5" style={{ color: "var(--cyan)" }}>
                +{totalAdd}
              </span>
              <span className="ml-1" style={{ color: "var(--red)" }}>
                -{totalDel}
              </span>
            </span>
          )}
          <div className="flex-1" />
          {/* Hunk navigation */}
          {!loading && allHunkIds.length > 0 && (
            <div className="flex items-center gap-0.5">
              <button
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
                onClick={() => navigateHunk("prev")}
                title={t.diff_prev_hunk}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M7 8L3 5L7 2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
                onClick={() => navigateHunk("next")}
                title={t.diff_next_hunk}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M3 2L7 5L3 8"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          )}
          {/* Copy button */}
          {!loading && fileDiffs.length > 0 && (
            <button
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
              onClick={handleCopyDiff}
              title={t.diff_copy}
            >
              {copyFeedback ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M2 5.5L4 7.5L8 3"
                    stroke="var(--cyan)"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect
                    x="3"
                    y="1"
                    width="6"
                    height="6"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1"
                    fill="none"
                  />
                  <rect
                    x="1"
                    y="3"
                    width="6"
                    height="6"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1"
                    fill="none"
                  />
                </svg>
              )}
            </button>
          )}
          {pinned && (
            <button
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
              onClick={onClose}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        {/* File list + inline diffs */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto min-h-0"
          style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}
        >
          {loading ? (
            <div className="text-[var(--text-muted)] py-8 text-center">
              {t.loading}
            </div>
          ) : fileDiffs.length === 0 ? (
            <div className="text-[var(--text-muted)] py-8 text-center">
              {t.no_changes}
            </div>
          ) : (
            fileDiffs.map((fd) => (
              <div key={fd.file.name} data-diff-file={fd.file.name}>
                {/* File header */}
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-hover)] transition-colors duration-150 text-left"
                  onClick={() =>
                    setExpandedFiles((current) =>
                      toggleExpandedFiles(current, fd.file.name),
                    )
                  }
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    className={`shrink-0 transition-transform duration-150 ${expandedFiles.has(fd.file.name) ? "rotate-90" : ""}`}
                  >
                    <path
                      d="M2 1L6 4L2 7"
                      stroke="var(--text-muted)"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-[var(--text-primary)] truncate flex-1">
                    {fd.file.name}
                  </span>
                  {fd.file.binary ? (
                    <span className="text-[var(--text-muted)] text-[11px] shrink-0">
                      {t.binary_label}
                    </span>
                  ) : (
                    <>
                      <span
                        className="shrink-0"
                        style={{ color: "var(--cyan)" }}
                      >
                        +{fd.file.additions}
                      </span>
                      <span
                        className="shrink-0"
                        style={{ color: "var(--red)" }}
                      >
                        -{fd.file.deletions}
                      </span>
                      <ChangeBar
                        additions={fd.file.additions}
                        deletions={fd.file.deletions}
                      />
                    </>
                  )}
                </button>

                {/* Expanded diff */}
                {expandedFiles.has(fd.file.name) && (
                  <div className="bg-[var(--bg)] border-y border-[var(--border)] overflow-x-auto">
                    {fd.file.isImage ? (
                      <div className="px-3 py-3 flex items-start gap-3">
                        {fd.file.imageOld && (
                          <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                            <span className="text-[11px] text-[var(--red)]">
                              {t.removed}
                            </span>
                            <img
                              src={fd.file.imageOld}
                              alt="old"
                              className="max-w-full max-h-40 rounded border border-[var(--border)] object-contain"
                              style={{
                                background:
                                  "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%) 50% / 12px 12px",
                              }}
                            />
                          </div>
                        )}
                        {fd.file.imageOld && fd.file.imageNew && (
                          <span className="text-[13px] text-[var(--text-muted)] self-center">
                            →
                          </span>
                        )}
                        {fd.file.imageNew && (
                          <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                            <span
                              className="text-[11px]"
                              style={{ color: "var(--cyan)" }}
                            >
                              {fd.file.imageOld ? t.file_new : t.added}
                            </span>
                            <img
                              src={fd.file.imageNew}
                              alt="new"
                              className="max-w-full max-h-40 rounded border border-[var(--border)] object-contain"
                              style={{
                                background:
                                  "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%) 50% / 12px 12px",
                              }}
                            />
                          </div>
                        )}
                        {!fd.file.imageOld && !fd.file.imageNew && (
                          <div className="text-[var(--text-muted)] text-center w-full py-2">
                            {t.image_changed}
                          </div>
                        )}
                      </div>
                    ) : fd.file.binary ? (
                      <div className="px-3 py-3 text-[var(--text-muted)] text-center">
                        {t.binary_changed}
                      </div>
                    ) : (
                      <div>
                        {fd.hunks.map((hunk, hunkIdx) => {
                          const hunkId = `${fd.file.name}:${hunkIdx}`;
                          const isCollapsed = collapsedHunks.has(hunkId);
                          // Parse line numbers from hunk header: @@ -old,count +new,count @@
                          const lineMatch = hunk.header.match(
                            /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
                          );
                          let oldLine = lineMatch ? parseInt(lineMatch[1], 10) : 0;
                          let newLine = lineMatch ? parseInt(lineMatch[2], 10) : 0;
                          return (
                            <div key={hunkId} data-hunk-id={hunkId}>
                              {/* Hunk header — clickable to collapse */}
                              <button
                                className="w-full flex items-center gap-1 px-2 py-0.5 hover:bg-[var(--surface-hover)] transition-colors duration-150 text-left"
                                onClick={() => toggleHunkCollapse(hunkId)}
                              >
                                <svg
                                  width="6"
                                  height="6"
                                  viewBox="0 0 6 6"
                                  fill="none"
                                  className={`shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                                >
                                  <path
                                    d="M1.5 0.5L4.5 3L1.5 5.5"
                                    stroke="var(--text-muted)"
                                    strokeWidth="1"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                <span
                                  className="truncate flex-1 text-[10px]"
                                  style={{ color: "var(--accent)" }}
                                >
                                  {hunk.header}
                                </span>
                              </button>
                              {/* Hunk body */}
                              {!isCollapsed && (
                                <pre className="leading-relaxed">
                                  {hunk.lines.map((line, i) => {
                                    let color = "var(--text-secondary)";
                                    let bg = "transparent";
                                    let lineNumOld = "";
                                    let lineNumNew = "";
                                    if (
                                      line.startsWith("+") &&
                                      !line.startsWith("+++")
                                    ) {
                                      color = "var(--cyan)";
                                      bg = "rgba(80, 227, 194, 0.06)";
                                      lineNumNew = String(newLine);
                                      newLine++;
                                    } else if (
                                      line.startsWith("-") &&
                                      !line.startsWith("---")
                                    ) {
                                      color = "var(--red)";
                                      bg = "rgba(238, 0, 0, 0.06)";
                                      lineNumOld = String(oldLine);
                                      oldLine++;
                                    } else if (
                                      line.startsWith("index ") ||
                                      line.startsWith("---") ||
                                      line.startsWith("+++")
                                    ) {
                                      color = "var(--text-muted)";
                                    } else {
                                      // Context line
                                      lineNumOld = String(oldLine);
                                      lineNumNew = String(newLine);
                                      oldLine++;
                                      newLine++;
                                    }
                                    return (
                                      <div
                                        key={i}
                                        className="flex"
                                        style={{
                                          color,
                                          backgroundColor: bg,
                                        }}
                                      >
                                        <span
                                          className="inline-block text-right shrink-0 select-none"
                                          style={{
                                            width: 28,
                                            color: "var(--text-faint)",
                                            paddingRight: 4,
                                          }}
                                        >
                                          {lineNumOld}
                                        </span>
                                        <span
                                          className="inline-block text-right shrink-0 select-none"
                                          style={{
                                            width: 28,
                                            color: "var(--text-faint)",
                                            paddingRight: 6,
                                          }}
                                        >
                                          {lineNumNew}
                                        </span>
                                        <span className="flex-1">
                                          {line || " "}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Resize handle */}
        {pinned && (
          <div
            className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity duration-150"
            onMouseDown={handleResizeStart}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              className="text-[var(--text-faint)]"
            >
              <path
                d="M11 11L6 11M11 11L11 6"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>
    </>
  );
}
