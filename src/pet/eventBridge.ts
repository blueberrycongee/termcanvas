import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import { usePetStore } from "./petStore";
import type { PetEvent } from "./stateMachine";
import { getTerminalTitleBarTarget } from "./petMovement";

/**
 * Subscribes to terminal runtime state changes and project store changes
 * to drive pet state transitions.
 */
export function usePetEventBridge() {
  const dispatch = usePetStore((s) => s.dispatch);
  const setMoveTarget = usePetStore((s) => s.setMoveTarget);
  const showSpeechBubble = usePetStore((s) => s.showSpeechBubble);

  const prevTerminalCount = useRef(0);
  const prevStatuses = useRef<Record<string, string>>({});
  const idleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
      }

      prevTerminalCount.current = count;
    });

    return unsub;
  }, [dispatch, setMoveTarget, showSpeechBubble]);

  // Track terminal status changes
  useEffect(() => {
    const unsub = useTerminalRuntimeStateStore.subscribe((state) => {
      const events: PetEvent[] = [];

      for (const [id, runtime] of Object.entries(state.terminals)) {
        const prevStatus = prevStatuses.current[id];
        const newStatus = runtime.status;

        if (!newStatus || newStatus === prevStatus) continue;

        switch (newStatus) {
          case "active":
          case "running":
            events.push({ type: "AGENT_THINKING" });
            break;
          case "waiting":
            events.push({ type: "TOOL_PENDING" });
            break;
          case "success":
          case "completed":
            events.push({ type: "TASK_SUCCESS" });
            break;
          case "error":
            events.push({ type: "TASK_ERROR" });
            break;
        }

        prevStatuses.current[id] = newStatus;
      }

      // Dispatch only the highest-priority event
      if (events.length > 0) {
        // Priority: error > success > thinking > pending
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

      // Move toward active terminal
      const activeId = Object.entries(state.terminals).find(
        ([, rt]) => rt.status === "active" || rt.status === "running",
      )?.[0];

      if (activeId) {
        const projects = useProjectStore.getState().projects;
        for (const project of projects) {
          for (const worktree of project.worktrees) {
            const terminal = worktree.terminals.find((t) => t.id === activeId);
            if (terminal && !terminal.stashed) {
              setMoveTarget({
                ...getTerminalTitleBarTarget(terminal),
                terminalId: terminal.id,
              });
              break;
            }
          }
        }
      }
    });

    return unsub;
  }, [dispatch, setMoveTarget]);

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
