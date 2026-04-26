import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import type { SpatialWaypoint, SpatialWaypointSlot } from "../types";

export const WAYPOINT_SLOTS: SpatialWaypointSlot[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];

export function isWaypointSlot(value: unknown): value is SpatialWaypointSlot {
  return (
    typeof value === "string" &&
    (WAYPOINT_SLOTS as string[]).includes(value)
  );
}

/**
 * Resolve which project owns the waypoint set right now. Prefers the
 * focused project; falls back to the only project when exactly one
 * exists so single-project workspaces work even when nothing is
 * focused. Returns null when there's no project at all or when the
 * choice is genuinely ambiguous (multiple projects, none focused).
 */
export function getActiveWaypointProjectId(): string | null {
  const { projects, focusedProjectId } = useProjectStore.getState();
  if (focusedProjectId) {
    return focusedProjectId;
  }
  if (projects.length === 1) {
    return projects[0].id;
  }
  return null;
}

export interface WaypointEventDetail {
  slot: SpatialWaypointSlot;
  projectId: string;
}

export const WAYPOINT_SAVED_EVENT = "termcanvas:waypoint-saved";
export const WAYPOINT_RECALLED_EVENT = "termcanvas:waypoint-recalled";
export const WAYPOINT_NOOP_EVENT = "termcanvas:waypoint-noop";

function emitWaypointEvent(
  type: typeof WAYPOINT_SAVED_EVENT | typeof WAYPOINT_RECALLED_EVENT,
  detail: WaypointEventDetail,
): void {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function emitNoop(slot: SpatialWaypointSlot, reason: "no_project" | "empty_slot"): void {
  window.dispatchEvent(
    new CustomEvent(WAYPOINT_NOOP_EVENT, { detail: { slot, reason } }),
  );
}

/**
 * --ease-out-soft from index.css is cubic-bezier(0.22, 1, 0.36, 1).
 * easeOutQuint matches the same "arrives confident, settles soft"
 * landing well within perception of a 320ms move — keeping the JS
 * curve close to the CSS token without writing a bezier solver.
 */
function easeOutSoft(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

export const WAYPOINT_FLY_DURATION_MS = 320;

export function saveWaypointToActiveProject(
  slot: SpatialWaypointSlot,
): boolean {
  const projectId = getActiveWaypointProjectId();
  if (!projectId) {
    emitNoop(slot, "no_project");
    return false;
  }

  const { viewport } = useCanvasStore.getState();
  const waypoint: SpatialWaypoint = {
    x: viewport.x,
    y: viewport.y,
    scale: viewport.scale,
    savedAt: Date.now(),
  };

  useProjectStore.getState().setWaypoint(projectId, slot, waypoint);
  emitWaypointEvent(WAYPOINT_SAVED_EVENT, { slot, projectId });
  return true;
}

export function recallWaypointFromActiveProject(
  slot: SpatialWaypointSlot,
): boolean {
  const projectId = getActiveWaypointProjectId();
  if (!projectId) {
    emitNoop(slot, "no_project");
    return false;
  }

  const project = useProjectStore
    .getState()
    .projects.find((p) => p.id === projectId);
  const waypoint = project?.waypoints?.[slot];
  if (!waypoint) {
    emitNoop(slot, "empty_slot");
    return false;
  }

  useCanvasStore
    .getState()
    .animateTo(waypoint.x, waypoint.y, waypoint.scale, {
      duration: WAYPOINT_FLY_DURATION_MS,
      easing: easeOutSoft,
    });
  emitWaypointEvent(WAYPOINT_RECALLED_EVENT, { slot, projectId });
  return true;
}
