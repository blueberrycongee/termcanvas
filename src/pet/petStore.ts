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

  // Grab / throw interaction.
  // `isGrabbed` — user holds mouse down on the pet and is moving it
  //   manually. All auto-movement (idle wander, attention chases, etc.)
  //   pauses; position tracks the cursor 1:1.
  // `isThrown` — user just released while moving. The pet flies with
  //   the release-time velocity, friction decays it, and on stop we
  //   emit a dust puff and hand control back to the normal loop.
  // `velocity` — device-pixel-per-second throw velocity, consumed by
  //   the throw-physics tick in PetOverlay. In world space
  //   (`position` units), not screen space — scaled through
  //   viewport.scale in the grab handler.
  // `rotation` — radians, visual-only. Used for the tumbling
  //   effect while airborne and a small tilt while grabbed.
  isGrabbed: boolean;
  isThrown: boolean;
  velocity: { vx: number; vy: number };
  rotation: number;

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

  grabPet: () => void;
  dragPetTo: (pos: PetPosition) => void;
  releasePet: (vx: number, vy: number) => void;
  tickThrow: (dtMs: number) => void;
  landThrow: () => void;
  setRotation: (radians: number) => void;
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
  isGrabbed: false,
  isThrown: false,
  velocity: { vx: 0, vy: 0 },
  rotation: 0,

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

  grabPet: () =>
    set({
      isGrabbed: true,
      isThrown: false,
      // Cancel whatever auto-target the pet was headed toward so the
      // render loop doesn't keep stepping toward it while the user is
      // holding the pet.
      moveTarget: null,
      isMoving: false,
      velocity: { vx: 0, vy: 0 },
      rotation: 0.15, // small tilt while held — reads as "picked up"
    }),

  dragPetTo: (pos) => set({ position: pos }),

  releasePet: (vx, vy) =>
    set({
      isGrabbed: false,
      isThrown: true,
      velocity: { vx, vy },
      rotation: 0,
    }),

  tickThrow: (dtMs) => {
    const dtSec = dtMs / 1000;
    // Kinetic-friction model: velocity decays exponentially (a per-
    // second decay factor of ~0.18, i.e. ≈82% of velocity lost every
    // second). No gravity on purpose — the pet slides across the
    // canvas rather than falling off the bottom.
    const friction = Math.exp(-1.7 * dtSec);
    set((s) => ({
      position: {
        x: s.position.x + s.velocity.vx * dtSec,
        y: s.position.y + s.velocity.vy * dtSec,
      },
      velocity: {
        vx: s.velocity.vx * friction,
        vy: s.velocity.vy * friction,
      },
      // Spin proportional to horizontal speed so a hard fling spins
      // faster than a soft toss.
      rotation: s.rotation + s.velocity.vx * dtSec * 0.015,
      // Facing follows velocity direction for mid-flight animation
      // continuity.
      facingRight: s.velocity.vx >= 0 ? true : s.velocity.vx < 0 ? false : s.facingRight,
    }));
  },

  landThrow: () =>
    // Reset the whole grab/throw cluster. Called in three places:
    //   - throw physics has settled to rest (natural landing)
    //   - pointerUp after a no-drag press (click treated as non-grab)
    //   - release velocity too small to warrant a throw (gentle drop)
    // In all three we want the pet back in the "normal loop" state
    // with no residual tilt or selection.
    set({
      isGrabbed: false,
      isThrown: false,
      velocity: { vx: 0, vy: 0 },
      rotation: 0,
    }),

  setRotation: (radians) => set({ rotation: radians }),
}));
