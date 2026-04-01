import { create } from "zustand";
import type { BubbleMessage } from "../components/AgentBubble/types";

interface AgentBubbleStore {
  messages: BubbleMessage[];
  activeTaskCount: number;
  addMessage: (msg: BubbleMessage) => void;
  clearMessages: () => void;
  setActiveTaskCount: (n: number) => void;
}

export const useAgentBubbleStore = create<AgentBubbleStore>((set) => ({
  messages: [],
  activeTaskCount: 0,

  addMessage: (msg) => {
    set((state) => ({ messages: [...state.messages, msg] }));
  },

  clearMessages: () => {
    set({ messages: [] });
  },

  setActiveTaskCount: (n) => {
    set({ activeTaskCount: n });
  },
}));
