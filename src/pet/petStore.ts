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

interface PetStore {
  stateInfo: PetStateInfo;
  position: PetPosition;
  moveTarget: PetMoveTarget | null;
  isMoving: boolean;
  facingRight: boolean;
  animationFrame: number;
  showBubble: boolean;
  bubbleText: string;

  dispatch: (event: PetEvent) => void;
  setPosition: (pos: PetPosition) => void;
  setMoveTarget: (target: PetMoveTarget | null) => void;
  setIsMoving: (moving: boolean) => void;
  setFacingRight: (right: boolean) => void;
  advanceFrame: () => void;
  resetFrame: () => void;
  showSpeechBubble: (text: string, durationMs?: number) => void;
  hideBubble: () => void;
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
}));
