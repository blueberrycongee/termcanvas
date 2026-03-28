import { useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useWorktreeFiles } from "../../hooks/useWorktreeFiles";
import { useT } from "../../i18n/useT";
import { useCanvasStore } from "../../stores/canvasStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { ContextMenu, type MenuItem } from "../ContextMenu";

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

/** Inline text input for rename / new file / new folder */
function InlineInput({
  defaultValue,
  depth,
  isDirectory,
  onSubmit,
  onCancel,
}: {
  defaultValue: string;
  depth: number;
  isDirectory: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);

  const commit = () => {
    if (submitted.current) return;
    submitted.current = true;
    const val = inputRef.current?.value.trim();
    if (val && val !== defaultValue) {
      onSubmit(val);
    } else {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 py-0.5"
      style={{ paddingLeft: depth * 16 + 12 + 6 + 6, paddingRight: 8 }}
    >
      <FileIcon isDirectory={isDirectory} />
      <input
        ref={inputRef}
        autoFocus
        defaultValue={defaultValue}
        className="flex-1 bg-[var(--surface-hover)] text-[var(--text-primary)] text-[11px] px-1 py-0.5 rounded border border-[var(--accent)] outline-none min-w-0"
        style={MONO_STYLE}
        onFocus={(e) => {
          // Select name without extension for files
          if (!isDirectory && defaultValue.includes(".")) {
            const dotIdx = defaultValue.lastIndexOf(".");
            e.target.setSelectionRange(0, dotIdx);
          } else {
            e.target.select();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { submitted.current = true; onCancel(); }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function FilesContent({ worktreePath, onFileClick }: Props) {
  const t = useT();
  const { entries, expandedDirs, toggleDir, refreshDir, loading } = useWorktreeFiles(worktreePath);
  const previewFile = useCanvasStore((s) => s.leftPanelPreviewFile);

  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const autoExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandDir = useRef<string | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isDir: boolean;
    parentDir: string;
    name: string;
  } | null>(null);

  // Inline editing state: rename, newFile, newFolder
  const [editing, setEditing] = useState<{
    type: "rename" | "newFile" | "newFolder";
    parentDir: string;
    path: string; // for rename: the full path; for new: the parent dir
    name: string; // current name (rename) or empty (new)
  } | null>(null);

  const { notify } = useNotificationStore.getState();

  const isOsDrag = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    return types.includes("Files") && !types.includes("application/x-termcanvas-file");
  }, []);

  const handleDirDragOver = useCallback(
    (e: React.DragEvent, dirPath: string, isDir?: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (isOsDrag(e)) {
        setDropTargetDir(dirPath);
        if (isDir && !expandedDirs.has(dirPath) && autoExpandDir.current !== dirPath) {
          if (autoExpandTimer.current) clearTimeout(autoExpandTimer.current);
          autoExpandDir.current = dirPath;
          autoExpandTimer.current = setTimeout(() => {
            toggleDir(dirPath);
            autoExpandTimer.current = null;
            autoExpandDir.current = null;
          }, 500);
        }
      }
    },
    [isOsDrag, expandedDirs, toggleDir],
  );

  const handleDirDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDropTargetDir(null);
    if (autoExpandTimer.current) {
      clearTimeout(autoExpandTimer.current);
      autoExpandTimer.current = null;
      autoExpandDir.current = null;
    }
  }, []);

  const handleDirDrop = useCallback(
    async (e: React.DragEvent, dirPath: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTargetDir(null);
      if (autoExpandTimer.current) {
        clearTimeout(autoExpandTimer.current);
        autoExpandTimer.current = null;
        autoExpandDir.current = null;
      }

      if (!isOsDrag(e)) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const sources: string[] = files
        .map((f) => window.termcanvas.fs.getFilePath(f))
        .filter(Boolean);
      if (sources.length === 0) return;

      try {
        const result = await window.termcanvas.fs.copy(sources, dirPath);
        refreshDir(dirPath);

        if (result.skipped.length > 0) {
          const { notify } = useNotificationStore.getState();
          notify("warn", `Skipped (already exist): ${result.skipped.join(", ")}`);
        }
      } catch (err) {
        console.error("[FilesContent] copy failed", err);
        const { notify } = useNotificationStore.getState();
        notify("error", `Copy failed: ${err}`);
      }
    },
    [isOsDrag, refreshDir],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, fullPath: string, isDir: boolean, parentDir: string, name: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY, path: fullPath, isDir, parentDir, name });
    },
    [],
  );

  const handleRename = useCallback(
    async (oldPath: string, newName: string, parentDir: string) => {
      try {
        await window.termcanvas.fs.rename(oldPath, newName);
        refreshDir(parentDir);
      } catch (err) {
        notify("error", `Rename failed: ${err}`);
      }
      setEditing(null);
    },
    [refreshDir, notify],
  );

  const handleNewFile = useCallback(
    async (parentDir: string, name: string) => {
      try {
        await window.termcanvas.fs.createFile(parentDir, name);
        refreshDir(parentDir);
      } catch (err) {
        notify("error", `Create file failed: ${err}`);
      }
      setEditing(null);
    },
    [refreshDir, notify],
  );

  const handleNewFolder = useCallback(
    async (parentDir: string, name: string) => {
      try {
        await window.termcanvas.fs.mkdir(parentDir, name);
        refreshDir(parentDir);
      } catch (err) {
        notify("error", `Create folder failed: ${err}`);
      }
      setEditing(null);
    },
    [refreshDir, notify],
  );

  const handleDelete = useCallback(
    async (targetPath: string, parentDir: string) => {
      try {
        await window.termcanvas.fs.delete(targetPath);
        refreshDir(parentDir);
      } catch (err) {
        notify("error", `Delete failed: ${err}`);
      }
    },
    [refreshDir, notify],
  );

  const buildMenuItems = useCallback((): MenuItem[] => {
    if (!ctxMenu) return [];
    const { path: filePath, isDir, parentDir, name } = ctxMenu;
    const targetDir = isDir ? filePath : parentDir;
    const isRoot = filePath === worktreePath;

    const items: MenuItem[] = [
      {
        label: t.ctx_new_file,
        onClick: () => {
          // Expand dir if not already
          if (isDir && !expandedDirs.has(filePath)) toggleDir(filePath);
          setEditing({ type: "newFile", parentDir: targetDir, path: targetDir, name: "" });
        },
      },
      {
        label: t.ctx_new_folder,
        onClick: () => {
          if (isDir && !expandedDirs.has(filePath)) toggleDir(filePath);
          setEditing({ type: "newFolder", parentDir: targetDir, path: targetDir, name: "" });
        },
      },
    ];

    if (!isRoot) {
      items.push(
        { type: "separator" },
        {
          label: t.ctx_rename,
          onClick: () => {
            setEditing({ type: "rename", parentDir, path: filePath, name });
          },
        },
        {
          label: t.ctx_delete,
          danger: true,
          onClick: () => {
            if (window.confirm(t.ctx_confirm_delete(name))) {
              handleDelete(filePath, parentDir);
            }
          },
        },
      );
    }

    items.push(
      { type: "separator" },
      {
        label: t.ctx_copy_path,
        onClick: () => {
          navigator.clipboard.writeText(filePath);
        },
      },
      {
        label: t.ctx_reveal(window.termcanvas?.app.platform ?? "darwin"),
        onClick: () => {
          window.termcanvas.fs.reveal(filePath);
        },
      },
    );

    return items;
  }, [ctxMenu, worktreePath, t, expandedDirs, toggleDir, handleDelete]);

  const renderEntries = (dirPath: string, depth: number): React.ReactNode => {
    const items = entries.get(dirPath);
    if (!items) return null;

    const nodes: React.ReactNode[] = [];

    // Show inline input for new file/folder at top of this directory
    if (editing && (editing.type === "newFile" || editing.type === "newFolder") && editing.parentDir === dirPath) {
      nodes.push(
        <InlineInput
          key="__new__"
          defaultValue=""
          depth={depth + (dirPath === worktreePath ? 0 : 1)}
          isDirectory={editing.type === "newFolder"}
          onSubmit={(val) =>
            editing.type === "newFile"
              ? handleNewFile(dirPath, val)
              : handleNewFolder(dirPath, val)
          }
          onCancel={() => setEditing(null)}
        />,
      );
    }

    if (items.length === 0 && nodes.length === 0) {
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

    for (const entry of items) {
      const fullPath = `${dirPath}/${entry.name}`;
      const isExpanded = expandedDirs.has(fullPath);
      const isSelected = !entry.isDirectory && fullPath === previewFile;
      const isRenaming = editing?.type === "rename" && editing.path === fullPath;

      nodes.push(
        <div key={fullPath}>
          {isRenaming ? (
            <InlineInput
              defaultValue={entry.name}
              depth={depth}
              isDirectory={entry.isDirectory}
              onSubmit={(val) => handleRename(fullPath, val, dirPath)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", fullPath);
                e.dataTransfer.setData("application/x-termcanvas-file", fullPath);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onDragOver={(e) => handleDirDragOver(e, entry.isDirectory ? fullPath : dirPath, entry.isDirectory)}
              onDragLeave={handleDirDragLeave}
              onDrop={(e) => handleDirDrop(e, entry.isDirectory ? fullPath : dirPath)}
              onContextMenu={(e) => handleContextMenu(e, fullPath, entry.isDirectory, dirPath, entry.name)}
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
          )}
          {entry.isDirectory && isExpanded && renderEntries(fullPath, depth + 1)}
        </div>,
      );
    }

    return nodes;
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
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (isOsDrag(e) && !dropTargetDir) setDropTargetDir(worktreePath);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropTargetDir(null);
      }}
      onDrop={(e) => handleDirDrop(e, worktreePath!)}
      onContextMenu={(e) => {
        // Right-click on empty area → context menu for root dir
        if (e.target === e.currentTarget) {
          e.preventDefault();
          setCtxMenu({
            x: e.clientX,
            y: e.clientY,
            path: worktreePath,
            isDir: true,
            parentDir: worktreePath,
            name: worktreePath.split("/").pop() || "",
          });
        }
      }}
    >
      {renderEntries(worktreePath, 0)}
      {ctxMenu &&
        createPortal(
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            items={buildMenuItems()}
            onClose={() => setCtxMenu(null)}
          />,
          document.body,
        )}
    </div>
  );
}
