import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { useProjectStore } from "../stores/projectStore";
import { useT } from "../i18n/useT";
import { getCanvasLeftInset, getCanvasRightInset } from "./viewportBounds";
import {
  WAYPOINT_NOOP_EVENT,
  WAYPOINT_RECALLED_EVENT,
  WAYPOINT_SAVED_EVENT,
  WAYPOINT_SLOTS,
  type WaypointEventDetail,
} from "../actions/spatialWaypointActions";
import type { SpatialWaypointSlot } from "../types";

const DOT_DIAMETER = 6;
const DOT_GAP = 14;
const STRIP_BOTTOM_OFFSET = 28;

// Save flash: short, declarative — "I just landed in slot N".
const SAVE_FLASH_MS = 700;
// Recall highlight lingers a bit longer so the user can register
// "I'm at waypoint 3 now" before the dot relaxes back to a normal
// filled state.
const RECALL_HIGHLIGHT_MS = 1200;
// Empty-slot rejection feedback: brief outline pulse on the dot
// the user pressed against, just enough to communicate "nothing
// here yet" without being loud.
const EMPTY_REJECT_MS = 600;

interface NoopEventDetail {
  slot: SpatialWaypointSlot;
  reason: "no_project" | "empty_slot";
}

const PLATFORM = (typeof window !== "undefined" && window.termcanvas?.app.platform) || "darwin";
const SAVE_COMBO_LABEL = PLATFORM === "darwin" ? "⌘⇧" : "Ctrl+Shift+";
const RECALL_COMBO_LABEL = PLATFORM === "darwin" ? "⌥" : "Alt+";

function dotState({
  filled,
  flashing,
  recalled,
  rejecting,
}: {
  filled: boolean;
  flashing: boolean;
  recalled: boolean;
  rejecting: boolean;
}) {
  if (recalled) {
    return {
      background: "var(--accent)",
      borderColor: "transparent",
      opacity: 1,
      boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)",
      transform: "scale(1.15)",
    };
  }
  if (flashing) {
    return {
      background: "var(--accent)",
      borderColor: "transparent",
      opacity: 1,
      boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 28%, transparent)",
      transform: "scale(1.25)",
    };
  }
  if (filled) {
    return {
      background: "var(--text-secondary)",
      borderColor: "transparent",
      opacity: 0.55,
      boxShadow: "none",
      transform: "scale(1)",
    };
  }
  if (rejecting) {
    return {
      background: "transparent",
      borderColor: "var(--text-muted)",
      opacity: 0.65,
      boxShadow: "none",
      transform: "scale(1.1)",
    };
  }
  return {
    background: "transparent",
    borderColor: "var(--text-faint)",
    opacity: 0.4,
    boxShadow: "none",
    transform: "scale(1)",
  };
}

export function SpatialWaypointsLayer() {
  const t = useT();
  const projects = useProjectStore((s) => s.projects);
  const focusedProjectId = useProjectStore((s) => s.focusedProjectId);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const pinDrawerOpen = usePinStore((s) => s.openProjectPath !== null);

  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  const [savedFlashSlot, setSavedFlashSlot] =
    useState<SpatialWaypointSlot | null>(null);
  const [recalledSlot, setRecalledSlot] =
    useState<SpatialWaypointSlot | null>(null);
  const [rejectingSlot, setRejectingSlot] =
    useState<SpatialWaypointSlot | null>(null);
  const [hoveredSlot, setHoveredSlot] =
    useState<SpatialWaypointSlot | null>(null);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let savedTimer: ReturnType<typeof setTimeout> | null = null;
    let recalledTimer: ReturnType<typeof setTimeout> | null = null;
    let rejectTimer: ReturnType<typeof setTimeout> | null = null;

    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<WaypointEventDetail>).detail;
      if (!detail) return;
      setSavedFlashSlot(detail.slot);
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => setSavedFlashSlot(null), SAVE_FLASH_MS);
    };

    const onRecalled = (event: Event) => {
      const detail = (event as CustomEvent<WaypointEventDetail>).detail;
      if (!detail) return;
      setRecalledSlot(detail.slot);
      if (recalledTimer) clearTimeout(recalledTimer);
      recalledTimer = setTimeout(
        () => setRecalledSlot(null),
        RECALL_HIGHLIGHT_MS,
      );
    };

    const onNoop = (event: Event) => {
      const detail = (event as CustomEvent<NoopEventDetail>).detail;
      if (!detail || detail.reason !== "empty_slot") return;
      setRejectingSlot(detail.slot);
      if (rejectTimer) clearTimeout(rejectTimer);
      rejectTimer = setTimeout(() => setRejectingSlot(null), EMPTY_REJECT_MS);
    };

    window.addEventListener(WAYPOINT_SAVED_EVENT, onSaved);
    window.addEventListener(WAYPOINT_RECALLED_EVENT, onRecalled);
    window.addEventListener(WAYPOINT_NOOP_EVENT, onNoop);
    return () => {
      window.removeEventListener(WAYPOINT_SAVED_EVENT, onSaved);
      window.removeEventListener(WAYPOINT_RECALLED_EVENT, onRecalled);
      window.removeEventListener(WAYPOINT_NOOP_EVENT, onNoop);
      if (savedTimer) clearTimeout(savedTimer);
      if (recalledTimer) clearTimeout(recalledTimer);
      if (rejectTimer) clearTimeout(rejectTimer);
    };
  }, []);

  // Active project: prefer the focused one; if exactly one project
  // exists, use it (single-project workspaces stay usable even when
  // nothing is focused). Mirrors getActiveWaypointProjectId in the
  // action module.
  const activeProject = useMemo(() => {
    if (focusedProjectId) {
      return projects.find((p) => p.id === focusedProjectId) ?? null;
    }
    if (projects.length === 1) return projects[0];
    return null;
  }, [projects, focusedProjectId]);

  const waypoints = activeProject?.waypoints ?? {};
  const hasAnyWaypoint = useMemo(
    () => WAYPOINT_SLOTS.some((slot) => !!waypoints[slot]),
    [waypoints],
  );

  if (!activeProject || projects.length === 0) {
    return null;
  }

  const leftInset = getCanvasLeftInset(
    leftPanelCollapsed,
    leftPanelWidth,
    pinDrawerOpen,
  );
  const rightInset = getCanvasRightInset(
    rightPanelCollapsed,
    rightPanelWidth,
  );
  const stripWidth =
    WAYPOINT_SLOTS.length * DOT_DIAMETER +
    (WAYPOINT_SLOTS.length - 1) * DOT_GAP;
  const canvasMid = leftInset + (windowWidth - leftInset - rightInset) / 2;
  const stripLeft = Math.round(canvasMid - stripWidth / 2);

  // Whole row dimms further when no slots are saved — empty state
  // shouldn't draw the eye. Once even one waypoint exists, the row
  // surfaces a touch more so the user knows their map is active.
  const containerOpacity = hasAnyWaypoint ? 1 : 0.55;

  return createPortal(
    <div
      className="fixed pointer-events-none select-none"
      style={{
        bottom: STRIP_BOTTOM_OFFSET,
        left: stripLeft,
        width: stripWidth,
        zIndex: 30,
        opacity: containerOpacity,
        transition:
          "opacity var(--duration-natural) var(--ease-out-soft)",
      }}
      aria-hidden="true"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: DOT_GAP,
          height: DOT_DIAMETER,
          position: "relative",
        }}
      >
        {WAYPOINT_SLOTS.map((slot) => {
          const filled = !!waypoints[slot];
          const flashing = savedFlashSlot === slot;
          const recalled = recalledSlot === slot;
          const rejecting = rejectingSlot === slot;
          const hovered = hoveredSlot === slot;
          const visual = dotState({ filled, flashing, recalled, rejecting });
          return (
            <div
              key={slot}
              className="pointer-events-auto"
              style={{
                width: DOT_DIAMETER,
                height: DOT_DIAMETER,
                borderRadius: "50%",
                background: visual.background,
                border: `1px solid ${visual.borderColor}`,
                opacity: visual.opacity,
                boxShadow: visual.boxShadow,
                transform: visual.transform,
                transition:
                  "transform var(--duration-natural) var(--ease-out-soft), " +
                  "background-color var(--duration-natural) var(--ease-out-soft), " +
                  "opacity var(--duration-natural) var(--ease-out-soft), " +
                  "box-shadow var(--duration-natural) var(--ease-out-soft)",
              }}
              onMouseEnter={() => setHoveredSlot(slot)}
              onMouseLeave={() =>
                setHoveredSlot((prev) => (prev === slot ? null : prev))
              }
            />
          );
        })}

        {hoveredSlot && (
          <div
            className="tc-eyebrow absolute"
            style={{
              bottom: DOT_DIAMETER + 10,
              left:
                WAYPOINT_SLOTS.indexOf(hoveredSlot) * (DOT_DIAMETER + DOT_GAP) +
                DOT_DIAMETER / 2,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
              padding: "3px 7px",
              borderRadius: 4,
              background:
                "color-mix(in srgb, var(--surface) 85%, transparent)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              color: "var(--text-secondary)",
              animation:
                "tc-fade-in var(--duration-natural) var(--ease-out-soft) both",
              pointerEvents: "none",
            }}
          >
            {waypoints[hoveredSlot]
              ? t["waypoint.tooltip.recall"](hoveredSlot, RECALL_COMBO_LABEL)
              : t["waypoint.tooltip.save"](hoveredSlot, SAVE_COMBO_LABEL)}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
