import { useState, useEffect } from "react";
import { parseDiff, type FileDiff } from "../utils/diffParser";

export function useWorktreeDiff(worktreePath: string | null) {
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!worktreePath || !window.termcanvas) {
      setFileDiffs([]);
      setLoading(false);
      return;
    }

    const fetchDiff = () => {
      window.termcanvas.project.diff(worktreePath).then((result) => {
        setFileDiffs(parseDiff(result.diff, result.files));
        setLoading(false);
      });
    };

    setLoading(true);
    fetchDiff();

    window.termcanvas.git.watch(worktreePath);
    const removeGitChanged = window.termcanvas.git.onChanged((changedPath) => {
      if (changedPath === worktreePath) fetchDiff();
    });

    const handleActivity = (e: Event) => {
      if ((e as CustomEvent).detail === worktreePath) fetchDiff();
    };
    const handleFocus = () => fetchDiff();

    window.addEventListener("termcanvas:worktree-activity", handleActivity);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.termcanvas.git.unwatch(worktreePath);
      removeGitChanged();
      window.removeEventListener("termcanvas:worktree-activity", handleActivity);
      window.removeEventListener("focus", handleFocus);
    };
  }, [worktreePath]);

  return { fileDiffs, loading };
}
