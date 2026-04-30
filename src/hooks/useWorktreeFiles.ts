import { useCallback, useEffect } from "react";
import { useWorktreeFilesStore } from "../stores/worktreeFilesStore";

// Stable empty references so consumers reading "no entry" state don't get
// fresh array identities on every render.
const EMPTY: string[] = [];

export function useWorktreeFiles(worktreePath: string | null) {
  const paths = useWorktreeFilesStore((s) =>
    worktreePath ? (s.byWorktree[worktreePath]?.paths ?? EMPTY) : EMPTY,
  );
  const ignoredPaths = useWorktreeFilesStore((s) =>
    worktreePath ? (s.byWorktree[worktreePath]?.ignoredPaths ?? EMPTY) : EMPTY,
  );

  // Acquire/release ref counts the worktree in the store so the watcher
  // subscription is shared across consumers and survives a tab toggle that
  // unmounts and immediately remounts this component.
  useEffect(() => {
    if (!worktreePath) return;
    const store = useWorktreeFilesStore.getState();
    store.acquire(worktreePath);
    return () => {
      useWorktreeFilesStore.getState().release(worktreePath);
    };
  }, [worktreePath]);

  const refresh = useCallback(() => {
    if (!worktreePath) return Promise.resolve();
    return useWorktreeFilesStore.getState().refresh(worktreePath);
  }, [worktreePath]);

  return { paths, ignoredPaths, refresh };
}
