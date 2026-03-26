import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { GitBranchInfo, GitLogEntry } from "../types";
import {
  buildGitGraph,
  type GraphCommit,
  type GraphEdge,
} from "../utils/gitGraph";

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
  setBranches: Dispatch<SetStateAction<GitBranchInfo[]>>,
  setLogEntries: Dispatch<SetStateAction<GitLogEntry[]>>,
  setIsGitRepo: Dispatch<SetStateAction<boolean>>,
) {
  setBranches([]);
  setLogEntries([]);
  setIsGitRepo(false);
}

export function useGitLog(worktreePath: string | null): UseGitLogResult {
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [count, setCount] = useState(PAGE_SIZE);
  const requestSeqRef = useRef(0);
  const countRef = useRef(PAGE_SIZE);
  const logLengthRef = useRef(0);

  useEffect(() => {
    logLengthRef.current = logEntries.length;
  }, [logEntries.length]);

  const fetchData = useCallback(
    async (mode: "initial" | "refresh" | "load-more" = "refresh", requestedCount?: number) => {
      if (!worktreePath || !window.termcanvas) {
        clearGitData(setBranches, setLogEntries, setIsGitRepo);
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        return;
      }

      const countToLoad = requestedCount ?? countRef.current;
      const hasVisibleData = logLengthRef.current > 0;
      const requestSeq = ++requestSeqRef.current;

      if (mode === "load-more") {
        setLoadingMore(true);
      } else if (mode === "refresh" && hasVisibleData) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const repoState = await window.termcanvas.git.isRepo(worktreePath);
        if (requestSeq !== requestSeqRef.current) {
          return;
        }

        setIsGitRepo(repoState);
        if (!repoState) {
          clearGitData(setBranches, setLogEntries, setIsGitRepo);
          return;
        }

        const [nextBranches, nextLog] = await Promise.all([
          window.termcanvas.git.branches(worktreePath),
          window.termcanvas.git.log(worktreePath, countToLoad),
        ]);

        if (requestSeq !== requestSeqRef.current) {
          return;
        }

        setBranches(nextBranches);
        setLogEntries(nextLog);
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [worktreePath],
  );

  useEffect(() => {
    countRef.current = PAGE_SIZE;
    setCount(PAGE_SIZE);

    if (!worktreePath || !window.termcanvas) {
      clearGitData(setBranches, setLogEntries, setIsGitRepo);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }

    clearGitData(setBranches, setLogEntries, setIsGitRepo);
    setLoading(true);
    setRefreshing(false);
    setLoadingMore(false);

    void fetchData("initial", PAGE_SIZE);
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
          clearGitData(setBranches, setLogEntries, setIsGitRepo);
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
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

  const graph = useMemo(() => buildGitGraph(logEntries), [logEntries]);

  return {
    commits: graph.commits,
    branches,
    edges: graph.edges,
    isGitRepo,
    loading,
    refreshing,
    loadingMore,
    hasMore: isGitRepo && logEntries.length >= count,
    refresh: async () => {
      await fetchData("refresh");
    },
    loadMore: () => {
      if (loading || loadingMore) {
        return;
      }

      const nextCount = countRef.current + PAGE_SIZE;
      countRef.current = nextCount;
      setCount(nextCount);
      void fetchData("load-more", nextCount);
    },
  };
}
