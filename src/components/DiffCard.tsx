import { useState, useRef, useCallback, useEffect } from "react";
import { useCanvasStore } from "../stores/canvasStore";

interface FileInfo {
  name: string;
  additions: number;
  deletions: number;
  binary: boolean;
  isImage: boolean;
  imageOld: string | null;
  imageNew: string | null;
}

interface FileDiff {
  file: FileInfo;
  hunks: string[];
}

interface Props {
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
    result.push({ file, hunks: [content] });
  }

  // Add files from numstat that have no diff section (binary only)
  for (const f of files) {
    if (f.binary && !result.find((r) => r.file.name === f.name)) {
      result.push({ file: f, hunks: [] });
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
  worktreePath,
  anchorX,
  anchorY,
  pinned,
  onPin,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: anchorX + 16, y: anchorY });
  const [size, setSize] = useState({ w: 400, h: 340 });
  const [justPinned, setJustPinned] = useState(false);
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

  useEffect(() => {
    if (!window.termcanvas) return;
    setLoading(true);
    window.termcanvas.project.diff(worktreePath).then((result) => {
      setFileDiffs(parseDiff(result.diff, result.files));
      setLoading(false);
    });
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

  return (
    <div
      className="absolute rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        opacity: pinned ? 1 : 0.85,
        transition: justPinned
          ? "transform 150ms ease, opacity 150ms ease"
          : "opacity 150ms ease",
        transform: justPinned ? "scale(1.02)" : "scale(1)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
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
          Diff
        </span>
        {!loading && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {fileDiffs.length} file{fileDiffs.length !== 1 ? "s" : ""}
            <span className="ml-1.5" style={{ color: "var(--cyan)" }}>
              +{totalAdd}
            </span>
            <span className="ml-1" style={{ color: "var(--red)" }}>
              -{totalDel}
            </span>
          </span>
        )}
        <div className="flex-1" />
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
        className="flex-1 overflow-auto min-h-0"
        style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}
      >
        {loading ? (
          <div className="text-[var(--text-muted)] py-8 text-center">
            Loading...
          </div>
        ) : fileDiffs.length === 0 ? (
          <div className="text-[var(--text-muted)] py-8 text-center">
            No changes
          </div>
        ) : (
          fileDiffs.map((fd) => (
            <div key={fd.file.name}>
              {/* File header */}
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-hover)] transition-colors duration-150 text-left"
                onClick={() =>
                  setExpandedFile(
                    expandedFile === fd.file.name ? null : fd.file.name,
                  )
                }
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  className={`shrink-0 transition-transform duration-150 ${expandedFile === fd.file.name ? "rotate-90" : ""}`}
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
                    binary
                  </span>
                ) : (
                  <>
                    <span className="shrink-0" style={{ color: "var(--cyan)" }}>
                      +{fd.file.additions}
                    </span>
                    <span className="shrink-0" style={{ color: "var(--red)" }}>
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
              {expandedFile === fd.file.name && (
                <div className="bg-[var(--bg)] border-y border-[var(--border)] overflow-x-auto">
                  {fd.file.isImage ? (
                    <div className="px-3 py-3 flex items-start gap-3">
                      {fd.file.imageOld && (
                        <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                          <span className="text-[11px] text-[var(--red)]">
                            Removed
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
                            {fd.file.imageOld ? "New" : "Added"}
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
                          Image file changed
                        </div>
                      )}
                    </div>
                  ) : fd.file.binary ? (
                    <div className="px-3 py-3 text-[var(--text-muted)] text-center">
                      Binary file changed
                    </div>
                  ) : (
                    <pre className="px-3 py-1 leading-relaxed">
                      {fd.hunks
                        .join("\n")
                        .split("\n")
                        .map((line, i) => {
                          let color = "var(--text-secondary)";
                          let bg = "transparent";
                          if (line.startsWith("+") && !line.startsWith("+++")) {
                            color = "var(--cyan)";
                            bg = "rgba(80, 227, 194, 0.06)";
                          } else if (
                            line.startsWith("-") &&
                            !line.startsWith("---")
                          ) {
                            color = "var(--red)";
                            bg = "rgba(238, 0, 0, 0.06)";
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
                            <div key={i} style={{ color, backgroundColor: bg }}>
                              {line || " "}
                            </div>
                          );
                        })}
                    </pre>
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
  );
}
