import { useEffect, useMemo, useState } from "react";

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
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => void;
}

export function useGitLog(worktreePath: string | null): UseGitLogResult {
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setCount(PAGE_SIZE);
  }, [worktreePath]);

  useEffect(() => {
    if (!worktreePath || !window.termcanvas) {
      setBranches([]);
      setLogEntries([]);
      setIsGitRepo(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const repoState = await window.termcanvas.git.isRepo(worktreePath);
      if (cancelled) return;

      setIsGitRepo(repoState);
      if (!repoState) {
        setBranches([]);
        setLogEntries([]);
        setLoading(false);
        return;
      }

      const [nextBranches, nextLog] = await Promise.all([
        window.termcanvas.git.branches(worktreePath),
        window.termcanvas.git.log(worktreePath, count),
      ]);
      if (cancelled) return;

      setBranches(nextBranches);
      setLogEntries(nextLog);
      setLoading(false);
    };

    const handleFocus = () => {
      void load();
    };

    void load();
    void window.termcanvas.git.watch(worktreePath);

    const removeLogChanged = window.termcanvas.git.onLogChanged((changedPath) => {
      if (changedPath === worktreePath) {
        void load();
      }
    });
    const removePresenceChanged = window.termcanvas.git.onPresenceChanged(
      (changedPath, payload) => {
        if (changedPath !== worktreePath) return;
        if (!payload.isGitRepo) {
          setIsGitRepo(false);
          setBranches([]);
          setLogEntries([]);
          setLoading(false);
          return;
        }
        void load();
      },
    );

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      void window.termcanvas.git.unwatch(worktreePath);
      removeLogChanged();
      removePresenceChanged();
      window.removeEventListener("focus", handleFocus);
    };
  }, [count, worktreePath]);

  const graph = useMemo(() => buildGitGraph(logEntries), [logEntries]);

  return {
    commits: graph.commits,
    branches,
    edges: graph.edges,
    isGitRepo,
    loading,
    hasMore: isGitRepo && logEntries.length >= count,
    refresh: async () => {
      if (!worktreePath) return;

      setLoading(true);
      const repoState = await window.termcanvas.git.isRepo(worktreePath);
      setIsGitRepo(repoState);
      if (!repoState) {
        setBranches([]);
        setLogEntries([]);
        setLoading(false);
        return;
      }

      const [nextBranches, nextLog] = await Promise.all([
        window.termcanvas.git.branches(worktreePath),
        window.termcanvas.git.log(worktreePath, count),
      ]);
      setBranches(nextBranches);
      setLogEntries(nextLog);
      setLoading(false);
    },
    loadMore: () => {
      if (loading) return;
      setCount((current) => current + PAGE_SIZE);
    },
  };
}
