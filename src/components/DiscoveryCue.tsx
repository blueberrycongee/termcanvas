import type { ReactNode } from "react";
import { useT } from "../i18n/useT";
import { TOOLBAR_HEIGHT } from "../toolbar/toolbarHeight";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
} from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { usePinStore } from "../stores/pinStore";
import { useSearchStore } from "../stores/searchStore";

/**
 * Quiet capability discovery — one chip at a time, top-center of the
 * canvas, in the negative space. Each cue declares the conditions under
 * which it should appear; the renderer picks the first active cue and
 * fades it in. Acting on the cue (or dismissing it) writes a flag to
 * `seenHints`, after which the same cue never reappears for this user.
 *
 * Tone goals:
 *  - Default state is barely there. Hover lifts contrast a notch.
 *  - One cue at a time. Two coincident cues never stack.
 *  - The cue itself is the action. No "learn more" indirection.
 */

interface CueViewModel {
  id: string;
  message: ReactNode;
  action: { label: string; onClick: () => void };
}

function useTotalTerminalCount(): number {
  return useProjectStore((s) =>
    s.projects.reduce(
      (sum, p) =>
        sum + p.worktrees.reduce((s2, w) => s2 + w.terminals.length, 0),
      0,
    ),
  );
}

function useFocusedProjectSnapshot():
  | { id: string; path: string; terminalCount: number }
  | null {
  return useProjectStore((s) => {
    if (!s.focusedProjectId) return null;
    const p = s.projects.find((pr) => pr.id === s.focusedProjectId);
    if (!p) return null;
    const count = p.worktrees.reduce((sum, w) => sum + w.terminals.length, 0);
    return { id: p.id, path: p.path, terminalCount: count };
  });
}

const CUE_ID_SEARCH = "discover-search";
const CUE_ID_PINNING = "discover-pinning";

const SEARCH_TRIGGER_THRESHOLD = 5;
const PINNING_TRIGGER_THRESHOLD = 3;

function useSearchDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const totalTerminals = useTotalTerminalCount();
  const seen = usePreferencesStore((s) => s.seenHints[CUE_ID_SEARCH] === true);
  const enabled = usePreferencesStore((s) => s.globalSearchEnabled);
  const setEnabled = usePreferencesStore((s) => s.setGlobalSearchEnabled);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (seen) return null;
  if (enabled) return null;
  if (totalTerminals < SEARCH_TRIGGER_THRESHOLD) return null;

  return {
    id: CUE_ID_SEARCH,
    message: t["discovery.search.message"](totalTerminals),
    action: {
      label: t["discovery.search.action"],
      onClick: () => {
        setEnabled(true);
        useSearchStore.getState().openSearch();
        markSeen(CUE_ID_SEARCH);
      },
    },
  };
}

function usePinningDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const focused = useFocusedProjectSnapshot();
  // Retire the cue once the user has any pin in any project — pinning is
  // a concept, not a per-project tutorial. One pin proves discovery.
  const totalPins = usePinStore((s) =>
    Object.values(s.pinsByProject).reduce((sum, list) => sum + list.length, 0),
  );
  const drawerOpenFor = usePinStore((s) => s.openProjectPath);
  const seen = usePreferencesStore((s) => s.seenHints[CUE_ID_PINNING] === true);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (seen) return null;
  if (!focused) return null;
  if (focused.terminalCount < PINNING_TRIGGER_THRESHOLD) return null;
  if (totalPins > 0) return null;
  // If the drawer is already open, the user has discovered it — silence.
  if (drawerOpenFor === focused.path) return null;

  return {
    id: CUE_ID_PINNING,
    message: t["discovery.pinning.message"],
    action: {
      label: t["discovery.pinning.action"],
      onClick: () => {
        usePinStore.getState().openDrawer(focused.path);
        markSeen(CUE_ID_PINNING);
      },
    },
  };
}

export function DiscoveryCue() {
  const t = useT();
  // Hooks run unconditionally; each returns null when its conditions
  // aren't met. Order = priority (project-scoped before global).
  const pinning = usePinningDiscoveryCue();
  const search = useSearchDiscoveryCue();
  const cue = pinning ?? search;

  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (!cue) return null;

  const leftInset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
  const rightInset = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;

  return (
    <div
      className="fixed pointer-events-none flex justify-center"
      style={{
        top: TOOLBAR_HEIGHT + 12,
        left: leftInset,
        right: rightInset,
        zIndex: 30,
      }}
    >
      <div
        key={cue.id}
        role="status"
        className="tc-enter-fade-up tc-discovery-chip pointer-events-auto group flex items-center gap-2.5 rounded-full border px-3 py-1 backdrop-blur-sm"
      >
        <span
          aria-hidden
          className="inline-block w-1 h-1 rounded-full shrink-0"
          style={{ background: "var(--accent)", opacity: 0.65 }}
        />
        <span className="tc-meta whitespace-nowrap">{cue.message}</span>
        <button
          type="button"
          onClick={cue.action.onClick}
          className="tc-eyebrow rounded px-1.5 py-0.5 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
          style={{
            color: "var(--accent)",
            transitionDuration: "var(--duration-instant)",
          }}
        >
          {cue.action.label}
        </button>
        <button
          type="button"
          onClick={() => markSeen(cue.id)}
          aria-label={t["discovery.dismiss"]}
          className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 -mr-1"
          style={{ transitionDuration: "var(--duration-quick)" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 2L8 8M8 2L2 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
