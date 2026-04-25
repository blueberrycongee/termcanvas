import { create } from "zustand";
import type { SessionInfo, ReplayTimeline } from "../../shared/sessions";

type PanelView = "list" | "replay";

interface SessionStore {
  liveSessions: SessionInfo[];
  historySessions: SessionInfo[];
  panelView: PanelView;
  replayTimeline: ReplayTimeline | null;
  replayCurrentIndex: number;
  replayIsPlaying: boolean;
  replaySpeed: number;
  replayError: string | null;
  setSessions: (sessions: SessionInfo[]) => void;
  loadReplay: (filePath: string) => Promise<void>;
  forkSession: (
    sourceFilePath: string,
    turnIndex: number,
  ) => Promise<{ newSessionId: string; newFilePath: string }>;
  exitReplay: () => void;
  seekTo: (index: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  togglePlayback: () => void;
  stopPlayback: () => void;
  setSpeed: (speed: number) => void;
}

let replaySeq = 0;

export const useSessionStore = create<SessionStore>((set, get) => ({
  liveSessions: [],
  historySessions: [],
  panelView: "list",
  replayTimeline: null,
  replayCurrentIndex: 0,
  replayIsPlaying: false,
  replaySpeed: 1,
  replayError: null,

  setSessions: (sessions) => {
    const live = sessions.filter((s) => s.isLive);
    const history = sessions.filter((s) => !s.isLive);
    set({ liveSessions: live, historySessions: history });
  },

  loadReplay: async (filePath) => {
    const seq = ++replaySeq;
    set({ panelView: "replay", replayTimeline: null, replayCurrentIndex: 0, replayIsPlaying: false, replayError: null });
    try {
      const timeline = await window.termcanvas.sessions.loadReplay(filePath);
      if (seq !== replaySeq) return; // stale response — a newer load superseded this one
      set({ replayTimeline: timeline });
    } catch (err) {
      if (seq !== replaySeq) return;
      set({ replayError: err instanceof Error ? err.message : "Failed to load replay", panelView: "replay" });
    }
  },

  forkSession: (sourceFilePath, turnIndex) =>
    window.termcanvas.sessions.forkSession(sourceFilePath, turnIndex),

  exitReplay: () => set({ panelView: "list", replayTimeline: null, replayCurrentIndex: 0, replayIsPlaying: false, replayError: null }),

  seekTo: (index) => {
    const timeline = get().replayTimeline;
    if (!timeline) return;
    set({ replayCurrentIndex: Math.max(0, Math.min(index, timeline.events.length - 1)) });
  },

  stepForward: () => {
    const { replayCurrentIndex, replayTimeline } = get();
    if (replayTimeline && replayCurrentIndex < replayTimeline.events.length - 1) {
      set({ replayCurrentIndex: replayCurrentIndex + 1 });
    }
  },

  stepBackward: () => {
    const { replayCurrentIndex } = get();
    if (replayCurrentIndex > 0) set({ replayCurrentIndex: replayCurrentIndex - 1 });
  },

  togglePlayback: () => set((s) => ({ replayIsPlaying: !s.replayIsPlaying })),
  stopPlayback: () => set({ replayIsPlaying: false }),
  setSpeed: (speed) => set({ replaySpeed: speed }),
}));

export function initSessionStoreIPC(): () => void {
  return window.termcanvas.sessions.onListChanged((sessions) => {
    useSessionStore.getState().setSessions(sessions);
  });
}
