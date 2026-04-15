import { useCallback, useEffect, useRef, useState } from "react";

import type { GitMergeState, GitStashEntry, GitStatusEntry } from "../types";
import {
  EMPTY_GIT_STATUS_CACHE,
  useLeftPanelRepoStore,
} from "../stores/leftPanelRepoStore";

export interface UseGitStatusResult {
  stagedFiles: GitStatusEntry[];
  changedFiles: GitStatusEntry[];
  isLoading: boolean;
  refreshing: boolean;
  mergeState: GitMergeState;
  stashes: GitStashEntry[];
  refresh: () => Promise<void>;
  stageFiles: (paths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  unstageAll: () => Promise<void>;
  discardFiles: (entries: GitStatusEntry[]) => Promise<void>;
  discardAll: () => Promise<void>;
  commit: (message: string) => Promise<string>;
  amend: (message: string) => Promise<string>;
  push: () => Promise<string>;
  pull: () => Promise<string>;
  fetch: (remote?: string) => Promise<string>;
  stashCreate: (message: string, includeUntracked: boolean) => Promise<void>;
  stashApply: (index: number) => Promise<void>;
  stashPop: (index: number) => Promise<void>;
  stashDrop: (index: number) => Promise<void>;
  refreshStashes: () => Promise<void>;
}

const NONE_MERGE_STATE: GitMergeState = { type: "none" };

export function useGitStatus(worktreePath: string | null): UseGitStatusResult {
  const snapshot = useLeftPanelRepoStore((state) =>
    worktreePath
      ? state.gitStatusByPath[worktreePath] ?? EMPTY_GIT_STATUS_CACHE
      : EMPTY_GIT_STATUS_CACHE,
  );
  const mountedRef = useRef(true);
  const [mergeState, setMergeState] = useState<GitMergeState>(NONE_MERGE_STATE);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);

  const refreshMergeState = useCallback(async () => {
    if (!worktreePath) return;
    try {
      const state = await window.termcanvas.git.mergeState(worktreePath);
      if (mountedRef.current) setMergeState(state);
    } catch {
      if (mountedRef.current) setMergeState(NONE_MERGE_STATE);
    }
  }, [worktreePath]);

  const refreshStashes = useCallback(async () => {
    if (!worktreePath) return;
    try {
      const list = await window.termcanvas.git.stashList(worktreePath);
      if (mountedRef.current) setStashes(list);
    } catch {
      if (mountedRef.current) setStashes([]);
    }
  }, [worktreePath]);

  const refresh = useCallback(async () => {
    if (!worktreePath) return;
    useLeftPanelRepoStore.getState().beginGitStatusLoad(worktreePath);
    try {
      const entries = await window.termcanvas.git.status(worktreePath);
      if (!mountedRef.current) return;
      useLeftPanelRepoStore.getState().resolveGitStatusLoad(worktreePath, {
        changedFiles: entries.filter((entry) => !entry.staged),
        stagedFiles: entries.filter((entry) => entry.staged),
      });
    } catch {
      if (!mountedRef.current) return;
      useLeftPanelRepoStore.getState().failGitStatusLoad(worktreePath);
    }
    // Also refresh merge state and stashes alongside status
    await Promise.all([refreshMergeState(), refreshStashes()]);
  }, [worktreePath, refreshMergeState, refreshStashes]);

  useEffect(() => {
    mountedRef.current = true;
    if (!worktreePath) {
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
    const allPaths = snapshot.changedFiles.map((e) => e.path);
    if (allPaths.length === 0) return;
    await window.termcanvas.git.stage(worktreePath, allPaths);
    await refresh();
  }, [worktreePath, snapshot.changedFiles, refresh]);

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
    const allPaths = snapshot.stagedFiles.map((e) => e.path);
    if (allPaths.length === 0) return;
    await window.termcanvas.git.unstage(worktreePath, allPaths);
    await refresh();
  }, [worktreePath, snapshot.stagedFiles, refresh]);

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
    if (!worktreePath || snapshot.changedFiles.length === 0) return;
    await discardFiles(snapshot.changedFiles);
  }, [worktreePath, snapshot.changedFiles, discardFiles]);

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

  const amend = useCallback(
    async (message: string): Promise<string> => {
      if (!worktreePath) return "";
      const hash = await window.termcanvas.git.amend(worktreePath, message);
      await refresh();
      return hash;
    },
    [worktreePath, refresh],
  );

  const fetchRemote = useCallback(
    async (remote?: string): Promise<string> => {
      if (!worktreePath) return "";
      const result = await window.termcanvas.git.fetch(worktreePath, remote);
      await refresh();
      return result;
    },
    [worktreePath, refresh],
  );

  const stashCreate = useCallback(
    async (message: string, includeUntracked: boolean) => {
      if (!worktreePath) return;
      await window.termcanvas.git.stashCreate(worktreePath, message, includeUntracked);
      await refresh();
    },
    [worktreePath, refresh],
  );

  const stashApply = useCallback(
    async (index: number) => {
      if (!worktreePath) return;
      await window.termcanvas.git.stashApply(worktreePath, index);
      await refresh();
    },
    [worktreePath, refresh],
  );

  const stashPop = useCallback(
    async (index: number) => {
      if (!worktreePath) return;
      await window.termcanvas.git.stashPop(worktreePath, index);
      await refresh();
    },
    [worktreePath, refresh],
  );

  const stashDrop = useCallback(
    async (index: number) => {
      if (!worktreePath) return;
      await window.termcanvas.git.stashDrop(worktreePath, index);
      await refresh();
    },
    [worktreePath, refresh],
  );

  return {
    stagedFiles: snapshot.stagedFiles,
    changedFiles: snapshot.changedFiles,
    isLoading: snapshot.loading,
    refreshing: snapshot.refreshing,
    mergeState,
    stashes,
    refresh,
    stageFiles,
    stageAll,
    unstageFiles,
    unstageAll,
    discardFiles,
    discardAll,
    commit,
    amend,
    push,
    pull,
    fetch: fetchRemote,
    stashCreate,
    stashApply,
    stashPop,
    stashDrop,
    refreshStashes,
  };
}
