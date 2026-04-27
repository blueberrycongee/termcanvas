import { create } from "zustand";
import type { Pin, CreatePinInput, UpdatePinInput } from "../types";

interface TerminalPinAssignment {
  pinId: string;
  repo: string;
  title: string;
}

interface PinStoreState {
  pinsByProject: Record<string, Pin[]>;
  openProjectPath: string | null;
  openDetailPinId: string | null;
  // Set when the detail drawer should render an unsaved new-pin form for
  // the given project. Mutually exclusive with openDetailPinId — the drawer
  // is either showing an existing pin or composing a new one.
  composingForPin: string | null;
  // Map terminalId → the pin it was last dispatched with. Renderer-only;
  // does not persist across reloads. Single pin per terminal — replacing on
  // re-drop is the explicit contract.
  terminalPinMap: Record<string, TerminalPinAssignment>;
  // Session-scoped filter: when false, the drawer hides done/dropped pins.
  // Single global flag, not per-project.
  showCompleted: boolean;
}

interface PinStoreActions {
  setPins: (projectPath: string, pins: Pin[]) => void;
  upsertPin: (projectPath: string, pin: Pin) => void;
  removePin: (projectPath: string, id: string) => void;
  openDrawer: (projectPath: string) => void;
  closeDrawer: () => void;
  toggle: (projectPath: string) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  startCompose: (projectPath: string) => void;
  cancelCompose: () => void;
  assignPinToTerminal: (
    terminalId: string,
    pin: Pick<Pin, "id" | "repo" | "title">,
  ) => void;
  clearTerminalAssignment: (terminalId: string) => void;
  setShowCompleted: (v: boolean) => void;
  toggleShowCompleted: () => void;
}

export const usePinStore = create<PinStoreState & PinStoreActions>(
  (set, get) => ({
    pinsByProject: {},
    openProjectPath: null,
    openDetailPinId: null,
    composingForPin: null,
    terminalPinMap: {},
    showCompleted: false,

    setPins: (projectPath, pins) =>
      set((state) => ({
        pinsByProject: { ...state.pinsByProject, [projectPath]: pins },
      })),

    upsertPin: (projectPath, pin) =>
      set((state) => {
        const existing = state.pinsByProject[projectPath] ?? [];
        const idx = existing.findIndex((t) => t.id === pin.id);
        const next =
          idx >= 0
            ? [...existing.slice(0, idx), pin, ...existing.slice(idx + 1)]
            : [pin, ...existing];
        // If any terminal is associated with this pin, refresh its cached
        // title so renames flow through to the badge without a stale label.
        let nextTerminalMap = state.terminalPinMap;
        for (const [terminalId, entry] of Object.entries(
          state.terminalPinMap,
        )) {
          if (entry.pinId === pin.id && entry.title !== pin.title) {
            if (nextTerminalMap === state.terminalPinMap) {
              nextTerminalMap = { ...state.terminalPinMap };
            }
            nextTerminalMap[terminalId] = { ...entry, title: pin.title };
          }
        }
        return {
          pinsByProject: { ...state.pinsByProject, [projectPath]: next },
          terminalPinMap: nextTerminalMap,
        };
      }),

    removePin: (projectPath, id) =>
      set((state) => {
        const existing = state.pinsByProject[projectPath];
        if (!existing) return state;
        // Drop any terminal associations pointing at this pin so the badge
        // disappears in lockstep with the pin itself.
        let nextTerminalMap = state.terminalPinMap;
        for (const [terminalId, entry] of Object.entries(
          state.terminalPinMap,
        )) {
          if (entry.pinId === id) {
            if (nextTerminalMap === state.terminalPinMap) {
              nextTerminalMap = { ...state.terminalPinMap };
            }
            delete nextTerminalMap[terminalId];
          }
        }
        return {
          pinsByProject: {
            ...state.pinsByProject,
            [projectPath]: existing.filter((t) => t.id !== id),
          },
          openDetailPinId:
            state.openDetailPinId === id ? null : state.openDetailPinId,
          terminalPinMap: nextTerminalMap,
        };
      }),

    openDrawer: (projectPath) => {
      if (!get().pinsByProject[projectPath]) {
        window.termcanvas.pins
          .list(projectPath)
          .then((pins) => {
            get().setPins(projectPath, pins);
          })
          .catch((err) => {
            console.error(
              "[pinStore] failed to load pins for",
              projectPath,
              err,
            );
          });
      }
      set({ openProjectPath: projectPath });
    },

    closeDrawer: () =>
      set({
        openProjectPath: null,
        openDetailPinId: null,
        composingForPin: null,
      }),

    openDetail: (id) => set({ openDetailPinId: id, composingForPin: null }),

    closeDetail: () => set({ openDetailPinId: null, composingForPin: null }),

    startCompose: (projectPath) =>
      set({ composingForPin: projectPath, openDetailPinId: null }),

    cancelCompose: () => set({ composingForPin: null }),

    toggle: (projectPath) => {
      const { openProjectPath, openDrawer } = get();
      if (openProjectPath === projectPath) {
        set({ openProjectPath: null });
      } else {
        openDrawer(projectPath);
      }
    },

    assignPinToTerminal: (terminalId, pin) =>
      set((state) => ({
        terminalPinMap: {
          ...state.terminalPinMap,
          [terminalId]: {
            pinId: pin.id,
            repo: pin.repo,
            title: pin.title,
          },
        },
      })),

    clearTerminalAssignment: (terminalId) =>
      set((state) => {
        if (!(terminalId in state.terminalPinMap)) return state;
        const next = { ...state.terminalPinMap };
        delete next[terminalId];
        return { terminalPinMap: next };
      }),

    setShowCompleted: (v) => set({ showCompleted: v }),

    toggleShowCompleted: () =>
      set((state) => ({ showCompleted: !state.showCompleted })),
  }),
);

export type { Pin, CreatePinInput, UpdatePinInput };
