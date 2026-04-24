import { useEffect, useRef } from "react";
import { toggleClearFocus } from "./toggleClearFocus";
import { usePreferencesStore } from "../stores/preferencesStore";

const isMac =
  (typeof window !== "undefined" && window.termcanvas?.app.platform === "darwin") ||
  (typeof navigator !== "undefined" && navigator.platform?.startsWith("Mac"));

// Thresholds tuned for Magic Trackpad / MacBook trackpad wheel events.
// These are prototype values — adjust after real-world testing.
const SWIPE_MIN_DELTA_X = 80; // px accumulated horizontally
const SWIPE_MAX_DELTA_Y = 60; // px accumulated vertically (reject diagonal)
const SWIPE_MAX_DURATION = 500; // ms — quick flick, not a pan
const SWIPE_MIN_EVENTS = 2; // need at least 2 wheel events
const SWIPE_IDLE_TIMEOUT = 120; // ms between events to consider a new gesture
const SWIPE_CONSUME_IDLE_TIMEOUT = 300; // ms after last event to consider gesture ended

interface SwipeTracker {
  startTime: number;
  accumulatedX: number;
  accumulatedY: number;
  eventCount: number;
  lastEventTime: number;
  triggered: boolean;
}

function createSwipeDetector() {
  let tracker: SwipeTracker | null = null;
  let consumedLastEventTime = 0;

  return {
    handleWheel(event: WheelEvent): boolean {
      const now = Date.now();

      // If we previously triggered, keep "consuming" events from the same
      // gesture until an idle gap proves the gesture has ended.
      if (consumedLastEventTime > 0) {
        if (now - consumedLastEventTime <= SWIPE_CONSUME_IDLE_TIMEOUT) {
          // Same gesture still in progress — extend consumption window
          consumedLastEventTime = now;
          return false;
        }
        // Gesture has ended; reset and allow a new detection
        consumedLastEventTime = 0;
      }

      // Start a new sequence if idle for too long
      if (!tracker || now - tracker.lastEventTime > SWIPE_IDLE_TIMEOUT) {
        tracker = {
          startTime: now,
          accumulatedX: 0,
          accumulatedY: 0,
          eventCount: 0,
          lastEventTime: now,
          triggered: false,
        };
      }

      tracker.accumulatedX += Math.abs(event.deltaX);
      tracker.accumulatedY += Math.abs(event.deltaY);
      tracker.eventCount++;
      tracker.lastEventTime = now;

      const duration = now - tracker.startTime;

      // Reject if too much vertical drift (diagonal scroll)
      if (tracker.accumulatedY > SWIPE_MAX_DELTA_Y) {
        tracker = null;
        return false;
      }

      // Reject if the gesture drags on too long (it's a pan, not a flick)
      if (duration > SWIPE_MAX_DURATION) {
        tracker = null;
        return false;
      }

      // Trigger: enough horizontal distance, enough events, fast enough
      if (
        tracker.accumulatedX >= SWIPE_MIN_DELTA_X &&
        tracker.eventCount >= SWIPE_MIN_EVENTS &&
        duration <= SWIPE_MAX_DURATION
      ) {
        tracker.triggered = true;
        consumedLastEventTime = now;
        tracker = null;
        return true;
      }

      return false;
    },

    reset() {
      tracker = null;
      consumedLastEventTime = 0;
    },
  };
}

/**
 * Hook that attaches a trackpad swipe detector to the canvas container.
 * A quick two-finger horizontal swipe toggles clear-focus (cmd+e).
 *
 * Only active on macOS and only when the user has enabled
 * `trackpadSwipeFocusEnabled` in preferences (default: off).
 */
export function useTrackpadSwipeFocus(
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const detectorRef = useRef(createSwipeDetector());
  const enabled = usePreferencesStore((s) => s.trackpadSwipeFocusEnabled);

  useEffect(() => {
    if (!isMac || !enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const detector = detectorRef.current;

    const handler = (event: WheelEvent) => {
      // Only detect on plain horizontal scroll (no modifier keys)
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      // Only horizontal movement — ignore pure vertical scroll
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        return;
      }

      const triggered = detector.handleWheel(event);
      if (triggered) {
        console.log("[trackpadSwipe] triggered, calling toggleClearFocus");
        event.preventDefault();
        event.stopPropagation();
        toggleClearFocus();
      }
    };

    // Use capture to intercept before React Flow's panOnScroll handler
    container.addEventListener("wheel", handler, { passive: false, capture: true });

    return () => {
      container.removeEventListener("wheel", handler, { capture: true });
    };
  }, [containerRef, enabled]);
}
