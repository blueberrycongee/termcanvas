import { create } from "zustand";

interface CardEntry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CARD_GAP = 12;

interface CardLayoutStore {
  cards: Record<string, CardEntry>;
  activeCardId: string | null;
  recentCardId: string | null;
  register: (id: string, entry: CardEntry) => void;
  unregister: (id: string) => void;
  setActiveCardId: (id: string | null) => void;
  setRecentCardId: (id: string | null) => void;
}

export const useCardLayoutStore = create<CardLayoutStore>((set) => ({
  cards: {},
  activeCardId: null,
  recentCardId: null,

  register: (id, entry) =>
    set((state) => ({ cards: { ...state.cards, [id]: entry } })),

  unregister: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.cards;
      return {
        cards: rest,
        activeCardId: state.activeCardId === id ? null : state.activeCardId,
        recentCardId: state.recentCardId === id ? null : state.recentCardId,
      };
    }),

  setActiveCardId: (id) => set({ activeCardId: id }),
  setRecentCardId: (id) => set({ recentCardId: id }),
}));

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function resolveAllCardPositions(
  cards: Record<string, CardEntry>,
  obstacles: Rect[] = [],
  options: { priorityIds?: string[] } = {},
): Record<string, { x: number; y: number }> {
  const priorityIds = Array.from(new Set(options.priorityIds ?? []));
  const prioritySet = new Set(priorityIds);
  const cardEntries = Object.entries(cards);
  const prioritizedEntries = priorityIds
    .map((id) => {
      const card = cards[id];
      return card ? ([id, card] as const) : null;
    })
    .filter((entry): entry is readonly [string, CardEntry] => entry !== null);
  const remainingEntries = cardEntries
    .filter(([id]) => !prioritySet.has(id))
    .sort(([, a], [, b]) => a.y - b.y);
  const entries = [...prioritizedEntries, ...remainingEntries];
  const resolvedCards: Rect[] = [];
  const result: Record<string, { x: number; y: number }> = {};

  for (const [id, card] of entries) {
    let x = card.x;
    let y = card.y;

    // Push right to avoid project containers
    for (const obs of obstacles) {
      if (
        x < obs.x + obs.w + CARD_GAP &&
        x + card.w > obs.x &&
        y < obs.y + obs.h &&
        y + card.h > obs.y
      ) {
        x = obs.x + obs.w + CARD_GAP;
      }
    }

    // Push down to avoid other cards
    for (const prev of resolvedCards) {
      if (x < prev.x + prev.w && x + card.w > prev.x) {
        if (y < prev.y + prev.h + CARD_GAP && y + card.h > prev.y - CARD_GAP) {
          y = prev.y + prev.h + CARD_GAP;
        }
      }
    }

    resolvedCards.push({ x, y, w: card.w, h: card.h });
    result[id] = { x, y };
  }

  return result;
}
