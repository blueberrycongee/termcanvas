import { useState, useEffect, useCallback } from "react";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export function useWorktreeFiles(worktreePath: string | null) {
  const [entries, setEntries] = useState<Map<string, DirEntry[]>>(new Map());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!worktreePath || !window.termcanvas) {
      setEntries(new Map());
      setLoading(false);
      return;
    }

    window.termcanvas.fs.unwatchAllDirs();

    setLoading(true);
    window.termcanvas.fs.listDir(worktreePath).then((items) => {
      setEntries(new Map([[worktreePath, items]]));
      setLoading(false);
    });

    return () => {
      window.termcanvas.fs.unwatchAllDirs();
    };
  }, [worktreePath]);

  const refreshDir = useCallback(
    (dirPath: string) => {
      window.termcanvas.fs.listDir(dirPath).then((items) => {
        setEntries((prev) => new Map(prev).set(dirPath, items));
      });
    },
    [],
  );

  useEffect(() => {
    if (!window.termcanvas) return;
    return window.termcanvas.fs.onDirChanged(refreshDir);
  }, [refreshDir]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
          window.termcanvas.fs.unwatchDir(dirPath);
        } else {
          next.add(dirPath);
          window.termcanvas.fs.watchDir(dirPath);
          if (!entries.has(dirPath)) {
            window.termcanvas.fs.listDir(dirPath).then((items) => {
              setEntries((prev) => new Map(prev).set(dirPath, items));
            });
          }
        }
        return next;
      });
    },
    [entries]
  );

  return { entries, expandedDirs, toggleDir, refreshDir, loading };
}
