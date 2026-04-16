import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import { usePetStore } from "./petStore";
import type { AttentionPriority } from "./petStore";
import type { PetEvent } from "./stateMachine";
import {
  getTerminalTitleBarTarget,
  getTerminalInsideTarget,
} from "./petMovement";
import type { TerminalData } from "../types";

// --- Helpers ---

function getTerminalLabel(terminalId: string): string {
  const { projects } = useProjectStore.getState();
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const terminal = worktree.terminals.find((t) => t.id === terminalId);
      if (terminal) return terminal.customTitle || terminal.title;
    }
  }
  return terminalId.slice(0, 6);
}

function getFocusedTerminalId(): string | null {
  const { projects, focusedProjectId, focusedWorktreeId } =
    useProjectStore.getState();
  if (!focusedProjectId || !focusedWorktreeId) return null;
  const project = projects.find((p) => p.id === focusedProjectId);
  if (!project) return null;
  const worktree = project.worktrees.find((w) => w.id === focusedWorktreeId);
  if (!worktree) return null;
  return worktree.terminals.find((t) => t.focused && !t.stashed)?.id ?? null;
}

function findTerminalById(terminalId: string): TerminalData | null {
  const { projects } = useProjectStore.getState();
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const terminal = worktree.terminals.find((t) => t.id === terminalId);
      if (terminal) return terminal;
    }
  }
  return null;
}

const ATTENTION_MESSAGES: Record<AttentionPriority, string> = {
  error: "✗",
  stuck: "⚠",
  approval: "⏳",
  success: "✓",
};

function movePetToAttention() {
  const { currentAttention } = usePetStore.getState();
  if (!currentAttention) return;

  const terminal = findTerminalById(currentAttention.terminalId);
  if (!terminal) return;

  // Attention: pet goes INSIDE the terminal to clearly mark which one needs focus
  usePetStore.getState().setMoveTarget({
    ...getTerminalInsideTarget(terminal),
    terminalId: currentAttention.terminalId,
  });
}

/**
 * Subscribes to terminal runtime state changes and project store changes
 * to drive pet state transitions and the attention queue.
 */
export function usePetEventBridge() {
  const dispatch = usePetStore((s) => s.dispatch);
  const setMoveTarget = usePetStore((s) => s.setMoveTarget);
  const showSpeechBubble = usePetStore((s) => s.showSpeechBubble);
  const enqueueAttention = usePetStore((s) => s.enqueueAttention);
  const acknowledgeAttention = usePetStore((s) => s.acknowledgeAttention);
  const clearAttentionForTerminal = usePetStore(
    (s) => s.clearAttentionForTerminal,
  );

  const prevTerminalCount = useRef(0);
  const prevStatuses = useRef<Record<string, string>>({});
  const idleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevFocusedId = useRef<string | null>(null);

  // Track terminal creation/destruction
  useEffect(() => {
    const unsub = useProjectStore.subscribe((state) => {
      let count = 0;
      for (const project of state.projects) {
        for (const worktree of project.worktrees) {
          count += worktree.terminals.filter((t) => !t.stashed).length;
        }
      }

      if (count > prevTerminalCount.current) {
        dispatch({ type: "TERMINAL_CREATED" });
        showSpeechBubble("!", 1500);

        // Move toward the newest terminal
        for (const project of state.projects) {
          for (const worktree of project.worktrees) {
            const terminals = worktree.terminals.filter((t) => !t.stashed);
            if (terminals.length > 0) {
              const newest = terminals[terminals.length - 1];
              setMoveTarget({
                ...getTerminalTitleBarTarget(newest),
                terminalId: newest.id,
              });
            }
          }
        }
      } else if (count < prevTerminalCount.current) {
        dispatch({ type: "TERMINAL_DESTROYED" });

        // Clean up attention for destroyed terminals
        const liveIds = new Set<string>();
        for (const project of state.projects) {
          for (const worktree of project.worktrees) {
            for (const terminal of worktree.terminals) {
              if (!terminal.stashed) liveIds.add(terminal.id);
            }
          }
        }
        const petState = usePetStore.getState();
        if (
          petState.currentAttention &&
          !liveIds.has(petState.currentAttention.terminalId)
        ) {
          clearAttentionForTerminal(petState.currentAttention.terminalId);
        }
        for (const item of petState.attentionQueue) {
          if (!liveIds.has(item.terminalId)) {
            clearAttentionForTerminal(item.terminalId);
          }
        }
      }

      prevTerminalCount.current = count;
    });

    return unsub;
  }, [
    dispatch,
    setMoveTarget,
    showSpeechBubble,
    clearAttentionForTerminal,
  ]);

  // Track terminal status changes → dispatch pet events + enqueue attention
  useEffect(() => {
    const unsub = useTerminalRuntimeStateStore.subscribe((state) => {
      const events: PetEvent[] = [];
      const focusedId = getFocusedTerminalId();

      for (const [id, runtime] of Object.entries(state.terminals)) {
        const prevStatus = prevStatuses.current[id];
        const newStatus = runtime.status;

        if (!newStatus || newStatus === prevStatus) continue;

        const label = getTerminalLabel(id);
        const isFocused = id === focusedId;

        switch (newStatus) {
          case "active":
          case "running":
            events.push({ type: "AGENT_THINKING" });
            break;
          case "waiting":
            events.push({ type: "TOOL_PENDING" });
            if (!isFocused) {
              enqueueAttention({
                terminalId: id,
                label,
                priority: "approval",
                message: `${ATTENTION_MESSAGES.approval} ${label}`,
              });
            }
            break;
          case "success":
          case "completed":
            events.push({ type: "TASK_SUCCESS" });
            if (!isFocused) {
              enqueueAttention({
                terminalId: id,
                label,
                priority: "success",
                message: `${ATTENTION_MESSAGES.success} ${label}`,
              });
            }
            break;
          case "error":
            events.push({ type: "TASK_ERROR" });
            if (!isFocused) {
              enqueueAttention({
                terminalId: id,
                label,
                priority: "error",
                message: `${ATTENTION_MESSAGES.error} ${label}`,
              });
            }
            break;
        }

        prevStatuses.current[id] = newStatus;
      }

      // Dispatch only the highest-priority pet event
      if (events.length > 0) {
        const priority: PetEvent["type"][] = [
          "TASK_ERROR",
          "TASK_SUCCESS",
          "AGENT_THINKING",
          "TOOL_PENDING",
        ];
        for (const p of priority) {
          const ev = events.find((e) => e.type === p);
          if (ev) {
            dispatch(ev);
            break;
          }
        }
      }

      // Move pet toward active terminal (only if no attention pending)
      const petState = usePetStore.getState();
      if (petState.currentAttention) {
        movePetToAttention();
      } else {
        const activeId = Object.entries(state.terminals).find(
          ([, rt]) => rt.status === "active" || rt.status === "running",
        )?.[0];

        if (activeId) {
          const terminal = findTerminalById(activeId);
          if (terminal && !terminal.stashed) {
            const isTargetFocused = activeId === focusedId;
            setMoveTarget({
              ...getTerminalTitleBarTarget(terminal, isTargetFocused),
              terminalId: terminal.id,
            });
          }
        }
      }
    });

    return unsub;
  }, [dispatch, setMoveTarget, enqueueAttention]);

  // Track user focus changes → auto-acknowledge attention + smart positioning
  useEffect(() => {
    const unsub = useProjectStore.subscribe(() => {
      const focusedId = getFocusedTerminalId();
      if (focusedId === prevFocusedId.current) return;
      prevFocusedId.current = focusedId;

      const petState = usePetStore.getState();

      // Auto-acknowledge: user focused the terminal that has current attention
      if (
        petState.currentAttention &&
        focusedId === petState.currentAttention.terminalId
      ) {
        acknowledgeAttention();

        // After acknowledging, drive pet to next attention terminal or run away
        const nextState = usePetStore.getState();
        if (nextState.currentAttention) {
          movePetToAttention();
        } else {
          // Queue empty — pet runs away from the terminal, back to idle
          setMoveTarget(null);
        }
        return;
      }
    });

    return unsub;
  }, [setMoveTarget, acknowledgeAttention]);

  // Idle timer — drives TIMER events for sleep transitions
  useEffect(() => {
    idleTimer.current = setInterval(() => {
      const info = usePetStore.getState().stateInfo;
      const elapsed = Date.now() - info.enteredAt;
      dispatch({ type: "TIMER", elapsed });
    }, 1000);

    return () => {
      if (idleTimer.current) clearInterval(idleTimer.current);
    };
  }, [dispatch]);
}
