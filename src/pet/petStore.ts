import { create } from "zustand";
import {
  type PetState,
  type PetEvent,
  type PetStateInfo,
  transition,
  createInitialStateInfo,
} from "./stateMachine";

export interface PetPosition {
  x: number; // canvas world coordinates
  y: number;
}

export interface PetMoveTarget {
  x: number;
  y: number;
  terminalId?: string; // if moving toward a terminal
  onTitleBar?: boolean; // sitting on a terminal's title bar
}

// --- Attention queue ---

export type AttentionPriority = "error" | "stuck" | "approval" | "success";

const PRIORITY_RANK: Record<AttentionPriority, number> = {
  error: 0,
  stuck: 1,
  approval: 2,
  success: 3,
};

export interface AttentionItem {
  id: string;
  terminalId: string;
  label: string;
  priority: AttentionPriority;
  message: string;
  timestamp: number;
}

// --- Store ---

interface PetStore {
  stateInfo: PetStateInfo;
  position: PetPosition;
  moveTarget: PetMoveTarget | null;
  isMoving: boolean;
  facingRight: boolean;
  animationFrame: number;
  showBubble: boolean;
  bubbleText: string;

  // Attention queue
  attentionQueue: AttentionItem[];
  currentAttention: AttentionItem | null;

  dispatch: (event: PetEvent) => void;
  setPosition: (pos: PetPosition) => void;
  setMoveTarget: (target: PetMoveTarget | null) => void;
  setIsMoving: (moving: boolean) => void;
  setFacingRight: (right: boolean) => void;
  advanceFrame: () => void;
  resetFrame: () => void;
  showSpeechBubble: (text: string, durationMs?: number) => void;
  hideBubble: () => void;
  enqueueAttention: (
    item: Omit<AttentionItem, "id" | "timestamp">,
  ) => void;
  acknowledgeAttention: () => void;
  clearAttentionForTerminal: (terminalId: string) => void;
}

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

export const usePetStore = create<PetStore>((set, get) => ({
  stateInfo: createInitialStateInfo(),
  position: { x: 100, y: 100 },
  moveTarget: null,
  isMoving: false,
  facingRight: true,
  animationFrame: 0,
  showBubble: false,
  bubbleText: "",
  attentionQueue: [],
  currentAttention: null,

  dispatch: (event) => {
    const current = get().stateInfo;
    const newState = transition(current, event);
    if (newState !== current.state) {
      set({
        stateInfo: {
          state: newState,
          enteredAt: Date.now(),
          previousState: current.state,
        },
        animationFrame: 0,
      });
    }
  },

  setPosition: (pos) => set({ position: pos }),

  setMoveTarget: (target) => set({ moveTarget: target }),

  setIsMoving: (moving) => set({ isMoving: moving }),

  setFacingRight: (right) => set({ facingRight: right }),

  advanceFrame: () =>
    set((s) => ({ animationFrame: s.animationFrame + 1 })),

  resetFrame: () => set({ animationFrame: 0 }),

  showSpeechBubble: (text, durationMs = 3000) => {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    set({ showBubble: true, bubbleText: text });
    bubbleTimer = setTimeout(() => {
      set({ showBubble: false, bubbleText: "" });
      bubbleTimer = null;
    }, durationMs);
  },

  hideBubble: () => {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = null;
    set({ showBubble: false, bubbleText: "" });
  },

  enqueueAttention: (item) => {
    const fullItem: AttentionItem = {
      ...item,
      id: `attn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    set((s) => {
      // Remove any existing attention for the same terminal (superseded by new state)
      const filtered = [
        ...(s.currentAttention?.terminalId === item.terminalId
          ? []
          : s.currentAttention
            ? [s.currentAttention]
            : []),
        ...s.attentionQueue.filter(
          (q) => q.terminalId !== item.terminalId,
        ),
      ];

      // Add new item, sort by priority (highest first)
      const combined = [...filtered, fullItem].sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      );

      const [next, ...rest] = combined;
      return { currentAttention: next, attentionQueue: rest };
    });
  },

  acknowledgeAttention: () => {
    set((s) => {
      if (s.attentionQueue.length > 0) {
        const [next, ...rest] = s.attentionQueue;
        return { currentAttention: next, attentionQueue: rest };
      }
      return { currentAttention: null };
    });
  },

  clearAttentionForTerminal: (terminalId) => {
    set((s) => {
      const newQueue = s.attentionQueue.filter(
        (q) => q.terminalId !== terminalId,
      );
      if (s.currentAttention?.terminalId === terminalId) {
        if (newQueue.length > 0) {
          const [next, ...rest] = newQueue;
          return { currentAttention: next, attentionQueue: rest };
        }
        return { currentAttention: null, attentionQueue: [] };
      }
      return { attentionQueue: newQueue };
    });
  },
}));
