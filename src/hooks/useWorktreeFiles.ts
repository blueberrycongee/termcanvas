import { useState, useEffect, useCallback, useRef } from "react";

export function useWorktreeFiles(worktreePath: string | null) {
  const [paths, setPaths] = useState<string[]>([]);
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Monotonic load id; bumping it invalidates any in-flight load (both phases)
  const loadIdRef = useRef(0);

  const loadFiles = useCallback(async () => {
    if (!worktreePath || !window.termcanvas) return;
    const myId = ++loadIdRef.current;

    // Reset ignored before refetching so the renderer doesn't briefly show
    // stale ignored entries from the previous load while phase 2 is in flight.
    setIgnoredPaths([]);

    // Phase 1: tracked + non-ignored untracked. Small, returns quickly so the
    // tree can paint without waiting for the much larger ignored set.
    try {
      const result = await window.termcanvas.fs.listAllFiles(worktreePath);
      if (loadIdRef.current !== myId) return;
      setPaths(result.paths);
    } catch {
      if (loadIdRef.current !== myId) return;
      setPaths([]);
    } finally {
      if (loadIdRef.current === myId) setLoading(false);
    }

    // Phase 2: ignored. May be 50k+ paths in projects with node_modules.
    // Runs after phase 1 so the first paint is not blocked; the renderer
    // streams these into the tree via chunked batch-add.
    try {
      const ignored = await window.termcanvas.fs.listIgnoredFiles(worktreePath);
      if (loadIdRef.current !== myId) return;
      setIgnoredPaths(ignored);
    } catch {
      if (loadIdRef.current !== myId) return;
      setIgnoredPaths([]);
    }
  }, [worktreePath]);

  useEffect(() => {
    if (!worktreePath || !window.termcanvas) {
      // Invalidate any in-flight load before resetting state
      loadIdRef.current++;
      setPaths([]);
      setIgnoredPaths([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadFiles();

    window.termcanvas.fs.watchDir(worktreePath);
    const unsubFs = window.termcanvas.fs.onDirChanged(() => {
      loadFiles();
    });

    // git emit may carry the worktree root or a subdirectory path; accept both
    const unsubGit = window.termcanvas.git.onChanged((changedPath: string) => {
      if (
        changedPath === worktreePath ||
        changedPath.startsWith(worktreePath + "/")
      ) {
        loadFiles();
      }
    });

    return () => {
      // Invalidate any in-flight load so it doesn't setState after unmount
      loadIdRef.current++;
      window.termcanvas.fs.unwatchDir(worktreePath);
      unsubFs();
      unsubGit();
    };
  }, [worktreePath, loadFiles]);

  return { paths, ignoredPaths, loading, refresh: loadFiles };
}
