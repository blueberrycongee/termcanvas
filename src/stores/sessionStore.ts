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
  setSessions: (sessions: SessionInfo[]) => void;
  loadReplay: (filePath: string) => Promise<void>;
  exitReplay: () => void;
  seekTo: (index: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  togglePlayback: () => void;
  stopPlayback: () => void;
  setSpeed: (speed: number) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  liveSessions: [],
  historySessions: [],
  panelView: "list",
  replayTimeline: null,
  replayCurrentIndex: 0,
  replayIsPlaying: false,
  replaySpeed: 1,

  setSessions: (sessions) => {
    const live = sessions.filter((s) => s.isLive);
    const history = sessions.filter((s) => !s.isLive);
    set({ liveSessions: live, historySessions: history });
  },

  loadReplay: async (filePath) => {
    set({ panelView: "replay", replayTimeline: null, replayCurrentIndex: 0, replayIsPlaying: false });
    const timeline = await window.termcanvas.sessions.loadReplay(filePath);
    set({ replayTimeline: timeline });
  },

  exitReplay: () => set({ panelView: "list", replayTimeline: null, replayCurrentIndex: 0, replayIsPlaying: false }),

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
