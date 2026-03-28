import { useState, useCallback } from "react";
import { useWorktreeFiles } from "../../hooks/useWorktreeFiles";
import { useT } from "../../i18n/useT";
import { useCanvasStore } from "../../stores/canvasStore";
import { useNotificationStore } from "../../stores/notificationStore";

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
  const { entries, expandedDirs, toggleDir, refreshDir, loading } = useWorktreeFiles(worktreePath);
  const previewFile = useCanvasStore((s) => s.leftPanelPreviewFile);

  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

  const isOsDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("Files") &&
    !e.dataTransfer.types.includes("application/x-termcanvas-file");

  const handleDirDragOver = useCallback(
    (e: React.DragEvent, dirPath: string) => {
      if (!isOsDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDropTargetDir(dirPath);
    },
    [],
  );

  const handleDirDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDropTargetDir(null);
  }, []);

  const handleDirDrop = useCallback(
    async (e: React.DragEvent, dirPath: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetDir(null);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      // @ts-ignore - path property exists on File in Electron
      const sources: string[] = files.map((f) => f.path).filter(Boolean);
      if (sources.length === 0) return;

      const result = await window.termcanvas.fs.copy(sources, dirPath);
      refreshDir(dirPath);

      if (result.skipped.length > 0) {
        const { notify } = useNotificationStore.getState();
        notify("warn", `Skipped (already exist): ${result.skipped.join(", ")}`);
      }
    },
    [refreshDir],
  );

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
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", fullPath);
              e.dataTransfer.setData("application/x-termcanvas-file", fullPath);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDragOver={entry.isDirectory ? (e) => handleDirDragOver(e, fullPath) : undefined}
            onDragLeave={entry.isDirectory ? handleDirDragLeave : undefined}
            onDrop={entry.isDirectory ? (e) => handleDirDrop(e, fullPath) : undefined}
            className={`w-full flex items-center gap-1.5 py-1 transition-colors duration-150 text-left ${
              dropTargetDir === fullPath
                ? "bg-[rgba(80,227,194,0.15)] border-l-2 border-[var(--accent)]"
                : isSelected
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
      className={`flex-1 overflow-auto min-h-0 pt-1 ${dropTargetDir === worktreePath ? "ring-1 ring-[var(--accent)]" : ""}`}
      style={{ ...MONO_STYLE, fontSize: 11 }}
      onDragOver={(e) => {
        if (!isOsDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dropTargetDir) setDropTargetDir(worktreePath);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropTargetDir(null);
      }}
      onDrop={(e) => handleDirDrop(e, worktreePath!)}
    >
      {renderEntries(worktreePath, 0)}
    </div>
  );
}
