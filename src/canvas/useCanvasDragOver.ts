import { useCallback, useRef, useState } from "react";

/**
 * OS-only file drag detection. Excludes intra-app drags (terminal moves,
 * pinned-message moves, etc.) which carry the termcanvas-specific MIME
 * type. Without this guard the canvas would light up every time the user
 * dragged a tile across it.
 */
const TERMCANVAS_INTERNAL_TYPE = "application/x-termcanvas-file";

function isOsFileDrag(event: React.DragEvent): boolean {
  const types = Array.from(event.dataTransfer.types);
  return (
    types.includes("Files") && !types.includes(TERMCANVAS_INTERNAL_TYPE)
  );
}

/**
 * Best-effort folder detection during dragenter. Chromium exposes
 * `webkitGetAsEntry()` on `DataTransferItem` for file drags, which yields
 * a directory-vs-file distinction *without* leaking paths. If detection
 * isn't available (older shells, items hidden by the platform) we return
 * false — the surface still lights up via `isDragOver`, the chip just
 * doesn't appear.
 */
function detectFolder(event: React.DragEvent): boolean {
  const items = event.dataTransfer.items;
  if (!items || items.length === 0) return false;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "file") continue;
    const entry =
      typeof item.webkitGetAsEntry === "function"
        ? item.webkitGetAsEntry()
        : null;
    if (entry?.isDirectory) return true;
  }
  return false;
}

interface CanvasDragOverState {
  isDragOver: boolean;
  isFolderDrop: boolean;
}

interface CanvasDragOverHandlers {
  onDragEnter: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

interface UseCanvasDragOverOptions {
  onDrop: (event: React.DragEvent) => void | Promise<void>;
}

/**
 * Counter-based dragenter/dragleave bookkeeping. Browser fires `dragleave`
 * on every child boundary the cursor crosses, so naive `onDragLeave →
 * setIsDragOver(false)` flickers as the cursor enters and exits child tiles.
 * Increment on enter, decrement on leave; only flip state when the counter
 * crosses zero. Same pattern as ComposerBar; lifted here so the canvas and
 * any other "whole-surface" drop zones share one implementation.
 */
export function useCanvasDragOver(options: UseCanvasDragOverOptions): {
  state: CanvasDragOverState;
  handlers: CanvasDragOverHandlers;
} {
  const counterRef = useRef(0);
  const [state, setState] = useState<CanvasDragOverState>({
    isDragOver: false,
    isFolderDrop: false,
  });

  const onDragEnter = useCallback((event: React.DragEvent) => {
    if (!isOsFileDrag(event)) return;
    event.preventDefault();
    counterRef.current += 1;
    if (counterRef.current === 1) {
      setState({ isDragOver: true, isFolderDrop: detectFolder(event) });
    }
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isOsFileDrag(event)) {
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!isOsFileDrag(event)) return;
    event.preventDefault();
    counterRef.current = Math.max(0, counterRef.current - 1);
    if (counterRef.current === 0) {
      setState({ isDragOver: false, isFolderDrop: false });
    }
  }, []);

  const userDrop = options.onDrop;
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      counterRef.current = 0;
      setState({ isDragOver: false, isFolderDrop: false });
      void userDrop(event);
    },
    [userDrop],
  );

  return {
    state,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
