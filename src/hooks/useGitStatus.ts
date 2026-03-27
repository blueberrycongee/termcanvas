import { useCallback, useEffect, useRef, useState } from "react";

import type { GitStatusEntry } from "../types";

export interface UseGitStatusResult {
  stagedFiles: GitStatusEntry[];
  changedFiles: GitStatusEntry[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  stageFiles: (paths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  unstageAll: () => Promise<void>;
  discardFiles: (entries: GitStatusEntry[]) => Promise<void>;
  discardAll: () => Promise<void>;
  commit: (message: string) => Promise<string>;
  push: () => Promise<string>;
  pull: () => Promise<string>;
}

export function useGitStatus(worktreePath: string | null): UseGitStatusResult {
  const [stagedFiles, setStagedFiles] = useState<GitStatusEntry[]>([]);
  const [changedFiles, setChangedFiles] = useState<GitStatusEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!worktreePath) return;
    setIsLoading(true);
    try {
      const entries = await window.termcanvas.git.status(worktreePath);
      if (!mountedRef.current) return;
      setStagedFiles(entries.filter((e) => e.staged));
      setChangedFiles(entries.filter((e) => !e.staged));
    } catch {
      // silently fail — watcher will retry
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [worktreePath]);

  // Initial load + watcher subscription
  useEffect(() => {
    mountedRef.current = true;
    if (!worktreePath) {
      setStagedFiles([]);
      setChangedFiles([]);
      return;
    }

    refresh();

    const unsub = window.termcanvas.git.onChanged((changedPath) => {
      if (changedPath === worktreePath) {
        refresh();
      }
    });

    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, [worktreePath, refresh]);

  const stageFiles = useCallback(
    async (paths: string[]) => {
      if (!worktreePath) return;
      await window.termcanvas.git.stage(worktreePath, paths);
      await refresh();
    },
    [worktreePath, refresh],
  );

  const stageAll = useCallback(async () => {
    if (!worktreePath) return;
    const allPaths = changedFiles.map((e) => e.path);
    if (allPaths.length === 0) return;
    await window.termcanvas.git.stage(worktreePath, allPaths);
    await refresh();
  }, [worktreePath, changedFiles, refresh]);

  const unstageFiles = useCallback(
    async (paths: string[]) => {
      if (!worktreePath) return;
      await window.termcanvas.git.unstage(worktreePath, paths);
      await refresh();
    },
    [worktreePath, refresh],
  );

  const unstageAll = useCallback(async () => {
    if (!worktreePath) return;
    const allPaths = stagedFiles.map((e) => e.path);
    if (allPaths.length === 0) return;
    await window.termcanvas.git.unstage(worktreePath, allPaths);
    await refresh();
  }, [worktreePath, stagedFiles, refresh]);

  const discardFiles = useCallback(
    async (entries: GitStatusEntry[]) => {
      if (!worktreePath) return;
      const tracked = entries.filter((e) => e.status !== "?").map((e) => e.path);
      const untracked = entries.filter((e) => e.status === "?").map((e) => e.path);
      await window.termcanvas.git.discard(worktreePath, tracked, untracked);
      await refresh();
    },
    [worktreePath, refresh],
  );

  const discardAll = useCallback(async () => {
    if (!worktreePath || changedFiles.length === 0) return;
    await discardFiles(changedFiles);
  }, [worktreePath, changedFiles, discardFiles]);

  const commit = useCallback(
    async (message: string): Promise<string> => {
      if (!worktreePath) return "";
      const hash = await window.termcanvas.git.commit(worktreePath, message);
      await refresh();
      return hash;
    },
    [worktreePath, refresh],
  );

  const push = useCallback(async (): Promise<string> => {
    if (!worktreePath) return "";
    const result = await window.termcanvas.git.push(worktreePath);
    await refresh();
    return result;
  }, [worktreePath, refresh]);

  const pull = useCallback(async (): Promise<string> => {
    if (!worktreePath) return "";
    const result = await window.termcanvas.git.pull(worktreePath);
    await refresh();
    return result;
  }, [worktreePath, refresh]);

  return {
    stagedFiles,
    changedFiles,
    isLoading,
    refresh,
    stageFiles,
    stageAll,
    unstageFiles,
    unstageAll,
    discardFiles,
    discardAll,
    commit,
    push,
    pull,
  };
}
