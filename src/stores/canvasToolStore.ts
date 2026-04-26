import { create } from "zustand";

export type CanvasTool = "select" | "hand";

interface CanvasToolStore {
  tool: CanvasTool;
  /**
   * True while the user is holding Space to temporarily pan. The active
   * tool stays "select" — only the cursor and pan behavior shift, so
   * releasing Space restores the previous mode without further state.
   */
  spaceHeld: boolean;
  setTool: (tool: CanvasTool) => void;
  setSpaceHeld: (held: boolean) => void;
}

export const useCanvasToolStore = create<CanvasToolStore>((set) => ({
  tool: "select",
  spaceHeld: false,
  setTool: (tool) => set({ tool }),
  setSpaceHeld: (held) => set({ spaceHeld: held }),
}));

export function isPanModeActive(state = useCanvasToolStore.getState()): boolean {
  return state.tool === "hand" || state.spaceHeld;
}
