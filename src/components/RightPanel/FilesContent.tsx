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
      // The library uses canonical paths with a trailing slash for
      // directories ("src/"), but file paths without ("src/foo.ts"). Strip
      // the slash so we can build absolute paths and child relpaths without
      // doubling up.
      const stripSlash = (p: string) => (p.endsWith("/") ? p.slice(0, -1) : p);
      const itemRelPath = stripSlash(item.path);
      const targetDir = isDir
        ? itemRelPath
        : itemRelPath.split("/").slice(0, -1).join("/");
      const name = item.name;

      const startCreate = (type: "file" | "folder") => {
        context.close({ restoreFocus: false });
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
              context.close({ restoreFocus: false });
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
                .delete(`${wtp}/${itemRelPath}`)
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
            navigator.clipboard.writeText(itemRelPath ? `${wtp}/${itemRelPath}` : wtp);
          },
        },
        {
          label: t.ctx_reveal(window.termcanvas?.app.platform ?? "darwin"),
          onClick: () => {
            context.close();
            window.termcanvas.fs.reveal(
              itemRelPath ? `${wtp}/${itemRelPath}` : wtp,
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

  // Walks composedPath looking for the row identifier emitted by the
  // @pierre/trees library. Events bubble out of the open shadow DOM and get
  // retargeted to the host, so we have to consult the composed path rather
  // than `event.target`. Returns the row's relative path and whether it is a
  // file or folder (or null if the event did not originate from a row).
  const findRowFromEvent = (
    e: Event,
  ): { path: string; type: "file" | "folder" } | null => {
    for (const node of e.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const itemPath = node.getAttribute("data-item-path");
      if (itemPath == null) continue;
      const itemType = node.getAttribute("data-item-type");
      const stripped = itemPath.endsWith("/")
        ? itemPath.slice(0, -1)
        : itemPath;
      return {
        path: stripped,
        type: itemType === "folder" ? "folder" : "file",
      };
    }
    return null;
  };

  // State-based ref so effects re-run when the container element actually
  // mounts. A plain useRef would only fire once on the first commit (which
  // happens during the loading-skeleton render where the container does not
  // exist yet) and never re-attach when the file tree finally renders.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // Capture native dragstart events that bubble out of the @pierre/trees
  // shadow DOM. The library sets `text/plain` to the row's relative path; in
  // bubble phase we override with absolute paths and add our own
  // `application/x-termcanvas-file` payload so terminal cards can accept the
  // drop. When the dragged row is part of the model's selection, we serialize
  // the entire selection (newline-separated) — matching the library's own
  // multi-select drag semantics.
  useEffect(() => {
    if (!containerEl) return;
    const handler = (e: DragEvent) => {
      const wtp = worktreePathRef.current;
      const m = modelRef.current;
      if (!wtp || !e.dataTransfer || !m) return;

      const origin = findRowFromEvent(e);
      if (origin == null) return;

      // The library populates dataTransfer with the canonical row path, which
      // includes a trailing slash for folders. Our model selection paths use
      // the same convention. Strip the slash so the receiving terminal sees a
      // clean absolute path.
      const stripSlash = (p: string) => (p.endsWith("/") ? p.slice(0, -1) : p);
      const selected = m.getSelectedPaths().map(stripSlash);
      const draggedRelPaths = selected.includes(origin.path)
        ? selected
        : [origin.path];
      const absPaths = draggedRelPaths.map((p) => `${wtp}/${p}`);
      const serialized = absPaths.join("\n");

      try {
        e.dataTransfer.setData("text/plain", serialized);
        e.dataTransfer.setData("application/x-termcanvas-file", serialized);
        e.dataTransfer.effectAllowed = "copy";
      } catch {}
    };
    containerEl.addEventListener("dragstart", handler);
    return () => containerEl.removeEventListener("dragstart", handler);
  }, [containerEl]);

  // Open files on click. We listen for native click events on the container
  // (rather than wiring `onSelectionChange`) so that selection updates from
  // drag-start, keyboard navigation, or programmatic API calls do not
  // accidentally open files in the editor.
  useEffect(() => {
    if (!containerEl) return;
    const handler = (e: MouseEvent) => {
      const wtp = worktreePathRef.current;
      if (!wtp) return;
      const origin = findRowFromEvent(e);
      if (origin == null || origin.type !== "file") return;
      onFileClickRef.current(`${wtp}/${origin.path}`);
    };
    containerEl.addEventListener("click", handler);
    return () => containerEl.removeEventListener("click", handler);
  }, [containerEl]);

  // Right-click on the empty area of the file tree should still offer the
  // "New File / New Folder / Reveal" menu rooted at the worktree, matching
  // the pre-@pierre/trees behavior. Row right-clicks are handled inside the
  // library and call `event.preventDefault()`, so we only act when the event
  // is still default-allowed by the time it reaches us. We also leave native
  // text inputs alone so the search box keeps its OS clipboard menu.
  const [rootCtxMenu, setRootCtxMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    if (!containerEl) return;
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      for (const node of e.composedPath()) {
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
          return;
        }
      }
      e.preventDefault();
      setRootCtxMenu({ x: e.clientX, y: e.clientY });
    };
    containerEl.addEventListener("contextmenu", handler);
    return () => containerEl.removeEventListener("contextmenu", handler);
  }, [containerEl]);

  const buildRootMenuItems = useCallback((): MenuItem[] => {
    const wtp = worktreePathRef.current;
    if (!wtp) return [];
    const startCreate = (type: "file" | "folder") => {
      setRootCtxMenu(null);
      const tempName = `${NEW_ENTRY_PREFIX}${Date.now()}`;
      pendingCreates.current.set(tempName, type);
      model.add(tempName);
      model.startRenaming(tempName, { removeIfCanceled: true });
    };
    return [
      { label: t.ctx_new_file, onClick: () => startCreate("file") },
      { label: t.ctx_new_folder, onClick: () => startCreate("folder") },
      { type: "separator" },
      {
        label: t.ctx_copy_path,
        onClick: () => {
          setRootCtxMenu(null);
          navigator.clipboard.writeText(wtp);
        },
      },
      {
        label: t.ctx_reveal(window.termcanvas?.app.platform ?? "darwin"),
        onClick: () => {
          setRootCtxMenu(null);
          window.termcanvas.fs.reveal(wtp);
        },
      },
    ];
  }, [model, t]);

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="tc-label">{t.no_worktree_selected}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="tc-label">{t.loading}</span>
      </div>
    );
  }

  return (
    <div
      ref={setContainerEl}
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
      {rootCtxMenu &&
        createPortal(
          <ContextMenu
            x={rootCtxMenu.x}
            y={rootCtxMenu.y}
            items={buildRootMenuItems()}
            onClose={() => setRootCtxMenu(null)}
          />,
          document.body,
        )}
    </div>
  );
}
