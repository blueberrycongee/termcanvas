import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import type {
  ContextMenuItem as PierreContextMenuItem,
  ContextMenuOpenContext as PierreContextMenuOpenContext,
  FileTreeRenameEvent,
  FileTreeRowDecoration,
  FileTreeRowDecorationContext,
  GitStatusEntry as PierreGitStatusEntry,
} from "@pierre/trees";
import { useWorktreeFiles } from "../../hooks/useWorktreeFiles";
import { useGitStatus } from "../../hooks/useGitStatus";
import { useT } from "../../i18n/useT";
import { useCanvasStore } from "../../stores/canvasStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { ContextMenu, type MenuItem } from "../ContextMenu";
import type { GitFileStatus } from "../../types";

interface Props {
  worktreePath: string | null;
  onFileClick: (filePath: string) => void;
}

// Map our git status codes to @pierre/trees status strings.
// `@pierre/trees` does not have an explicit "conflict" status, so unmerged
// (U) is mapped to "deleted" — the most attention-grabbing visual treatment
// available — to preserve conflict visibility (instead of being lost as a
// generic "modified" change). Copied (C) maps to "renamed" since both are
// derived from existing files; "added" would mis-imply a fresh creation.
const GIT_STATUS_MAP: Record<GitFileStatus, PierreGitStatusEntry["status"]> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  U: "deleted",
  "?": "untracked",
};

// Lower number = higher priority (mirrors original FilesContent priority order).
// When a file appears in both staged and unstaged lists, we surface the more
// alarming status (U > D > M > A > R > C > ?).
const STATUS_PRIORITY: Record<GitFileStatus, number> = {
  U: 0,
  D: 1,
  M: 2,
  A: 3,
  R: 4,
  C: 5,
  "?": 6,
};

const NEW_ENTRY_PREFIX = "__pierre_new_";

export function FilesContent({ worktreePath, onFileClick }: Props) {
  const t = useT();
  const { paths, loading, refresh } = useWorktreeFiles(worktreePath);
  const { changedFiles, stagedFiles } = useGitStatus(worktreePath);
  const fileEditorPath = useCanvasStore((s) => s.fileEditorPath);
  const { notify } = useNotificationStore.getState();

  const pierreGitStatus = useMemo<PierreGitStatusEntry[]>(() => {
    const statusMap = new Map<string, GitFileStatus>();
    for (const entry of [...changedFiles, ...stagedFiles]) {
      const existing = statusMap.get(entry.path);
      if (
        !existing ||
        STATUS_PRIORITY[entry.status] < STATUS_PRIORITY[existing]
      ) {
        statusMap.set(entry.path, entry.status);
      }
    }
    const result: PierreGitStatusEntry[] = [];
    for (const [path, status] of statusMap) {
      const mapped = GIT_STATUS_MAP[status];
      if (mapped) result.push({ path, status: mapped });
    }
    return result;
  }, [changedFiles, stagedFiles]);

  const worktreePathRef = useRef(worktreePath);
  worktreePathRef.current = worktreePath;

  const onFileClickRef = useRef(onFileClick);
  onFileClickRef.current = onFileClick;

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Tracks the currently open file (relative to worktreePath) so the row
  // decoration renderer — which is fixed at model construction — can read the
  // latest value without being recreated.
  const openFileRelPathRef = useRef<string | null>(null);
  openFileRelPathRef.current =
    fileEditorPath && worktreePath && fileEditorPath.startsWith(worktreePath + "/")
      ? fileEditorPath.slice(worktreePath.length + 1)
      : null;

  const pendingCreates = useRef<Map<string, "file" | "folder">>(new Map());

  const handleRename = useCallback(
    async (event: FileTreeRenameEvent) => {
      const wtp = worktreePathRef.current;
      if (!wtp) return;

      const pendingType = pendingCreates.current.get(event.sourcePath);
      if (pendingType !== undefined) {
        pendingCreates.current.delete(event.sourcePath);
        const parts = event.destinationPath.split("/");
        const name = parts[parts.length - 1];
        const parentRelPath = parts.slice(0, -1).join("/");
        const parentAbsPath = parentRelPath ? `${wtp}/${parentRelPath}` : wtp;
        try {
          if (pendingType === "folder") {
            await window.termcanvas.fs.mkdir(parentAbsPath, name);
          } else {
            await window.termcanvas.fs.createFile(parentAbsPath, name);
          }
        } catch (err) {
          notify("error", `Create failed: ${err}`);
        }
        await refreshRef.current();
        return;
      }

      const dstName = event.destinationPath.split("/").pop()!;
      const srcName = event.sourcePath.split("/").pop()!;
      if (srcName !== dstName) {
        try {
          await window.termcanvas.fs.rename(`${wtp}/${event.sourcePath}`, dstName);
        } catch (err) {
          notify("error", `Rename failed: ${err}`);
        }
        await refreshRef.current();
      }
    },
    [notify],
  );

  const modelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);

  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const wtp = worktreePathRef.current;
      if (!wtp || selectedPaths.length !== 1) return;
      const relPath = selectedPaths[0];
      const item = modelRef.current?.getItem(relPath);
      if (item && !item.isDirectory()) {
        onFileClickRef.current(`${wtp}/${relPath}`);
      }
    },
    [],
  );

  // Independent open-file marker driven by `fileEditorPath` (not by selection).
  // Returns a small bullet decoration on the row currently open in the file
  // editor; selection state is unaffected by clicks elsewhere in the tree.
  const renderRowDecoration = useCallback(
    (context: FileTreeRowDecorationContext): FileTreeRowDecoration | null => {
      const openRel = openFileRelPathRef.current;
      if (openRel != null && context.item.path === openRel) {
        return { text: "●", title: "Open in editor" };
      }
      return null;
    },
    [],
  );

  const { model } = useFileTree({
    paths: [],
    initialExpansion: "closed",
    search: true,
    onSelectionChange: handleSelectionChange,
    renderRowDecoration,
    renaming: {
      onRename: handleRename,
    },
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "right-click",
      },
    },
    // Native row drag enabled (so files can be dragged out to terminals);
    // disable drop so the library does not reorder paths internally.
    dragAndDrop: {
      canDrop: () => false,
    },
  });

  modelRef.current = model;

  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  useEffect(() => {
    model.setGitStatus(pierreGitStatus);
  }, [model, pierreGitStatus]);

  // Force the tree to re-render visible rows when the open-file path changes
  // so renderRowDecoration is re-invoked. setIcons is the cheapest no-op
  // mutation: we never set icons, so passing undefined preserves state while
  // the implementation always calls renderFileTreeRoot afterwards.
  useEffect(() => {
    model.setIcons(undefined);
  }, [model, fileEditorPath, worktreePath]);

  const buildMenuItems = useCallback(
    (
      item: PierreContextMenuItem,
      context: PierreContextMenuOpenContext,
    ): MenuItem[] => {
      const wtp = worktreePathRef.current;
      if (!wtp) return [];

      const isRoot = !item.path || item.path === "." || item.path === "";
      const isDir = item.kind === "directory";
      const targetDir = isDir
        ? item.path
        : item.path.split("/").slice(0, -1).join("/");
      const name = item.name;

      const startCreate = (type: "file" | "folder") => {
        context.close();
        const tempName = `${NEW_ENTRY_PREFIX}${Date.now()}`;
        const tempRelPath = targetDir ? `${targetDir}/${tempName}` : tempName;
        pendingCreates.current.set(tempRelPath, type);
        model.add(tempRelPath);
        if (isDir) {
          const dirHandle = model.getItem(item.path);
          if (dirHandle?.isDirectory()) {
            (dirHandle as { expand(): void }).expand();
          }
        }
        model.startRenaming(tempRelPath, { removeIfCanceled: true });
      };

      const items: MenuItem[] = [
        { label: t.ctx_new_file, onClick: () => startCreate("file") },
        { label: t.ctx_new_folder, onClick: () => startCreate("folder") },
      ];

      if (!isRoot) {
        items.push(
          { type: "separator" },
          {
            label: t.ctx_rename,
            onClick: () => {
              context.close();
              model.startRenaming(item.path);
            },
          },
          {
            label: t.ctx_delete,
            danger: true,
            onClick: () => {
              context.close();
              if (!window.confirm(t.ctx_confirm_delete(name))) return;
              window.termcanvas.fs
                .delete(`${wtp}/${item.path}`)
                .then(() => refreshRef.current())
                .catch((err) => notify("error", `Delete failed: ${err}`));
            },
          },
        );
      }

      items.push(
        { type: "separator" },
        {
          label: t.ctx_copy_path,
          onClick: () => {
            context.close();
            navigator.clipboard.writeText(item.path);
          },
        },
        {
          label: t.ctx_reveal(window.termcanvas?.app.platform ?? "darwin"),
          onClick: () => {
            context.close();
            window.termcanvas.fs.reveal(
              item.path ? `${wtp}/${item.path}` : wtp,
            );
          },
        },
      );

      return items;
    },
    [t, model, notify],
  );

  const renderContextMenu = useCallback(
    (item: PierreContextMenuItem, context: PierreContextMenuOpenContext) => {
      const menuItems = buildMenuItems(item, context);
      const rect = context.anchorRect;
      return createPortal(
        <ContextMenu
          x={rect.x}
          y={rect.y + rect.height}
          items={menuItems}
          onClose={() => context.close()}
        />,
        document.body,
      );
    },
    [buildMenuItems],
  );

  const [isDragOver, setIsDragOver] = useState(false);

  const isOsDrag = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    return (
      types.includes("Files") &&
      !types.includes("application/x-termcanvas-file")
    );
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (!worktreePath || !isOsDrag(e)) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const sources = files
        .map((f) => window.termcanvas.fs.getFilePath(f))
        .filter(Boolean);
      if (sources.length === 0) return;
      try {
        const result = await window.termcanvas.fs.copy(sources, worktreePath);
        await refresh();
        if (result.skipped.length > 0) {
          notify("warn", `Skipped (already exist): ${result.skipped.join(", ")}`);
        }
      } catch (err) {
        notify("error", `Copy failed: ${err}`);
      }
    },
    [worktreePath, isOsDrag, refresh, notify],
  );

  // Container ref for capturing native dragstart events that bubble out of
  // the @pierre/trees shadow DOM. The library sets `text/plain` to the row's
  // relative path; in bubble phase we override with absolute paths and add
  // our own `application/x-termcanvas-file` payload so terminal cards can
  // accept the drop. When the dragged row is part of the model's selection,
  // we serialize the entire selection (newline-separated) — matching the
  // library's own multi-select drag semantics.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: DragEvent) => {
      const wtp = worktreePathRef.current;
      const m = modelRef.current;
      if (!wtp || !e.dataTransfer || !m) return;

      // Find the dragged row's path from composedPath (events bubble out of
      // the shadow DOM but their target is retargeted to the host).
      let originPath: string | null = null;
      for (const node of e.composedPath()) {
        if (!(node instanceof HTMLElement)) continue;
        const itemPath = node.getAttribute("data-item-path");
        if (itemPath != null) {
          originPath = itemPath;
          break;
        }
      }
      if (originPath == null) return;

      // If the drag origin is part of the current selection, drag the whole
      // selection set; otherwise drag just the origin row. This mirrors the
      // library's own resolveDraggedPathsForStart logic.
      const selected = m.getSelectedPaths();
      const draggedRelPaths = selected.includes(originPath)
        ? Array.from(selected)
        : [originPath];
      const absPaths = draggedRelPaths.map((p) => `${wtp}/${p}`);
      const serialized = absPaths.join("\n");

      try {
        e.dataTransfer.setData("text/plain", serialized);
        e.dataTransfer.setData("application/x-termcanvas-file", serialized);
        e.dataTransfer.effectAllowed = "copy";
      } catch {}
    };
    el.addEventListener("dragstart", handler);
    return () => el.removeEventListener("dragstart", handler);
  }, []);

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
      ref={containerRef}
      className={`flex-1 min-h-0 flex flex-col ${isDragOver ? "ring-1 ring-[var(--accent)]" : ""}`}
      onDragOver={(e) => {
        if (!isOsDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <PierreFileTree
        model={model}
        renderContextMenu={renderContextMenu}
        style={{
          flex: 1,
          minHeight: 0,
          // Map TermCanvas CSS variables into @pierre/trees shadow DOM via
          // inherited custom properties.
          ["--trees-theme-sidebar-bg" as string]: "var(--surface)",
          ["--trees-theme-sidebar-fg" as string]: "var(--text-primary)",
          ["--trees-theme-sidebar-header-fg" as string]: "var(--text-secondary)",
          ["--trees-theme-sidebar-border" as string]: "var(--border)",
          ["--trees-theme-list-hover-bg" as string]: "var(--surface-hover)",
          ["--trees-theme-list-active-selection-bg" as string]: "var(--accent-soft)",
          ["--trees-theme-list-active-selection-fg" as string]: "var(--text-primary)",
          ["--trees-theme-focus-ring" as string]: "var(--accent)",
          ["--trees-theme-input-bg" as string]: "var(--sidebar)",
          ["--trees-theme-input-border" as string]: "var(--border)",
          ["--trees-theme-input-fg" as string]: "var(--text-primary)",
          ["--trees-theme-scrollbar-thumb" as string]: "var(--border-hover)",
          ["--trees-theme-git-added-fg" as string]: "var(--cyan)",
          ["--trees-theme-git-modified-fg" as string]: "var(--amber)",
          ["--trees-theme-git-deleted-fg" as string]: "var(--red)",
          ["--trees-theme-git-renamed-fg" as string]: "var(--amber)",
          ["--trees-theme-git-untracked-fg" as string]: "var(--text-secondary)",
          ["--trees-theme-git-ignored-fg" as string]: "var(--text-faint)",
        } as React.CSSProperties}
      />
    </div>
  );
}
