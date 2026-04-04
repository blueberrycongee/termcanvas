import { create } from "zustand";
import type { BubbleMessage, BubbleSession } from "../components/AgentBubble/types";
import type { AgentStreamEvent } from "../types";

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
  streaming: boolean;

  messages: BubbleMessage[];

  streamingMessageId: string | null;

  addMessage: (msg: BubbleMessage) => void;
  clearMessages: () => void;
  setActiveTaskCount: (n: number) => void;

  newSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;

  handleAgentEvent: (sessionId: string, event: AgentStreamEvent) => void;
}

const initial = createSession();

export const useAgentBubbleStore = create<AgentBubbleStore>((set, get) => ({
  sessions: [initial],
  activeSessionId: initial.id,
  activeTaskCount: 0,
  streaming: false,
  messages: [],
  streamingMessageId: null,

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
    window.termcanvas.agent.delete(id);
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

  handleAgentEvent: (sessionId, event) => {
    const state = get();

    if (event.type === "stream_start") {
      const msgId = crypto.randomUUID();
      const msg: BubbleMessage = {
        id: msgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, messages: [...s.messages, msg] };
      });

      const isActive = sessionId === state.activeSessionId;
      const active = sessions.find((s) => s.id === state.activeSessionId);
      set({
        sessions,
        streaming: true,
        streamingMessageId: msgId,
        ...(isActive ? { messages: active?.messages ?? state.messages } : {}),
      });
      return;
    }

    if (event.type === "stream_end") {
      set({ streaming: false, streamingMessageId: null });
      return;
    }

    if (event.type === "text_delta") {
      const { streamingMessageId } = state;
      if (!streamingMessageId) return;

      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: s.messages.map((m) =>
            m.id === streamingMessageId
              ? { ...m, content: m.content + event.text }
              : m,
          ),
        };
      });

      const isActive = sessionId === state.activeSessionId;
      const active = sessions.find((s) => s.id === state.activeSessionId);
      set({
        sessions,
        ...(isActive ? { messages: active?.messages ?? state.messages } : {}),
      });
      return;
    }

    if (event.type === "tool_start") {
      const msg: BubbleMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Using ${event.name}...`,
        timestamp: Date.now(),
        type: "tool_call",
      };

      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, messages: [...s.messages, msg] };
      });

      const isActive = sessionId === state.activeSessionId;
      const active = sessions.find((s) => s.id === state.activeSessionId);
      set({
        sessions,
        ...(isActive ? { messages: active?.messages ?? state.messages } : {}),
      });
      return;
    }

    if (event.type === "tool_end") {
      const msg: BubbleMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: event.is_error
          ? `Tool error: ${event.content.slice(0, 200)}`
          : `${event.name} done`,
        timestamp: Date.now(),
        type: "tool_result",
      };

      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, messages: [...s.messages, msg] };
      });

      const isActive = sessionId === state.activeSessionId;
      const active = sessions.find((s) => s.id === state.activeSessionId);
      set({
        sessions,
        ...(isActive ? { messages: active?.messages ?? state.messages } : {}),
      });
      return;
    }

    if (event.type === "error") {
      const msg: BubbleMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: event.error.message,
        timestamp: Date.now(),
        type: "status",
      };

      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, messages: [...s.messages, msg] };
      });

      const isActive = sessionId === state.activeSessionId;
      const active = sessions.find((s) => s.id === state.activeSessionId);
      set({
        sessions,
        streaming: false,
        streamingMessageId: null,
        ...(isActive ? { messages: active?.messages ?? state.messages } : {}),
      });
      return;
    }

  },
}));


if (typeof window !== "undefined" && window.termcanvas?.agent) {
  window.termcanvas.agent.onEvent((sessionId, rawEvent) => {
    const event = rawEvent as AgentStreamEvent;
    useAgentBubbleStore.getState().handleAgentEvent(sessionId, event);
  });
}
