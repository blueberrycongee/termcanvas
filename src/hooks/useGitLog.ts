import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import type { GitBranchInfo, GitLogEntry } from "../types";
import {
  buildGitGraph,
  type GraphCommit,
  type GraphEdge,
} from "../utils/gitGraph";
import {
  EMPTY_GIT_LOG_CACHE,
  useLeftPanelRepoStore,
} from "../stores/leftPanelRepoStore";

const PAGE_SIZE = 200;

interface UseGitLogResult {
  commits: GraphCommit[];
  branches: GitBranchInfo[];
  edges: GraphEdge[];
  isGitRepo: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => void;
}

function clearGitData(
  worktreePath: string,
) {
  useLeftPanelRepoStore.getState().resolveGitLogLoad(worktreePath, {
    branches: [],
    count: PAGE_SIZE,
    isGitRepo: false,
    logEntries: [],
  });
}

export function useGitLog(worktreePath: string | null): UseGitLogResult {
  const snapshot = useLeftPanelRepoStore((state) =>
    worktreePath
      ? state.gitLogByPath[worktreePath] ?? EMPTY_GIT_LOG_CACHE
      : EMPTY_GIT_LOG_CACHE,
  );
  const requestSeqRef = useRef(0);

  const fetchData = useCallback(
    async (mode: "initial" | "refresh" | "load-more" = "refresh", requestedCount?: number) => {
      if (!worktreePath || !window.termcanvas) {
        return;
      }

      const current = useLeftPanelRepoStore.getState().gitLogByPath[worktreePath];
      const countToLoad = requestedCount ?? current?.count ?? PAGE_SIZE;
      const requestSeq = ++requestSeqRef.current;
      useLeftPanelRepoStore
        .getState()
        .beginGitLogLoad(worktreePath, mode, countToLoad);

      try {
        const repoState = await window.termcanvas.git.isRepo(worktreePath);
        if (requestSeq !== requestSeqRef.current) {
          return;
        }

        if (!repoState) {
          clearGitData(worktreePath);
          return;
        }

        const [nextBranches, nextLog] = await Promise.all([
          window.termcanvas.git.branches(worktreePath),
          window.termcanvas.git.log(worktreePath, countToLoad),
        ]);

        if (requestSeq !== requestSeqRef.current) {
          return;
        }

        useLeftPanelRepoStore.getState().resolveGitLogLoad(worktreePath, {
          branches: nextBranches,
          count: countToLoad,
          isGitRepo: true,
          logEntries: nextLog,
        });
      } catch {
        if (requestSeq !== requestSeqRef.current) {
          return;
        }
        useLeftPanelRepoStore.getState().failGitLogLoad(worktreePath);
      }
    },
    [worktreePath],
  );

  useEffect(() => {
    if (!worktreePath || !window.termcanvas) {
      return;
    }

    const current = useLeftPanelRepoStore.getState().gitLogByPath[worktreePath];
    void fetchData("initial", current?.loaded ? current.count : PAGE_SIZE);
  }, [fetchData, worktreePath]);

  useEffect(() => {
    if (!worktreePath || !window.termcanvas) {
      return;
    }

    const handleFocus = () => {
      void fetchData("refresh");
    };

    void window.termcanvas.git.watch(worktreePath);

    const removeLogChanged = window.termcanvas.git.onLogChanged((changedPath) => {
      if (changedPath === worktreePath) {
        void fetchData("refresh");
      }
    });

    const removePresenceChanged = window.termcanvas.git.onPresenceChanged(
      (changedPath, payload) => {
        if (changedPath !== worktreePath) {
          return;
        }

        if (!payload.isGitRepo) {
          requestSeqRef.current += 1;
          clearGitData(worktreePath);
          return;
        }

        void fetchData("refresh");
      },
    );

    window.addEventListener("focus", handleFocus);

    return () => {
      requestSeqRef.current += 1;
      void window.termcanvas.git.unwatch(worktreePath);
      removeLogChanged();
      removePresenceChanged();
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchData, worktreePath]);

  const graph = useMemo(
    () => buildGitGraph(snapshot.logEntries),
    [snapshot.logEntries],
  );

  return {
    commits: graph.commits,
    branches: snapshot.branches,
    edges: graph.edges,
    isGitRepo: snapshot.isGitRepo,
    loading: snapshot.loading,
    refreshing: snapshot.refreshing,
    loadingMore: snapshot.loadingMore,
    hasMore:
      snapshot.isGitRepo && snapshot.logEntries.length >= snapshot.count,
    refresh: async () => {
      await fetchData("refresh");
    },
    loadMore: () => {
      if (!worktreePath) {
        return;
      }

      const current = useLeftPanelRepoStore.getState().gitLogByPath[worktreePath]
        ?? EMPTY_GIT_LOG_CACHE;
      if (current.loading || current.loadingMore) {
        return;
      }

      const nextCount = current.count + PAGE_SIZE;
      void fetchData("load-more", nextCount);
    },
  };
}
