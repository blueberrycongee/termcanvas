import { useEffect } from "react";
import { parseDiff } from "../utils/diffParser";
import {
  EMPTY_DIFF_CACHE,
  useLeftPanelRepoStore,
} from "../stores/leftPanelRepoStore";
import { appEvents } from "../events";

export function useWorktreeDiff(worktreePath: string | null) {
  const snapshot = useLeftPanelRepoStore((state) =>
    worktreePath
      ? state.diffByPath[worktreePath] ?? EMPTY_DIFF_CACHE
      : EMPTY_DIFF_CACHE,
  );

  useEffect(() => {
    if (!worktreePath || !window.termcanvas) {
      return;
    }

    let active = true;
    let requestSeq = 0;

    const fetchDiff = () => {
      const currentRequest = ++requestSeq;
      useLeftPanelRepoStore.getState().beginDiffLoad(worktreePath);
      window.termcanvas.project.diff(worktreePath).then((result) => {
        if (!active || currentRequest !== requestSeq) return;
        useLeftPanelRepoStore.getState().resolveDiffLoad(
          worktreePath,
          parseDiff(result.diff, result.files),
        );
      }).catch(() => {
        if (!active || currentRequest !== requestSeq) return;
        useLeftPanelRepoStore.getState().failDiffLoad(worktreePath);
      });
    };

    fetchDiff();

    window.termcanvas.git.watch(worktreePath);
    const removeGitChanged = window.termcanvas.git.onChanged((changedPath) => {
      if (changedPath === worktreePath) fetchDiff();
    });

    const removeActivityListener = appEvents.on("worktree:activity", ({
      worktreePath: changedPath,
    }) => {
      if (changedPath === worktreePath) fetchDiff();
    });
    const handleFocus = () => fetchDiff();

    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      requestSeq += 1;
      window.termcanvas.git.unwatch(worktreePath);
      removeGitChanged();
      removeActivityListener();
      window.removeEventListener("focus", handleFocus);
    };
  }, [worktreePath]);

  return {
    fileDiffs: snapshot.fileDiffs,
    loading: snapshot.loading,
    refreshing: snapshot.refreshing,
  };
}
