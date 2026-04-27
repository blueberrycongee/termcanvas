import { create } from "zustand";
import {
  ACTIVITY_WINDOW_MS,
  getActivityBuckets,
  getRecentActivity,
} from "../terminal/terminalActivityTracker";
import { resolveTerminalRuntimeState } from "./terminalRuntimeStateStore";
import { getTerminalDisplayTitle } from "./terminalState";
import { useProjectStore } from "./projectStore";
import { usePinStore } from "./pinStore";
import type { TerminalData } from "../types";

export type DigestSignalKind =
  | "completed"
  | "stuck"
  | "active"
  | "focused"
  | "pinned";

export interface DigestSignal {
  kind: DigestSignalKind;
  terminalId: string;
  title: string;
}

const COMPLETED_WINDOW_MS = 60_000;
const STUCK_THRESHOLD_MS = 5 * 60_000;
const ACTIVE_RECENT_MS = 30_000;
// Bucket sum (last 5 min, 30s buckets) needed to count as "busy". Tuned
// against ACTIVITY_BUCKET_DURATION_MS=30s — 12 weighted records over a
// 5-minute window is a steady stream, not a single burst.
const ACTIVE_BUCKET_THRESHOLD = 12;
const MAX_SIGNALS = 5;

interface StatusDigestState {
  open: boolean;
  signals: DigestSignal[];
  openedAt: number;
  openDigest: () => void;
  closeDigest: () => void;
}

interface TerminalLocation {
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
}

function flattenTerminals(): TerminalLocation[] {
  const out: TerminalLocation[] = [];
  for (const p of useProjectStore.getState().projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.stashed) continue;
        out.push({ terminal: t, projectId: p.id, worktreeId: w.id });
      }
    }
  }
  return out;
}

function computeSignals(now: number): DigestSignal[] {
  const terminals = flattenTerminals();
  if (terminals.length === 0) return [];

  const byId = new Map<string, TerminalLocation>();
  for (const loc of terminals) byId.set(loc.terminal.id, loc);

  const recent = getRecentActivity({
    windowMs: ACTIVITY_WINDOW_MS,
    now,
  });
  const lastActivityById = new Map<string, number>();
  for (const r of recent) lastActivityById.set(r.terminalId, r.lastActivityAt);

  const claimed = new Set<string>();
  const out: DigestSignal[] = [];

  const push = (kind: DigestSignalKind, loc: TerminalLocation) => {
    if (claimed.has(loc.terminal.id)) return;
    if (out.length >= MAX_SIGNALS) return;
    claimed.add(loc.terminal.id);
    out.push({
      kind,
      terminalId: loc.terminal.id,
      title: getTerminalDisplayTitle(loc.terminal),
    });
  };

  // 1. Just-completed: terminal is in a finished state and emitted output
  //    very recently (within 60s). These are the highest-priority signal —
  //    a long-running task just finished and the user might want to look.
  type CompletedRow = { loc: TerminalLocation; lastActivityAt: number };
  const completed: CompletedRow[] = [];
  for (const loc of terminals) {
    const status = resolveTerminalRuntimeState(loc.terminal).status;
    if (status !== "completed" && status !== "success") continue;
    const last = lastActivityById.get(loc.terminal.id);
    if (last === undefined) continue;
    if (now - last > COMPLETED_WINDOW_MS) continue;
    completed.push({ loc, lastActivityAt: last });
  }
  completed.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  for (const row of completed) push("completed", row.loc);

  // 2. Stuck: declared as running but no output for > 5 min. Inferred —
  //    only computation in the digest. Skip terminals that never emitted
  //    any output (no lastActivityAt) — those are freshly-spawned, not
  //    stuck.
  type StuckRow = { loc: TerminalLocation; idleMs: number };
  const stuck: StuckRow[] = [];
  for (const loc of terminals) {
    const status = resolveTerminalRuntimeState(loc.terminal).status;
    if (status !== "running") continue;
    const last = lastActivityById.get(loc.terminal.id);
    if (last === undefined) continue;
    const idle = now - last;
    if (idle <= STUCK_THRESHOLD_MS) continue;
    stuck.push({ loc, idleMs: idle });
  }
  stuck.sort((a, b) => b.idleMs - a.idleMs);
  for (const row of stuck) push("stuck", row.loc);

  // 3. Active: producing output above a threshold. Use total bucket
  //    volume across the activity window so a single burst doesn't
  //    qualify — busy means sustained output.
  type ActiveRow = { loc: TerminalLocation; volume: number };
  const active: ActiveRow[] = [];
  for (const loc of terminals) {
    if (claimed.has(loc.terminal.id)) continue;
    const status = resolveTerminalRuntimeState(loc.terminal).status;
    if (status !== "running" && status !== "active") continue;
    const last = lastActivityById.get(loc.terminal.id);
    if (last === undefined) continue;
    if (now - last > ACTIVE_RECENT_MS) continue;
    const buckets = getActivityBuckets(loc.terminal.id, now);
    let volume = 0;
    for (const v of buckets) volume += v;
    if (volume < ACTIVE_BUCKET_THRESHOLD) continue;
    active.push({ loc, volume });
  }
  active.sort((a, b) => b.volume - a.volume);
  for (const row of active) push("active", row.loc);

  // 4. Currently-focused — your "current context".
  for (const loc of terminals) {
    if (loc.terminal.focused) {
      push("focused", loc);
      break;
    }
  }

  // 5. Pinned terminals — declared priorities. Order by the project store's
  //    natural traversal so the same chip order is stable across opens.
  const pinMap = usePinStore.getState().terminalPinMap;
  for (const loc of terminals) {
    if (!(loc.terminal.id in pinMap)) continue;
    push("pinned", loc);
  }

  return out;
}

export const useStatusDigestStore = create<StatusDigestState>((set) => ({
  open: false,
  signals: [],
  openedAt: 0,
  openDigest: () => {
    const now = Date.now();
    const signals = computeSignals(now);
    set({ open: true, signals, openedAt: now });
  },
  closeDigest: () => set({ open: false }),
}));
