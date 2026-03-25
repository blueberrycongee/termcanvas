import { useState } from "react";
import { useWorktreeDiff } from "../../hooks/useWorktreeDiff";
import { useT } from "../../i18n/useT";
import { toggleExpandedFiles } from "../diffCardExpansion";

interface Props {
  worktreePath: string | null;
}

function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const max = 5;
  const addBlocks = Math.round((additions / total) * max);
  const delBlocks = max - addBlocks;
  return (
    <span className="inline-flex gap-px ml-1">
      {Array.from({ length: addBlocks }, (_, i) => (
        <span key={`a${i}`} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--cyan)" }} />
      ))}
      {Array.from({ length: delBlocks }, (_, i) => (
        <span key={`d${i}`} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--red)" }} />
      ))}
    </span>
  );
}

export function DiffContent({ worktreePath }: Props) {
  const t = useT();
  const { fileDiffs, loading } = useWorktreeDiff(worktreePath);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

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

  if (fileDiffs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[var(--text-muted)] text-[11px]">{t.no_changes}</span>
      </div>
    );
  }

  const totalAdd = fileDiffs.reduce((s, f) => s + f.file.additions, 0);
  const totalDel = fileDiffs.reduce((s, f) => s + f.file.deletions, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
        <span className="text-[11px] text-[var(--text-muted)]">
          {t.file_count(fileDiffs.length)}
          <span className="ml-1.5" style={{ color: "var(--cyan)" }}>+{totalAdd}</span>
          <span className="ml-1" style={{ color: "var(--red)" }}>-{totalDel}</span>
        </span>
      </div>
      <div className="flex-1 overflow-auto min-h-0" style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}>
        {fileDiffs.map((fd) => (
          <div key={fd.file.name}>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-hover)] transition-colors duration-150 text-left"
              onClick={() => setExpandedFiles((current) => toggleExpandedFiles(current, fd.file.name))}
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="none"
                className={`shrink-0 transition-transform duration-150 ${expandedFiles.has(fd.file.name) ? "rotate-90" : ""}`}
              >
                <path d="M2 1L6 4L2 7" stroke="var(--text-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[var(--text-primary)] truncate flex-1">{fd.file.name}</span>
              {fd.file.binary ? (
                <span className="text-[var(--text-muted)] text-[11px] shrink-0">{t.binary_label}</span>
              ) : (
                <>
                  <span className="shrink-0" style={{ color: "var(--cyan)" }}>+{fd.file.additions}</span>
                  <span className="shrink-0" style={{ color: "var(--red)" }}>-{fd.file.deletions}</span>
                  <ChangeBar additions={fd.file.additions} deletions={fd.file.deletions} />
                </>
              )}
            </button>
            {expandedFiles.has(fd.file.name) && (
              <div className="bg-[var(--bg)] border-y border-[var(--border)] overflow-x-auto">
                {fd.file.isImage ? (
                  <div className="px-3 py-3 flex items-start gap-3">
                    {fd.file.imageOld && (
                      <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                        <span className="text-[11px] text-[var(--red)]">{t.removed}</span>
                        <img src={fd.file.imageOld} alt="old" className="max-w-full max-h-40 rounded border border-[var(--border)] object-contain" style={{ background: "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%) 50% / 12px 12px" }} />
                      </div>
                    )}
                    {fd.file.imageOld && fd.file.imageNew && <span className="text-[13px] text-[var(--text-muted)] self-center">→</span>}
                    {fd.file.imageNew && (
                      <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                        <span className="text-[11px]" style={{ color: "var(--cyan)" }}>{fd.file.imageOld ? t.file_new : t.added}</span>
                        <img src={fd.file.imageNew} alt="new" className="max-w-full max-h-40 rounded border border-[var(--border)] object-contain" style={{ background: "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%) 50% / 12px 12px" }} />
                      </div>
                    )}
                    {!fd.file.imageOld && !fd.file.imageNew && (
                      <div className="text-[var(--text-muted)] text-center w-full py-2">{t.image_changed}</div>
                    )}
                  </div>
                ) : fd.file.binary ? (
                  <div className="px-3 py-3 text-[var(--text-muted)] text-center">{t.binary_changed}</div>
                ) : (
                  <pre className="px-3 py-1 leading-relaxed">
                    {fd.hunks.join("\n").split("\n").map((line, i) => {
                      let color = "var(--text-secondary)";
                      let bg = "transparent";
                      if (line.startsWith("+") && !line.startsWith("+++")) {
                        color = "var(--cyan)";
                        bg = "rgba(80, 227, 194, 0.06)";
                      } else if (line.startsWith("-") && !line.startsWith("---")) {
                        color = "var(--red)";
                        bg = "rgba(238, 0, 0, 0.06)";
                      } else if (line.startsWith("@@")) {
                        color = "var(--accent)";
                      } else if (line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
                        color = "var(--text-muted)";
                      }
                      return <div key={i} style={{ color, backgroundColor: bg }}>{line || " "}</div>;
                    })}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
