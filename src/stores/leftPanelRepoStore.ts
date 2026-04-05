import { create } from "zustand";

import type { GitBranchInfo, GitLogEntry, GitStatusEntry } from "../types";
import type { FileDiff } from "../utils/diffParser";

export interface DiffCacheEntry {
  fileDiffs: FileDiff[];
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
}

export interface GitLogCacheEntry {
  branches: GitBranchInfo[];
  count: number;
  isGitRepo: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  logEntries: GitLogEntry[];
  refreshing: boolean;
}

export interface GitStatusCacheEntry {
  changedFiles: GitStatusEntry[];
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
  stagedFiles: GitStatusEntry[];
}

interface LeftPanelRepoStoreState {
  diffByPath: Record<string, DiffCacheEntry>;
  gitLogByPath: Record<string, GitLogCacheEntry>;
  gitStatusByPath: Record<string, GitStatusCacheEntry>;
  beginDiffLoad: (path: string) => void;
  beginGitLogLoad: (
    path: string,
    mode: "initial" | "refresh" | "load-more",
    count: number,
  ) => void;
  beginGitStatusLoad: (path: string) => void;
  failDiffLoad: (path: string) => void;
  failGitLogLoad: (path: string) => void;
  failGitStatusLoad: (path: string) => void;
  resolveDiffLoad: (path: string, fileDiffs: FileDiff[]) => void;
  resolveGitLogLoad: (
    path: string,
    payload: {
      branches: GitBranchInfo[];
      count: number;
      isGitRepo: boolean;
      logEntries: GitLogEntry[];
    },
  ) => void;
  resolveGitStatusLoad: (
    path: string,
    payload: {
      changedFiles: GitStatusEntry[];
      stagedFiles: GitStatusEntry[];
    },
  ) => void;
}

export const EMPTY_DIFF_CACHE: DiffCacheEntry = Object.freeze({
  fileDiffs: [],
  loaded: false,
  loading: false,
  refreshing: false,
});

export const EMPTY_GIT_LOG_CACHE: GitLogCacheEntry = Object.freeze({
  branches: [],
  count: 200,
  isGitRepo: false,
  loaded: false,
  loading: false,
  loadingMore: false,
  logEntries: [],
  refreshing: false,
});

export const EMPTY_GIT_STATUS_CACHE: GitStatusCacheEntry = Object.freeze({
  changedFiles: [],
  loaded: false,
  loading: false,
  refreshing: false,
  stagedFiles: [],
});

function updateRecordEntry<T>(
  record: Record<string, T>,
  key: string,
  updater: (current: T | undefined) => T,
) {
  return {
    ...record,
    [key]: updater(record[key]),
  };
}

export const useLeftPanelRepoStore = create<LeftPanelRepoStoreState>(
  (set) => ({
    diffByPath: {},
    gitLogByPath: {},
    gitStatusByPath: {},

    beginDiffLoad: (path) =>
      set((state) => ({
        diffByPath: updateRecordEntry(state.diffByPath, path, (current) => {
          const entry = current ?? EMPTY_DIFF_CACHE;
          return {
            ...entry,
            loading: !entry.loaded,
            refreshing: entry.loaded,
          };
        }),
      })),

    resolveDiffLoad: (path, fileDiffs) =>
      set((state) => ({
        diffByPath: updateRecordEntry(state.diffByPath, path, (current) => ({
          ...(current ?? EMPTY_DIFF_CACHE),
          fileDiffs,
          loaded: true,
          loading: false,
          refreshing: false,
        })),
      })),

    failDiffLoad: (path) =>
      set((state) => ({
        diffByPath: updateRecordEntry(state.diffByPath, path, (current) => ({
          ...(current ?? EMPTY_DIFF_CACHE),
          loading: false,
          refreshing: false,
        })),
      })),

    beginGitLogLoad: (path, mode, count) =>
      set((state) => ({
        gitLogByPath: updateRecordEntry(state.gitLogByPath, path, (current) => {
          const entry = current ?? { ...EMPTY_GIT_LOG_CACHE, count };
          if (mode === "load-more") {
            return {
              ...entry,
              count,
              loadingMore: true,
            };
          }

          return {
            ...entry,
            count,
            loading: !entry.loaded,
            refreshing: entry.loaded,
            loadingMore: false,
          };
        }),
      })),

    resolveGitLogLoad: (path, payload) =>
      set((state) => ({
        gitLogByPath: updateRecordEntry(state.gitLogByPath, path, (current) => ({
          ...(current ?? EMPTY_GIT_LOG_CACHE),
          ...payload,
          loaded: true,
          loading: false,
          loadingMore: false,
          refreshing: false,
        })),
      })),

    failGitLogLoad: (path) =>
      set((state) => ({
        gitLogByPath: updateRecordEntry(state.gitLogByPath, path, (current) => ({
          ...(current ?? EMPTY_GIT_LOG_CACHE),
          loading: false,
          loadingMore: false,
          refreshing: false,
        })),
      })),

    beginGitStatusLoad: (path) =>
      set((state) => ({
        gitStatusByPath: updateRecordEntry(
          state.gitStatusByPath,
          path,
          (current) => {
            const entry = current ?? EMPTY_GIT_STATUS_CACHE;
            return {
              ...entry,
              loading: !entry.loaded,
              refreshing: entry.loaded,
            };
          },
        ),
      })),

    resolveGitStatusLoad: (path, payload) =>
      set((state) => ({
        gitStatusByPath: updateRecordEntry(
          state.gitStatusByPath,
          path,
          (current) => ({
            ...(current ?? EMPTY_GIT_STATUS_CACHE),
            ...payload,
            loaded: true,
            loading: false,
            refreshing: false,
          }),
        ),
      })),

    failGitStatusLoad: (path) =>
      set((state) => ({
        gitStatusByPath: updateRecordEntry(
          state.gitStatusByPath,
          path,
          (current) => ({
            ...(current ?? EMPTY_GIT_STATUS_CACHE),
            loading: false,
            refreshing: false,
          }),
        ),
      })),
  }),
);
