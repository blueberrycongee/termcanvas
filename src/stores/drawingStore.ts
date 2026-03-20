import { create } from "zustand";
import { useWorkspaceStore } from "./workspaceStore";

export type DrawingTool = "select" | "pen" | "text" | "rect" | "arrow";

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface DrawingStroke {
  id: string;
  type: "pen";
  points: StrokePoint[];
  color: string;
  size: number;
}

export interface DrawingText {
  id: string;
  type: "text";
  x: number;
  y: number;
  content: string;
  color: string;
  fontSize: number;
}

export interface DrawingRect {
  id: string;
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
}

export interface DrawingArrow {
  id: string;
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
}

export type DrawingElement =
  | DrawingStroke
  | DrawingText
  | DrawingRect
  | DrawingArrow;

interface DrawingStore {
  tool: DrawingTool;
  color: string;
  elements: DrawingElement[];
  activeElement: DrawingElement | null;

  setTool: (tool: DrawingTool) => void;
  setColor: (color: string) => void;
  addElement: (element: DrawingElement) => void;
  updateElement: (id: string, partial: Partial<DrawingElement>) => void;
  removeElement: (id: string) => void;
  setActiveElement: (element: DrawingElement | null) => void;
  clearAll: () => void;
}

let idCounter = 0;
export function drawingId(): string {
  return `d-${Date.now()}-${++idCounter}`;
}

function markDirty() {
  useWorkspaceStore.getState().markDirty();
}

export const useDrawingStore = create<DrawingStore>((set) => ({
  tool: "select",
  color: "#ededed",
  elements: [],
  activeElement: null,

  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),

  addElement: (element) => {
    set((state) => ({
      elements: [...state.elements, element],
      activeElement: null,
    }));
    markDirty();
  },

  updateElement: (id, partial) => {
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id !== id ? el : ({ ...el, ...partial } as DrawingElement),
      ),
    }));
    markDirty();
  },

  removeElement: (id) => {
    set((state) => ({
      elements: state.elements.filter((el) => el.id !== id),
    }));
    markDirty();
  },

  setActiveElement: (element) => set({ activeElement: element }),
  clearAll: () => {
    set({ elements: [], activeElement: null });
    markDirty();
  },
}));
