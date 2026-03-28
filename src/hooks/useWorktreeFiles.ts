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

    setLoading(true);
    window.termcanvas.fs.listDir(worktreePath).then((items) => {
      setEntries(new Map([[worktreePath, items]]));
      setLoading(false);
    });
  }, [worktreePath]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
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

  const refreshDir = useCallback(
    (dirPath: string) => {
      window.termcanvas.fs.listDir(dirPath).then((items) => {
        setEntries((prev) => new Map(prev).set(dirPath, items));
      });
    },
    [],
  );

  return { entries, expandedDirs, toggleDir, refreshDir, loading };
}
