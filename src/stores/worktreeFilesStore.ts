import { create } from "zustand";

// Cache of file lists per worktree, decoupled from any consuming component.
// Lifecycle:
//   acquire(wt) — first consumer attaches: subscribe fs/git watchers, kick
//     a refresh. Repeat consumers just bump the ref count.
//   release(wt) — last consumer detaches: unsubscribe watchers. The cached
//     paths/ignoredPaths stay in memory so re-acquiring is instant
//     (stale-while-revalidate: a fresh refresh fires immediately on re-attach).
//   refresh(wt) — explicit revalidation. Bumps loadId so any in-flight
//     phase 1 / phase 2 from earlier refreshes are dropped on arrival.
//
// The store owns the watcher subscriptions itself, so a tab toggle that
// unmounts the consumer does NOT churn the watcher when there are still
// other consumers (and a quick remount inside the same tick is fine —
// release/acquire just touches refCount, no fs work).

type LoadStatus = "idle" | "loading" | "loaded";

interface WorktreeEntry {
  paths: string[];
  ignoredPaths: string[];
  status: LoadStatus;
  // Monotonic; bumped by every refresh. In-flight responses with older ids
  // are dropped so a watcher tick mid-load doesn't lose its data to the
  // earlier load's late phase 2.
  loadId: number;
  // Number of mounted consumers. Reaches 0 when the user navigates away
  // from this worktree's panel; the entry stays in cache.
  refCount: number;
}

interface WorktreeFilesStore {
  byWorktree: Record<string, WorktreeEntry>;
  acquire: (worktreePath: string) => void;
  release: (worktreePath: string) => void;
  refresh: (worktreePath: string) => Promise<void>;
}

interface WatcherHandle {
  unsubFs: () => void;
  unsubGit: () => void;
}

// Watcher subscriptions live outside zustand state because they hold function
// references that aren't safe to put in a serializable store.
const watchers = new Map<string, WatcherHandle>();

function ensureWatcher(worktreePath: string): void {
  if (watchers.has(worktreePath)) return;
  const tc = window.termcanvas;
  if (!tc) return;

  tc.fs.watchDir(worktreePath);
  const unsubFs = tc.fs.onDirChanged(() => {
    void useWorktreeFilesStore.getState().refresh(worktreePath);
  });
  const unsubGit = tc.git.onChanged((changedPath: string) => {
    if (
      changedPath === worktreePath ||
      changedPath.startsWith(worktreePath + "/")
    ) {
      void useWorktreeFilesStore.getState().refresh(worktreePath);
    }
  });

  watchers.set(worktreePath, { unsubFs, unsubGit });
}

function dropWatcher(worktreePath: string): void {
  const handle = watchers.get(worktreePath);
  if (!handle) return;
  const tc = window.termcanvas;
  if (tc) tc.fs.unwatchDir(worktreePath);
  handle.unsubFs();
  handle.unsubGit();
  watchers.delete(worktreePath);
}

function arraysShallowEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const useWorktreeFilesStore = create<WorktreeFilesStore>((set, get) => ({
  byWorktree: {},

  acquire: (worktreePath) => {
    set((state) => {
      const existing = state.byWorktree[worktreePath];
      if (existing) {
        return {
          byWorktree: {
            ...state.byWorktree,
            [worktreePath]: { ...existing, refCount: existing.refCount + 1 },
          },
        };
      }
      return {
        byWorktree: {
          ...state.byWorktree,
          [worktreePath]: {
            paths: [],
            ignoredPaths: [],
            status: "idle",
            loadId: 0,
            refCount: 1,
          },
        },
      };
    });
    ensureWatcher(worktreePath);
    // Always revalidate on acquire. First-time consumers see paths populated
    // when phase 1 lands; re-attaching consumers see cached data immediately
    // and updates roll in if the worktree changed underneath.
    void get().refresh(worktreePath);
  },

  release: (worktreePath) => {
    set((state) => {
      const existing = state.byWorktree[worktreePath];
      if (!existing) return state;
      const nextRefCount = existing.refCount - 1;
      if (nextRefCount > 0) {
        return {
          byWorktree: {
            ...state.byWorktree,
            [worktreePath]: { ...existing, refCount: nextRefCount },
          },
        };
      }
      // Last consumer detached: stop watching but keep the cache. The watcher
      // is the only thing we need to release — the path arrays are GC'd
      // naturally when the entry is replaced or the worktree is forgotten.
      dropWatcher(worktreePath);
      return {
        byWorktree: {
          ...state.byWorktree,
          [worktreePath]: { ...existing, refCount: 0 },
        },
      };
    });
  },

  refresh: async (worktreePath) => {
    const tc = window.termcanvas;
    if (!tc) return;
    const initial = get().byWorktree[worktreePath];
    if (!initial) return;

    const myId = initial.loadId + 1;
    set((state) => {
      const cur = state.byWorktree[worktreePath];
      if (!cur) return state;
      return {
        byWorktree: {
          ...state.byWorktree,
          [worktreePath]: {
            ...cur,
            loadId: myId,
            status: cur.status === "loaded" ? cur.status : "loading",
          },
        },
      };
    });

    // Phase 1: tracked + non-ignored untracked. Returns ~50ms even on huge
    // repos. We update paths on success, leaving the previous list intact on
    // failure so the user keeps seeing whatever was last good.
    let trackedNext: string[] | null = null;
    try {
      const result = await tc.fs.listAllFiles(worktreePath);
      trackedNext = result.paths;
    } catch {
      // swallow; keep prior paths
    }
    {
      const cur = get().byWorktree[worktreePath];
      if (!cur || cur.loadId !== myId) return; // superseded
      if (trackedNext != null && !arraysShallowEqual(cur.paths, trackedNext)) {
        set((state) => {
          const c = state.byWorktree[worktreePath];
          if (!c || c.loadId !== myId) return state;
          return {
            byWorktree: {
              ...state.byWorktree,
              [worktreePath]: {
                ...c,
                paths: trackedNext as string[],
                status: "loaded",
              },
            },
          };
        });
      } else if (cur.status !== "loaded") {
        // No content change but we did finish loading.
        set((state) => {
          const c = state.byWorktree[worktreePath];
          if (!c || c.loadId !== myId) return state;
          return {
            byWorktree: {
              ...state.byWorktree,
              [worktreePath]: { ...c, status: "loaded" },
            },
          };
        });
      }
    }

    // Phase 2: ignored. Slower; runs in background after phase 1. The
    // renderer streams these into the tree via chunked batch-add so the UI
    // doesn't block on the 50k+ entries projects with node_modules can have.
    let ignoredNext: string[] = [];
    try {
      ignoredNext = await tc.fs.listIgnoredFiles(worktreePath);
    } catch {
      ignoredNext = [];
    }
    const cur = get().byWorktree[worktreePath];
    if (!cur || cur.loadId !== myId) return;
    if (arraysShallowEqual(cur.ignoredPaths, ignoredNext)) return;
    set((state) => {
      const c = state.byWorktree[worktreePath];
      if (!c || c.loadId !== myId) return state;
      return {
        byWorktree: {
          ...state.byWorktree,
          [worktreePath]: { ...c, ignoredPaths: ignoredNext },
        },
      };
    });
  },
}));
