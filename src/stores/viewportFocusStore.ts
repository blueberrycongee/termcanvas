import { create } from "zustand";

/**
 * Tracks viewport focus mode for the focused terminal.
 *
 * - `null` → zoom-focus mode: the focused terminal is centered at fit-scale,
 *   so navigation/resize events should re-fit it to the viewport.
 * - `<terminalId>` → panned focus mode: the user has zoomed out (or otherwise
 *   broken away from fit-scale) while still keeping a terminal focused.
 *   Subsequent navigation/resize should preserve the current scale instead of
 *   forcing a re-zoom. The stored id is the terminal that was focused at the
 *   moment we left zoom-focus, used by the cmd+escape toggle to round-trip.
 */
interface ViewportFocusStore {
  zoomedOutTerminalId: string | null;
  setZoomedOutTerminalId: (terminalId: string | null) => void;
  fitAllScale: number | null;
  setFitAllScale: (scale: number) => void;
}

export const useViewportFocusStore = create<ViewportFocusStore>((set) => ({
  zoomedOutTerminalId: null,
  setZoomedOutTerminalId: (terminalId) =>
    set({ zoomedOutTerminalId: terminalId }),
  fitAllScale: null,
  setFitAllScale: (scale) => set({ fitAllScale: scale }),
}));
