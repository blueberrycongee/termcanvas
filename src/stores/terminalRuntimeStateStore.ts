import { create } from "zustand";
import type { TerminalData, TerminalStatus } from "../types";

export interface ResolvedTerminalRuntimeState {
  ptyId: number | null;
  status: TerminalStatus;
  sessionId: string | undefined;
}

export type TerminalRuntimeStatePatch = Partial<ResolvedTerminalRuntimeState>;
export type TerminalRuntimeStateMap = Record<string, TerminalRuntimeStatePatch>;

interface TerminalRuntimeStateStore {
  terminals: TerminalRuntimeStateMap;
  setPtyId: (terminalId: string, ptyId: number | null) => void;
  setStatus: (terminalId: string, status: TerminalStatus) => void;
  setSessionId: (terminalId: string, sessionId: string | undefined) => void;
  clearTerminal: (terminalId: string) => void;
  reset: () => void;
}

function hasOwnRuntimeValue(
  runtimeState: TerminalRuntimeStatePatch | undefined,
  key: keyof ResolvedTerminalRuntimeState,
): boolean {
  return !!runtimeState && Object.prototype.hasOwnProperty.call(runtimeState, key);
}

function resolveRuntimeValue<K extends keyof ResolvedTerminalRuntimeState>(
  runtimeState: TerminalRuntimeStatePatch | undefined,
  key: K,
  fallback: ResolvedTerminalRuntimeState[K],
): ResolvedTerminalRuntimeState[K] {
  return hasOwnRuntimeValue(runtimeState, key)
    ? (runtimeState![key] as ResolvedTerminalRuntimeState[K])
    : fallback;
}

function updateRuntimePatch(
  terminals: TerminalRuntimeStateMap,
  terminalId: string,
  patch: TerminalRuntimeStatePatch,
): TerminalRuntimeStateMap {
  return {
    ...terminals,
    [terminalId]: {
      ...(terminals[terminalId] ?? {}),
      ...patch,
    },
  };
}

export const useTerminalRuntimeStateStore = create<TerminalRuntimeStateStore>(
  (set) => ({
    terminals: {},
    setPtyId: (terminalId, ptyId) =>
      set((state) => {
        const current = state.terminals[terminalId];
        if (current?.ptyId === ptyId && hasOwnRuntimeValue(current, "ptyId")) {
          return state;
        }

        return {
          terminals: updateRuntimePatch(state.terminals, terminalId, { ptyId }),
        };
      }),
    setStatus: (terminalId, status) =>
      set((state) => {
        const current = state.terminals[terminalId];
        if (current?.status === status && hasOwnRuntimeValue(current, "status")) {
          return state;
        }

        return {
          terminals: updateRuntimePatch(state.terminals, terminalId, { status }),
        };
      }),
    setSessionId: (terminalId, sessionId) =>
      set((state) => {
        const current = state.terminals[terminalId];
        if (
          current?.sessionId === sessionId &&
          hasOwnRuntimeValue(current, "sessionId")
        ) {
          return state;
        }

        return {
          terminals: updateRuntimePatch(state.terminals, terminalId, {
            sessionId,
          }),
        };
      }),
    clearTerminal: (terminalId) =>
      set((state) => {
        if (!(terminalId in state.terminals)) {
          return state;
        }

        const next = { ...state.terminals };
        delete next[terminalId];
        return { terminals: next };
      }),
    reset: () =>
      set((state) =>
        Object.keys(state.terminals).length === 0
          ? state
          : { terminals: {} },
      ),
  }),
);

type RuntimeBackedTerminal = Pick<
  TerminalData,
  "id" | "ptyId" | "status" | "sessionId"
>;

export function resolveTerminalRuntimeState(
  terminal: RuntimeBackedTerminal,
  runtimeState: TerminalRuntimeStatePatch | undefined =
    useTerminalRuntimeStateStore.getState().terminals[terminal.id],
): ResolvedTerminalRuntimeState {
  return {
    ptyId: resolveRuntimeValue(runtimeState, "ptyId", terminal.ptyId),
    status: resolveRuntimeValue(runtimeState, "status", terminal.status),
    sessionId: resolveRuntimeValue(runtimeState, "sessionId", terminal.sessionId),
  };
}

export function resolveTerminalWithRuntimeState<T extends RuntimeBackedTerminal>(
  terminal: T,
  runtimeState: TerminalRuntimeStatePatch | undefined =
    useTerminalRuntimeStateStore.getState().terminals[terminal.id],
): T {
  return {
    ...terminal,
    ...resolveTerminalRuntimeState(terminal, runtimeState),
  };
}

export function useResolvedTerminalRuntimeState(
  terminal: RuntimeBackedTerminal,
): ResolvedTerminalRuntimeState {
  const ptyId = useTerminalRuntimeStateStore((state) =>
    resolveRuntimeValue(state.terminals[terminal.id], "ptyId", terminal.ptyId),
  );
  const status = useTerminalRuntimeStateStore((state) =>
    resolveRuntimeValue(state.terminals[terminal.id], "status", terminal.status),
  );
  const sessionId = useTerminalRuntimeStateStore((state) =>
    resolveRuntimeValue(
      state.terminals[terminal.id],
      "sessionId",
      terminal.sessionId,
    ),
  );

  return { ptyId, status, sessionId };
}
