import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { useSessionStore } from "../stores/sessionStore";
import { useCompletionSeenStore } from "../stores/completionSeenStore";
import { useT } from "../i18n/useT";
import { useSidebarDragStore } from "../stores/sidebarDragStore";
import { useViewportFocusStore } from "../stores/viewportFocusStore";
import { panToTerminal } from "../utils/panToTerminal";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_FN,
} from "../utils/panelAnimation";
import type { LeftPanelTab } from "../stores/canvasStore";
import { promptAndAddProjectToScene } from "../canvas/sceneCommands";
import { buildProjectTree, type CanvasTerminalItem } from "./sessionPanelModel";
import { ProjectTree } from "./ProjectTree";
import { TerminalCard, HistorySection, StashedSection } from "./SessionsPanel";
import { PinDrawer } from "./PinDrawer";

/*
 * Left panel — project management + session history.
 *
 * Two tabbed surfaces:
 *   1. Sessions: live projects / worktrees / terminals. Click a
 *      terminal row to pan the canvas to it.
 *   2. History: past Claude/Codex sessions. Click a row to open
 *      the replay drawer.
 */

function IconSessions({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3.5h10v9H3z" />
      <path d="M5 6h6M5 8.5h4" />
    </svg>
  );
}

function IconHistory({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3a5 5 0 1 1-4.2 2.3" />
      <path d="M3.2 3.5v2.2h2.2" />
      <path d="M8 5.5V8l1.8 1.2" />
    </svg>
  );
}

const LEFT_TAB_CONFIG: {
  id: LeftPanelTab;
  icon: typeof IconSessions;
  labelKey: "left_panel_sessions" | "left_panel_history";
}[] = [
  { id: "sessions", icon: IconSessions, labelKey: "left_panel_sessions" },
  { id: "history", icon: IconHistory, labelKey: "left_panel_history" },
];

export function LeftPanel() {
  const t = useT();
  const collapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const width = useCanvasStore((s) => s.leftPanelWidth);
  const activeTab = useCanvasStore((s) => s.leftPanelActiveTab);
  const setCollapsed = useCanvasStore((s) => s.setLeftPanelCollapsed);
  const setWidth = useCanvasStore((s) => s.setLeftPanelWidth);
  const setActiveTab = useCanvasStore((s) => s.setLeftPanelActiveTab);

  const projects = useProjectStore((s) => s.projects);
  const runtimeTerminals = useTerminalRuntimeStore((s) => s.terminals);
  const liveSessions = useSessionStore((s) => s.liveSessions);
  const historySessions = useSessionStore((s) => s.historySessions);
  const loadReplay = useSessionStore((s) => s.loadReplay);
  const openSessions = useCanvasStore((s) => s.openSessionsOverlay);
  const seenTerminalIds = useCompletionSeenStore((s) => s.seenTerminalIds);
  const markCompletionSeen = useCompletionSeenStore((s) => s.markSeen);
  const syncActiveDoneIds = useCompletionSeenStore((s) => s.syncActiveDoneIds);

  const [addingProject, setAddingProject] = useState(false);

  const handleAddProject = useCallback(async () => {
    if (addingProject) return;
    setAddingProject(true);
    try {
      await promptAndAddProjectToScene(t);
    } finally {
      setAddingProject(false);
    }
  }, [addingProject, t]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, (typeof liveSessions)[number]>();
    for (const session of [...historySessions, ...liveSessions]) {
      map.set(session.sessionId, session);
    }
    return map;
  }, [historySessions, liveSessions]);

  const telemetryByTerminalId = useMemo(() => {
    const map = new Map<
      string,
      (typeof runtimeTerminals)[string]["telemetry"]
    >();
    for (const [terminalId, snapshot] of Object.entries(runtimeTerminals)) {
      map.set(terminalId, snapshot.telemetry);
    }
    return map;
  }, [runtimeTerminals]);

  const projectTreeResult = useMemo(
    () =>
      buildProjectTree(
        projects,
        telemetryByTerminalId,
        sessionsById,
        seenTerminalIds,
      ),
    [projects, telemetryByTerminalId, sessionsById, seenTerminalIds],
  );
  const projectTree = projectTreeResult.projects;
  const stashedItems = projectTreeResult.stashed;
  const hasAnyProjects = projectTree.length > 0;

  useEffect(() => {
    const allTerminals = projectTree.flatMap((pg) =>
      pg.worktrees.flatMap((wt) => wt.terminals),
    );
    const doneIds = allTerminals
      .filter((t) => t.state === "done")
      .map((t) => t.terminalId);
    syncActiveDoneIds(doneIds);
  }, [projectTree, syncActiveDoneIds]);

  // Bug 5: mark seen when the focused terminal in LeftPanel is done.
  useEffect(() => {
    const allTerminals = projectTree.flatMap((pg) =>
      pg.worktrees.flatMap((wt) => wt.terminals),
    );
    const focusedDone = allTerminals.find(
      (t) => t.focused && t.state === "done",
    );
    if (focusedDone) {
      markCompletionSeen(focusedDone.terminalId);
    }
  }, [projectTree, markCompletionSeen]);

  // Scope for the history section — every absolute worktree path on
  // the canvas. Used to filter historical sessions to the current
  // workspace.
  const canvasProjectDirs = useMemo(
    () => projects.flatMap((p) => p.worktrees.map((w) => w.path)),
    [projects],
  );

  const handleOpenReplay = useCallback(
    (filePath: string) => {
      // `openSessionsOverlay` enforces canvas-gap mutual exclusion
      // (file editor + usage get evicted), then the drawer renders
      // whatever `sessionStore.loadReplay` produces.
      openSessions();
      loadReplay(filePath);
    },
    [openSessions, loadReplay],
  );

  // When the panel collapses or expands, re-centre the focused
  // terminal in the canvas. Use the same duration / easing as the
  // panel width transition so the viewport pan stays in lockstep
  // with the CSS-animated panel + canvas edges.
  const prevCollapsedRef = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsedRef.current === collapsed) return;
    prevCollapsedRef.current = collapsed;
    const tid = projects
      .flatMap((p) => p.worktrees)
      .flatMap((w) => w.terminals)
      .find((term) => term.focused)?.id;
    if (tid) {
      panToTerminal(tid, {
        duration: PANEL_TRANSITION_DURATION_MS,
        easing: PANEL_TRANSITION_EASING_FN,
      });
    }
  }, [collapsed, projects]);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      const pid = e.pointerId;
      handle.setPointerCapture(pid);
      const startX = e.clientX;
      const origW = width;
      useSidebarDragStore.getState().setActive(true);
      const handleMove = (ev: PointerEvent) => {
        setWidth(Math.max(200, Math.min(600, origW + (ev.clientX - startX))));
      };
      const cleanup = () => {
        handle.removeEventListener("pointermove", handleMove);
        handle.removeEventListener("pointerup", cleanup);
        handle.removeEventListener("pointercancel", cleanup);
        handle.removeEventListener("lostpointercapture", cleanup);
        try {
          handle.releasePointerCapture(pid);
        } catch {}
        useSidebarDragStore.getState().setActive(false);
        const tid = useProjectStore
          .getState()
          .projects.flatMap((p) => p.worktrees)
          .flatMap((w) => w.terminals)
          .find((term) => term.focused)?.id;
        if (tid) {
          const inZoomFocus =
            useViewportFocusStore.getState().zoomedOutTerminalId === null;
          panToTerminal(tid, {
            immediate: true,
            preserveScale: !inZoomFocus,
          });
        }
      };
      handle.addEventListener("pointermove", handleMove);
      handle.addEventListener("pointerup", cleanup);
      handle.addEventListener("pointercancel", cleanup);
      handle.addEventListener("lostpointercapture", cleanup);
    },
    [width, setWidth],
  );

  const dragging = useSidebarDragStore((s) => s.active);
  // Animate the outer width on expand/collapse; pause the transition
  // while the resize handle drags so width tracks the pointer 1:1.
  // The inner surface is conditionally rendered — only one of the
  // two states is ever in the DOM, so there are no persistent
  // compositor layers that can get stuck unpainted after a
  // foreground/background switch.
  const displayedWidth = collapsed ? COLLAPSED_TAB_WIDTH : width;
  const widthTransition = dragging
    ? undefined
    : "width 240ms cubic-bezier(0.22, 0.61, 0.36, 1)";

  const renderTerminal = useCallback(
    (item: CanvasTerminalItem) => (
      <TerminalCard
        key={item.terminalId}
        item={item}
        t={t}
        hideLocation
        unseenDone={
          item.state === "done" && !seenTerminalIds.has(item.terminalId)
        }
      />
    ),
    [t, seenTerminalIds],
  );

  return (
    <>
      <PinDrawer />
      <div
        className="fixed left-0 z-40 bg-[var(--surface)] border-r border-[var(--border)] overflow-hidden"
        style={{
          top: 44,
          height: "calc(100vh - 44px)",
          width: displayedWidth,
          transition: widthTransition,
        }}
      >
        {collapsed ? (
          // Collapsed strip — keep the same tab affordance as the right panel.
          <div
            className="tc-row-hover absolute inset-y-0 left-0 flex flex-col items-center pt-3 gap-1 cursor-pointer"
            style={{ width: COLLAPSED_TAB_WIDTH }}
            onClick={() => setCollapsed(false)}
            title={t.left_panel_sessions}
          >
            {LEFT_TAB_CONFIG.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                className={`tc-row-icon flex items-center justify-center w-6 h-6 rounded-md ${
                  activeTab === id
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
                title={t[labelKey]}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab(id);
                  setCollapsed(false);
                }}
              >
                <Icon size={14} />
              </button>
            ))}
            <button
              className="tc-row-icon flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
              disabled={addingProject}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("sessions");
                setCollapsed(false);
                void handleAddProject();
              }}
              title={t.shortcut_add_project}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 2V10M2 6H10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div className="mt-auto mb-3 pointer-events-none">
              <div className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)]">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M3 2L7 5L3 8"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        ) : (
          // Expanded surface — laid out at the user-configured width so
          // content does not reflow while the outer width animates;
          // the outer overflow-hidden clips it during the transition.
          <div
            className="absolute inset-y-0 left-0 flex flex-col"
            style={{ width }}
          >
            <div className="shrink-0 px-2 pt-2 pb-2">
              <div className="flex items-center gap-0.5 rounded-lg bg-[var(--bg)] p-0.5">
                {LEFT_TAB_CONFIG.map(({ id, icon: Icon, labelKey }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      className={`tc-row-icon flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium ${
                        isActive
                          ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      }`}
                      onClick={() => setActiveTab(id)}
                    >
                      <Icon size={13} />
                      {width > 260 && <span>{t[labelKey]}</span>}
                    </button>
                  );
                })}
                <button
                  className="tc-row-icon flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50 ml-0.5 shrink-0"
                  disabled={addingProject}
                  onClick={() => {
                    setActiveTab("sessions");
                    void handleAddProject();
                  }}
                  title={t.shortcut_add_project}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className="shrink-0"
                  >
                    <path
                      d="M6 2V10M2 6H10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  className="tc-row-icon flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] shrink-0"
                  onClick={() => setCollapsed(true)}
                  title={t.right_panel_collapse}
                >
                  {/* Points LEFT — collapsing shrinks the left panel leftward. */}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M7 2L3 5L7 8"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="tc-sidebar-tree-font flex-1 min-h-0 overflow-y-auto">
              {activeTab === "sessions" ? (
                <>
                  <ProjectTree
                    projects={projectTree}
                    renderTerminal={renderTerminal}
                  />
                  {!hasAnyProjects && (
                    <div className="tc-label flex-1 px-4 py-6 text-center">
                      {t.sessions_no_canvas_items}
                    </div>
                  )}
                  <StashedSection items={stashedItems} t={t} />
                </>
              ) : (
                <HistorySection
                  projectDirs={canvasProjectDirs}
                  onOpen={handleOpenReplay}
                  t={t}
                  showHeader={false}
                />
              )}
            </div>

            <div
              className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize group/resize"
              onPointerDown={handleResizeStart}
            >
              <div
                className="absolute right-0 top-0 w-px h-full bg-[var(--border)] group-hover/resize:bg-[var(--accent)] group-hover/resize:opacity-70"
                style={{
                  transition:
                    "background-color var(--duration-quick) var(--ease-out-soft), opacity var(--duration-quick) var(--ease-out-soft)",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
