import { useState, useEffect, useCallback, useRef } from "react";

export function useWorktreeFiles(worktreePath: string | null) {
  const [paths, setPaths] = useState<string[]>([]);
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Monotonic load id; bumping it invalidates any in-flight load
  const loadIdRef = useRef(0);

  const loadFiles = useCallback(async () => {
    if (!worktreePath || !window.termcanvas) return;
    const myId = ++loadIdRef.current;
    try {
      const result = await window.termcanvas.fs.listAllFiles(worktreePath);
      if (loadIdRef.current !== myId) return;
      setPaths(result.paths);
      setIgnoredPaths(result.ignoredPaths);
    } catch {
      if (loadIdRef.current !== myId) return;
      setPaths([]);
      setIgnoredPaths([]);
    } finally {
      if (loadIdRef.current === myId) setLoading(false);
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
