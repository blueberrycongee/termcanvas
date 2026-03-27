import { useWorktreeFiles } from "../../hooks/useWorktreeFiles";
import { useT } from "../../i18n/useT";
import { useCanvasStore } from "../../stores/canvasStore";

interface Props {
  worktreePath: string | null;
  onFileClick: (filePath: string) => void;
}

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;

function FileIcon({ isDirectory, expanded }: { isDirectory: boolean; expanded?: boolean }) {
  if (isDirectory) {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
        {expanded ? (
          <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" stroke="var(--accent)" strokeWidth="1.2" fill="rgba(80,227,194,0.1)" />
        ) : (
          <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" stroke="var(--text-muted)" strokeWidth="1.2" fill="none" />
        )}
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z" stroke="var(--text-muted)" strokeWidth="1.2" fill="none" />
      <path d="M9 1.5v3.5h3.5" stroke="var(--text-muted)" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

export function FilesContent({ worktreePath, onFileClick }: Props) {
  const t = useT();
  const { entries, expandedDirs, toggleDir, loading } = useWorktreeFiles(worktreePath);
  const previewFile = useCanvasStore((s) => s.leftPanelPreviewFile);

  const renderEntries = (dirPath: string, depth: number): React.ReactNode => {
    const items = entries.get(dirPath);
    if (!items) return null;
    if (items.length === 0) {
      return [
        <div
          key="empty"
          className="text-[var(--text-muted)] text-[11px] py-1"
          style={{ ...MONO_STYLE, paddingLeft: depth * 16 + 16 }}
        >
          {t.file_empty_dir}
        </div>
      ];
    }
    return items.map((entry) => {
      const fullPath = `${dirPath}/${entry.name}`;
      const isExpanded = expandedDirs.has(fullPath);
      const isSelected = !entry.isDirectory && fullPath === previewFile;
      return (
        <div key={fullPath}>
          <button
            className={`w-full flex items-center gap-1.5 py-1 transition-colors duration-150 text-left ${
              isSelected
                ? "bg-[var(--surface-hover)] border-l-2 border-[var(--accent)]"
                : "hover:bg-[var(--surface-hover)] border-l-2 border-transparent"
            }`}
            style={{ paddingLeft: depth * 16 + 12, paddingRight: 8 }}
            onClick={() => {
              if (entry.isDirectory) {
                toggleDir(fullPath);
              } else {
                onFileClick(fullPath);
              }
            }}
          >
            {entry.isDirectory ? (
              <svg
                width="6"
                height="6"
                viewBox="0 0 6 6"
                fill="none"
                className={`shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
              >
                <path
                  d="M1.5 0.5L4.5 3L1.5 5.5"
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span className="w-[6px] shrink-0" />
            )}
            <FileIcon isDirectory={entry.isDirectory} expanded={isExpanded} />
            <span
              className={`truncate text-[11px] ${entry.isDirectory ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}
              style={MONO_STYLE}
            >
              {entry.name}
            </span>
          </button>
          {entry.isDirectory && isExpanded && renderEntries(fullPath, depth + 1)}
        </div>
      );
    });
  };

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[var(--text-muted)] text-[11px]">
          {t.no_worktree_selected}
        </span>
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

  return (
    <div
      className="flex-1 overflow-auto min-h-0 pt-1"
      style={{ ...MONO_STYLE, fontSize: 11 }}
    >
      {renderEntries(worktreePath, 0)}
    </div>
  );
}
