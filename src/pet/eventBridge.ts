import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useCompletionSeenStore } from "../stores/completionSeenStore";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { usePetStore } from "./petStore";
import type { PetEvent } from "./stateMachine";
import {
  getTerminalTitleBarTarget,
  getTerminalInsideTarget,
} from "./petMovement";
import type { TerminalData } from "../types";
import type {
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../../shared/telemetry";
import {
  PET_IDLE_TICK_MS,
  WORKFLOW_REFRESH_INTERVAL_MS,
} from "../../shared/lifecycleThresholds";
import {
  deriveAttentionFromTelemetryTransition,
  derivePetEventFromTelemetryTransition,
  derivePetEventFromWorkflowTransition,
  isTelemetryProgressing,
  samePetRelevantTelemetry,
  shouldClearAttentionFromTelemetryTransition,
} from "./eventMappings";

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

const PET_EVENT_PRIORITY: PetEvent["type"][] = [
  "DISPATCH_FAILED",
  "TASK_ERROR",
  "WORKER_STUCK",
  "STALL",
  "WORKFLOW_COMPLETED",
  "TASK_SUCCESS",
  "TURN_COMPLETE",
  "WORKFLOW_STARTED",
  "TOOL_RUNNING",
  "AGENT_THINKING",
  "TOOL_PENDING",
];

type RuntimeTerminalSnapshots = ReturnType<
  typeof useTerminalRuntimeStore.getState
>["terminals"];

interface WorkflowContext {
  key: string;
  workflowId: string;
  repoPath: string;
}

function dispatchHighestPriorityPetEvent(
  dispatch: (event: PetEvent) => void,
  events: PetEvent[],
) {
  if (events.length === 0) return;

  for (const type of PET_EVENT_PRIORITY) {
    const event = events.find((candidate) => candidate.type === type);
    if (event) {
      dispatch(event);
      return;
    }
  }
}

function movePetToTerminalTitleBar(
  terminalId: string,
  focusedId: string | null,
  setMoveTarget: (target: {
    x: number;
    y: number;
    terminalId?: string;
    onTitleBar?: boolean;
  } | null) => void,
) {
  const terminal = findTerminalById(terminalId);
  if (!terminal || terminal.stashed) return;

  setMoveTarget({
    ...getTerminalTitleBarTarget(terminal, terminalId === focusedId),
    terminalId: terminal.id,
  });
}

function findActiveTelemetryTerminalId(
  terminals: RuntimeTerminalSnapshots,
): string | null {
  for (const [terminalId, snapshot] of Object.entries(terminals)) {
    if (isTelemetryProgressing(snapshot.telemetry)) {
      return terminalId;
    }
  }
  return null;
}

function collectWorkflowContexts(
  terminals: RuntimeTerminalSnapshots,
): WorkflowContext[] {
  const contexts = new Map<string, WorkflowContext>();

  for (const snapshot of Object.values(terminals)) {
    const telemetry = snapshot.telemetry;
    if (!telemetry?.workflow_id || !telemetry.repo_path) continue;

    const key = `${telemetry.repo_path}::${telemetry.workflow_id}`;
    if (contexts.has(key)) continue;
    contexts.set(key, {
      key,
      workflowId: telemetry.workflow_id,
      repoPath: telemetry.repo_path,
    });
  }

  return [...contexts.values()];
}

function hasSeenCompletion(terminalId: string): boolean {
  return useCompletionSeenStore.getState().seenTerminalIds.has(terminalId);
}

function isCompletedTerminal(terminalId: string): boolean {
  const telemetry = useTerminalRuntimeStore.getState().terminals[terminalId]
    ?.telemetry;
  if (telemetry?.turn_state === "turn_complete") {
    return true;
  }

  const status = useTerminalRuntimeStateStore.getState().terminals[terminalId]
    ?.status;
  return status === "completed" || status === "success";
}

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
  const markCompletionSeen = useCompletionSeenStore((s) => s.markSeen);

  const prevTerminalCount = useRef(0);
  const prevStatuses = useRef<Record<string, string>>({});
  const prevTelemetry = useRef<Record<string, TerminalTelemetrySnapshot>>({});
  const prevWorkflowSnapshots = useRef<
    Record<string, WorkflowTelemetrySnapshot | null>
  >({});
  const workflowRequestSeq = useRef(0);
  const triggerWorkflowRefresh = useRef<(() => void) | null>(null);
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
            clearAttentionForTerminal(id);
            events.push({ type: "AGENT_THINKING" });
            break;
          case "waiting":
            events.push({ type: "TOOL_PENDING" });
            if (!isFocused) {
              enqueueAttention({
                terminalId: id,
                label,
                priority: "approval",
                message: `⏳ ${label}`,
              });
            }
            break;
          case "success":
          case "completed":
            events.push({ type: "TASK_SUCCESS" });
            if (isFocused) {
              markCompletionSeen(id);
            } else if (!hasSeenCompletion(id)) {
              enqueueAttention({
                terminalId: id,
                label,
                priority: "success",
                message: `✓ ${label}`,
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
                message: `✗ ${label}`,
              });
            }
            break;
        }

        prevStatuses.current[id] = newStatus;
      }

      dispatchHighestPriorityPetEvent(dispatch, events);

      // Move pet toward active terminal (only if no attention pending)
      const petState = usePetStore.getState();
      if (petState.currentAttention) {
        movePetToAttention();
      } else {
        const activeId = Object.entries(state.terminals).find(
          ([, rt]) => rt.status === "active" || rt.status === "running",
        )?.[0];

        if (activeId) {
          movePetToTerminalTitleBar(activeId, focusedId, setMoveTarget);
        }
      }
    });

    return unsub;
  }, [
    clearAttentionForTerminal,
    dispatch,
    enqueueAttention,
    markCompletionSeen,
    setMoveTarget,
  ]);

  // Track terminal telemetry changes → dispatch richer pet events
  useEffect(() => {
    const unsub = useTerminalRuntimeStore.subscribe((state) => {
      const events: PetEvent[] = [];
      const focusedId = getFocusedTerminalId();
      const nextTelemetry: Record<string, TerminalTelemetrySnapshot> = {};
      let workflowContextChanged = false;

      for (const [id, snapshot] of Object.entries(state.terminals)) {
        const telemetry = snapshot.telemetry;
        if (!telemetry) continue;

        nextTelemetry[id] = telemetry;
        const prev = prevTelemetry.current[id];
        if (samePetRelevantTelemetry(prev, telemetry)) continue;

        const isFocused = id === focusedId;
        const label = getTerminalLabel(id);
        const event = derivePetEventFromTelemetryTransition(prev, telemetry);
        const seenCompletion = hasSeenCompletion(id);
        const attention = deriveAttentionFromTelemetryTransition(prev, telemetry, {
          terminalId: id,
          label,
          focused: isFocused,
          seenCompletion,
        });

        if (isFocused && telemetry.turn_state === "turn_complete") {
          markCompletionSeen(id);
        }
        if (shouldClearAttentionFromTelemetryTransition(prev, telemetry)) {
          clearAttentionForTerminal(id);
        }
        if (attention) {
          enqueueAttention(attention);
        }
        if (event) {
          events.push(event);
        }
        if (
          prev?.workflow_id !== telemetry.workflow_id ||
          prev?.repo_path !== telemetry.repo_path
        ) {
          workflowContextChanged = true;
        }
      }

      prevTelemetry.current = nextTelemetry;
      dispatchHighestPriorityPetEvent(dispatch, events);

      const petState = usePetStore.getState();
      if (petState.currentAttention) {
        movePetToAttention();
      } else {
        const activeId = findActiveTelemetryTerminalId(state.terminals);
        if (activeId) {
          movePetToTerminalTitleBar(activeId, focusedId, setMoveTarget);
        }
      }

      if (workflowContextChanged) {
        triggerWorkflowRefresh.current?.();
      }
    });

    return unsub;
  }, [
    clearAttentionForTerminal,
    dispatch,
    enqueueAttention,
    markCompletionSeen,
    setMoveTarget,
  ]);

  // Track workflow telemetry → commanding / triumph / dispatch failure
  useEffect(() => {
    let disposed = false;

    const refreshWorkflowStates = () => {
      if (!window.termcanvas?.telemetry?.getWorkflow) return;

      const requestId = ++workflowRequestSeq.current;
      const contexts = collectWorkflowContexts(
        useTerminalRuntimeStore.getState().terminals,
      );

      if (contexts.length === 0) {
        prevWorkflowSnapshots.current = {};
        return;
      }

      void Promise.all(
        contexts.map(async (context) => ({
          key: context.key,
          snapshot: await window.termcanvas.telemetry
            .getWorkflow(context.workflowId, context.repoPath)
            .catch(() => null),
        })),
      ).then((results) => {
        if (disposed || workflowRequestSeq.current !== requestId) return;

        const events: PetEvent[] = [];
        const nextSnapshots: Record<string, WorkflowTelemetrySnapshot | null> =
          {};

        for (const { key, snapshot } of results) {
          if (!snapshot) continue;
          nextSnapshots[key] = snapshot;
          const prev = prevWorkflowSnapshots.current[key];
          const event = derivePetEventFromWorkflowTransition(prev, snapshot);
          if (event) {
            events.push(event);
          }
        }

        prevWorkflowSnapshots.current = nextSnapshots;
        dispatchHighestPriorityPetEvent(dispatch, events);
      });
    };

    triggerWorkflowRefresh.current = refreshWorkflowStates;
    refreshWorkflowStates();

    const interval = setInterval(
      refreshWorkflowStates,
      WORKFLOW_REFRESH_INTERVAL_MS,
    );
    return () => {
      disposed = true;
      triggerWorkflowRefresh.current = null;
      clearInterval(interval);
    };
  }, [dispatch]);

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
        if (focusedId && petState.currentAttention.priority === "success") {
          markCompletionSeen(focusedId);
        }
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

      if (focusedId && isCompletedTerminal(focusedId)) {
        markCompletionSeen(focusedId);
      }
    });

    return unsub;
  }, [setMoveTarget, acknowledgeAttention, markCompletionSeen]);

  // Idle timer — drives TIMER events for sleep transitions
  useEffect(() => {
    idleTimer.current = setInterval(() => {
      const info = usePetStore.getState().stateInfo;
      const elapsed = Date.now() - info.enteredAt;
      dispatch({ type: "TIMER", elapsed });
    }, PET_IDLE_TICK_MS);

    return () => {
      if (idleTimer.current) clearInterval(idleTimer.current);
    };
  }, [dispatch]);
}
