import { create } from "zustand";
import type { BubbleMessage, BubbleSession } from "../components/AgentBubble/types";

function createSession(): BubbleSession {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    messages: [],
    createdAt: Date.now(),
  };
}

function deriveTitle(messages: BubbleMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New Chat";
  const text = first.content.trim();
  return text.length > 30 ? text.slice(0, 30) + "…" : text;
}

interface AgentBubbleStore {
  sessions: BubbleSession[];
  activeSessionId: string;
  activeTaskCount: number;

  /** Messages of the active session (derived) */
  messages: BubbleMessage[];

  addMessage: (msg: BubbleMessage) => void;
  clearMessages: () => void;
  setActiveTaskCount: (n: number) => void;

  newSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
}

const initial = createSession();

export const useAgentBubbleStore = create<AgentBubbleStore>((set, get) => ({
  sessions: [initial],
  activeSessionId: initial.id,
  activeTaskCount: 0,
  messages: [],

  addMessage: (msg) => {
    set((state) => {
      const sessions = state.sessions.map((s) => {
        if (s.id !== state.activeSessionId) return s;
        const messages = [...s.messages, msg];
        return {
          ...s,
          messages,
          title: s.messages.length === 0 ? deriveTitle(messages) : s.title,
        };
      });
      const active = sessions.find((s) => s.id === state.activeSessionId);
      return { sessions, messages: active?.messages ?? [] };
    });
  },

  clearMessages: () => {
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === state.activeSessionId ? { ...s, messages: [] } : s,
      );
      return { sessions, messages: [] };
    });
  },

  setActiveTaskCount: (n) => {
    set({ activeTaskCount: n });
  },

  newSession: () => {
    const state = get();
    const active = state.sessions.find((s) => s.id === state.activeSessionId);
    if (active && active.messages.length === 0) return;

    const session = createSession();
    set({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
      messages: [],
    });
  },

  switchSession: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    set({ activeSessionId: id, messages: session.messages });
  },

  deleteSession: (id) => {
    const state = get();
    if (state.sessions.length <= 1) {
      const fresh = createSession();
      set({ sessions: [fresh], activeSessionId: fresh.id, messages: [] });
      return;
    }
    const sessions = state.sessions.filter((s) => s.id !== id);
    if (state.activeSessionId === id) {
      const next = sessions[0];
      set({ sessions, activeSessionId: next.id, messages: next.messages });
    } else {
      set({ sessions });
    }
  },
}));
