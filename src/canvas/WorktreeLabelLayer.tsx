import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useReactFlow } from "@xyflow/react";
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useTaskStore } from "../stores/taskStore";
import {
  canvasPointToScreenPoint,
  getCanvasLeftInset,
  screenDeltaToCanvasDelta,
} from "./viewportBounds";
import { resolveCollisionsDetailed } from "./collisionResolver";
import { panToWorktree } from "../utils/panToWorktree";
import { focusWorktreeInScene } from "../actions/sceneSelectionActions";

/**
 * Per-worktree screen-space label layer.
 *
 * The canvas is "flat" since 6673d9c — terminals are top-level ReactFlow
 * nodes with no enclosing project / worktree containers — which makes it
 * very hard to tell at a glance which worktree any given tile belongs to,
 * especially once you zoom out. This layer reintroduces the missing
 * orientation cue WITHOUT bringing the old containers back: it draws a
 * pixel-fixed text label per worktree (or per project at extreme zoom-out)
 * that follows the canvas pan/zoom transform but does not shrink with it.
 *
 * Visibility is scale-driven so the layer never competes with terminal
 * content:
 *   • scale ≥ HUD_THRESHOLD: per-cluster labels are hidden. A single HUD
 *     pinned to the canvas top-left tells you which worktree the focused
 *     terminal belongs to. This is the "I'm typing into one terminal,
 *     occasionally I want to remember where I am" mode.
 *   • LOD_THRESHOLD ≤ scale < HUD_THRESHOLD: per-worktree labels fade in
 *     linearly. Focused worktree's label stays at full opacity, others
 *     dim so the focus pops.
 *   • scale < LOD_THRESHOLD: same-project worktrees collapse into a
 *     single project-level label "Project (N)" so a screen full of tiny
 *     tiles doesn't become a screen full of tiny labels.
 *
 * Interaction:
 *   • Hover label → highlight (full accent), click → pan-to-fit the
 *     worktree's bbox so the label doubles as a worktree jump target.
 *   • Hover any terminal → its worktree's label highlights (consumes
 *     the existing termcanvas:terminal-hover event so we don't add a
 *     second hover surface to terminal tiles).
 *   • Labels collide-avoid against each other — overlapping labels are
 *     stacked vertically so they never sit on top of each other. They
 *     never push or move actual terminals.
 *
 * The wrapper is pointer-events: none; only the label pills opt back into
 * pointer events. The layer never participates in ReactFlow's node graph,
 * never affects terminal positions, and cannot block any canvas drag.
 */

const HUD_THRESHOLD = 0.7;
const LOD_THRESHOLD = 0.15;

// Pixel-space gap to leave between two stacked labels.
const COLLISION_GAP = 4;

// Estimated character width for "Geist Mono" 12px so we can lay out
// before the DOM has measured each label. Slightly generous to avoid
// pessimistic overlap.
const APPROX_CHAR_PX = 7.2;
const LABEL_PADDING_PX = 12;
const LABEL_HEIGHT_PX = 22;

interface WorktreeLabelEntry {
  key: string;
  projectId: string;
  worktreeId: string;
  projectName: string;
  worktreeName: string;
  worldX: number;
  worldY: number;
}

interface ProjectLabelEntry {
  key: string;
  projectId: string;
  projectName: string;
  worktreeCount: number;
  worldX: number;
  worldY: number;
}

interface FocusInfo {
  projectId: string | null;
  worktreeId: string | null;
  projectName: string | null;
  worktreeName: string | null;
}

function pickAnchor(terminals: ProjectData["worktrees"][number]["terminals"]) {
  const tiles = terminals.filter((t) => !t.stashed && !t.minimized);
  if (tiles.length === 0) return null;
  let anchor = tiles[0];
  for (const t of tiles) {
    if (t.y < anchor.y || (t.y === anchor.y && t.x < anchor.x)) {
      anchor = t;
    }
  }
  return anchor;
}

function buildWorktreeLabels(projects: ProjectData[]): WorktreeLabelEntry[] {
  const out: WorktreeLabelEntry[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const anchor = pickAnchor(worktree.terminals);
      if (!anchor) continue;
      out.push({
        key: `${project.id}::${worktree.id}`,
        projectId: project.id,
        worktreeId: worktree.id,
        projectName: project.name,
        worktreeName: worktree.name,
        worldX: anchor.x,
        worldY: anchor.y,
      });
    }
  }
  return out;
}

function buildProjectLabels(projects: ProjectData[]): ProjectLabelEntry[] {
  const out: ProjectLabelEntry[] = [];
  for (const project of projects) {
    let count = 0;
    let bestAnchor: { x: number; y: number } | null = null;
    for (const worktree of project.worktrees) {
      const anchor = pickAnchor(worktree.terminals);
      if (!anchor) continue;
      count += 1;
      if (
        !bestAnchor ||
        anchor.y < bestAnchor.y ||
        (anchor.y === bestAnchor.y && anchor.x < bestAnchor.x)
      ) {
        bestAnchor = { x: anchor.x, y: anchor.y };
      }
    }
    if (!bestAnchor || count === 0) continue;
    out.push({
      key: `proj::${project.id}`,
      projectId: project.id,
      projectName: project.name,
      worktreeCount: count,
      worldX: bestAnchor.x,
      worldY: bestAnchor.y,
    });
  }
  return out;
}

function findFocusInfo(projects: ProjectData[]): FocusInfo {
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.focused) {
          return {
            projectId: project.id,
            worktreeId: worktree.id,
            projectName: project.name,
            worktreeName: worktree.name,
          };
        }
      }
    }
  }
  return {
    projectId: null,
    worktreeId: null,
    projectName: null,
    worktreeName: null,
  };
}

function findWorktreeKeyForTerminal(
  projects: ProjectData[],
  terminalId: string,
): string | null {
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      if (worktree.terminals.some((t) => t.id === terminalId)) {
        return `${project.id}::${worktree.id}`;
      }
    }
  }
  return null;
}

function findProjectKeyForTerminal(
  projects: ProjectData[],
  terminalId: string,
): string | null {
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      if (worktree.terminals.some((t) => t.id === terminalId)) {
        return `proj::${project.id}`;
      }
    }
  }
  return null;
}

function clusterOpacity(
  scale: number,
  isFocused: boolean,
  isHovered: boolean,
  hasFocus: boolean,
): number {
  if (scale >= HUD_THRESHOLD) return 0;
  if (isFocused || isHovered) return 1;
  if (hasFocus) return 0.35;
  return 0.85;
}

function estimateLabelWidth(text: string): number {
  return Math.ceil(text.length * APPROX_CHAR_PX) + LABEL_PADDING_PX;
}

interface PlacedEntry<T> {
  entry: T;
  screenX: number;
  screenY: number;
  width: number;
  isFocused: boolean;
  isHovered: boolean;
  opacity: number;
}

/**
 * Stack-up collision avoidance: walk labels in spatial order, and for each
 * one, push it upward until its rect doesn't overlap any previously placed
 * label. Labels are screen-space rectangles only, so this never touches
 * canvas world coords or terminal positions. If a label cannot find a free
 * slot within MAX_LIFT it is hidden via opacity 0.
 */
const MAX_LIFT = LABEL_HEIGHT_PX * 4;

function resolveCollisions<T>(placed: PlacedEntry<T>[]): PlacedEntry<T>[] {
  // Sort by anchor y so labels nearer the top get placed first.
  const sorted = [...placed].sort((a, b) => a.screenY - b.screenY);
  const settled: PlacedEntry<T>[] = [];

  for (const candidate of sorted) {
    let liftedY = candidate.screenY;
    const left = candidate.screenX;
    const right = candidate.screenX + candidate.width;

    for (let attempt = 0; attempt <= MAX_LIFT; attempt += LABEL_HEIGHT_PX) {
      const top = liftedY - LABEL_HEIGHT_PX;
      const bottom = liftedY;
      const collides = settled.some((s) => {
        const sLeft = s.screenX;
        const sRight = s.screenX + s.width;
        const sTop = s.screenY - LABEL_HEIGHT_PX;
        const sBottom = s.screenY;
        return (
          left < sRight + COLLISION_GAP &&
          right + COLLISION_GAP > sLeft &&
          top < sBottom + COLLISION_GAP &&
          bottom + COLLISION_GAP > sTop
        );
      });
      if (!collides) {
        settled.push({ ...candidate, screenY: liftedY });
        break;
      }
      liftedY -= LABEL_HEIGHT_PX + COLLISION_GAP;
      if (attempt + LABEL_HEIGHT_PX > MAX_LIFT) {
        // Out of stacking room — drop the label entirely so we never
        // render it on top of another one.
        settled.push({ ...candidate, screenY: liftedY, opacity: 0 });
        break;
      }
    }
  }

  return settled;
}

const LABEL_BASE_STYLE = {
  fontFamily: '"Geist Mono", monospace',
  fontSize: 12,
  lineHeight: 1.2,
  color: "var(--text-primary)",
  padding: "2px 6px",
  backgroundColor: "color-mix(in srgb, var(--surface) 70%, transparent)",
  borderRadius: 4,
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
  transition: "background-color 120ms ease-out",
} as const;

interface ClusterEntry {
  key: string;
  projectId: string;
  worktreeId: string | null;
  worldX: number;
  worldY: number;
  primary: string;
  prefix: string | null;
}

interface WorktreeDragState {
  key: string;
  projectId: string;
  worktreeId: string;
  startClientX: number;
  startClientY: number;
  pointerId: number;
  moved: boolean;
  /** Compact positions computed on pointerdown (anchor-relative offsets). */
  compactOffsets: Map<string, { x: number; y: number }>;
  /** Canvas-space anchor (label world position) at drag start. */
  anchorX: number;
  anchorY: number;
  /** Terminal IDs involved in this drag. */
  terminalIds: string[];
}

/**
 * Compute compact offsets for terminals relative to an anchor point.
 * Terminals "snap" into a tight grid below the anchor — like being
 * summoned to the label.
 */
const COMPACT_GAP = 12;

function computeCompactOffsets(
  terminals: Array<{ id: string; width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const offsets = new Map<string, { x: number; y: number }>();
  if (terminals.length === 0) return offsets;

  const columns =
    terminals.length <= 2 ? terminals.length : terminals.length <= 6 ? 3 : 4;

  let curX = 0;
  let curY = 0;
  let rowHeight = 0;

  terminals.forEach((t, index) => {
    if (index > 0 && index % columns === 0) {
      curX = 0;
      curY += rowHeight + COMPACT_GAP;
      rowHeight = 0;
    }
    offsets.set(t.id, { x: curX, y: curY });
    curX += t.width + COMPACT_GAP;
    rowHeight = Math.max(rowHeight, t.height);
  });

  return offsets;
}

export function WorktreeLabelLayer() {
  const projects = useProjectStore((s) => s.projects);
  const viewport = useCanvasStore((s) => s.viewport);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const taskDrawerOpen = useTaskStore((s) => s.openProjectPath !== null);
  const reactFlow = useReactFlow();
  const [, setResizeTick] = useState(0);
  const [hoveredLabelKey, setHoveredLabelKey] = useState<string | null>(null);
  const [hoveredTerminalKey, setHoveredTerminalKey] = useState<string | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<WorktreeDragState | null>(null);
  const dragLabelRef = useRef<HTMLDivElement | null>(null);
  const suppressClickUntilRef = useRef(0);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  useEffect(() => {
    const onResize = () => setResizeTick((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mirror the existing terminal-hover event so hovering a tile lights up
  // its worktree's label without us having to add a second hover surface
  // on TerminalTile. The same event powers FamilyTreeOverlay.
  useEffect(() => {
    const handler = (event: Event) => {
      const terminalId = (event as CustomEvent<string | null>).detail;
      if (!terminalId) {
        setHoveredTerminalKey(null);
        return;
      }
      const currentProjects = useProjectStore.getState().projects;
      const useLod = useCanvasStore.getState().viewport.scale < LOD_THRESHOLD;
      const key = useLod
        ? findProjectKeyForTerminal(currentProjects, terminalId)
        : findWorktreeKeyForTerminal(currentProjects, terminalId);
      setHoveredTerminalKey(key);
    };
    window.addEventListener("termcanvas:terminal-hover", handler);
    return () =>
      window.removeEventListener("termcanvas:terminal-hover", handler);
  }, []);

  const focus = useMemo(() => findFocusInfo(projects), [projects]);
  const worktreeLabels = useMemo(
    () => buildWorktreeLabels(projects),
    [projects],
  );
  const projectLabels = useMemo(() => buildProjectLabels(projects), [projects]);

  if (typeof document === "undefined") return null;
  if (worktreeLabels.length === 0) return null;

  const scale = viewport.scale;
  const useLodMode = scale < LOD_THRESHOLD;
  const showHud = scale >= HUD_THRESHOLD && focus.worktreeId !== null;
  const hasFocus = focus.worktreeId !== null;
  const leftInset = getCanvasLeftInset(
    leftPanelCollapsed,
    leftPanelWidth,
    taskDrawerOpen,
  );

  const clusterEntries: ClusterEntry[] = useLodMode
    ? projectLabels.map((entry) => ({
        key: entry.key,
        projectId: entry.projectId,
        worktreeId: null,
        worldX: entry.worldX,
        worldY: entry.worldY,
        primary: `${entry.projectName} (${entry.worktreeCount})`,
        prefix: null,
      }))
    : worktreeLabels.map((entry) => ({
        key: entry.key,
        projectId: entry.projectId,
        worktreeId: entry.worktreeId,
        worldX: entry.worldX,
        worldY: entry.worldY,
        primary: entry.worktreeName,
        prefix: entry.projectName,
      }));

  const placedEntries: PlacedEntry<ClusterEntry>[] = clusterEntries.map(
    (entry) => {
      const screen = canvasPointToScreenPoint(
        entry.worldX,
        entry.worldY,
        viewport,
        leftPanelCollapsed,
        leftPanelWidth,
        taskDrawerOpen,
      );
      const isFocused = useLodMode
        ? entry.projectId === focus.projectId
        : entry.projectId === focus.projectId &&
          entry.worktreeId === focus.worktreeId;
      const isHovered =
        hoveredLabelKey === entry.key || hoveredTerminalKey === entry.key;
      const fullText =
        (entry.prefix ? `${entry.prefix} / ` : "") + entry.primary;
      return {
        entry,
        screenX: screen.x,
        screenY: screen.y - 6,
        width: estimateLabelWidth(fullText),
        isFocused,
        isHovered,
        opacity: clusterOpacity(scale, isFocused, isHovered, hasFocus),
      };
    },
  );

  const collisionResolved = resolveCollisions(placedEntries);

  const handleLabelPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    entry: ClusterEntry,
  ) => {
    if (!entry.worktreeId || useLodMode) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Collect worktree terminals for compact layout.
    const project = projects.find((p) => p.id === entry.projectId);
    const worktree = project?.worktrees.find((w) => w.id === entry.worktreeId);
    const terminals = worktree?.terminals.filter((t) => !t.stashed) ?? [];
    if (terminals.length === 0) return;

    const compactOffsets = computeCompactOffsets(
      terminals.map((t) => ({ id: t.id, width: t.width, height: t.height })),
    );
    const terminalIds = terminals.map((t) => t.id);

    dragStateRef.current = {
      key: entry.key,
      projectId: entry.projectId,
      worktreeId: entry.worktreeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      pointerId: event.pointerId,
      moved: false,
      compactOffsets,
      anchorX: entry.worldX,
      anchorY: entry.worldY,
      terminalIds,
    };

    // Immediately snap terminals to compact positions around the label anchor.
    reactFlow.setNodes((nodes) =>
      nodes.map((n) => {
        const offset = compactOffsets.get(n.id);
        if (!offset) return n;
        return {
          ...n,
          position: {
            x: entry.worldX + offset.x,
            y: entry.worldY + offset.y,
          },
        };
      }),
    );

    setIsDragging(true);

    const handlePointerMove = (e: PointerEvent) => {
      const active = dragStateRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      e.preventDefault();

      active.moved =
        active.moved ||
        Math.abs(e.clientX - active.startClientX) > 3 ||
        Math.abs(e.clientY - active.startClientY) > 3;

      const vp = viewportRef.current;
      const delta = screenDeltaToCanvasDelta(
        e.clientX - active.startClientX,
        e.clientY - active.startClientY,
        vp,
      );

      const ax = active.anchorX + delta.x;
      const ay = active.anchorY + delta.y;

      reactFlow.setNodes((nodes) =>
        nodes.map((n) => {
          const offset = active.compactOffsets.get(n.id);
          if (!offset) return n;
          return {
            ...n,
            position: { x: ax + offset.x, y: ay + offset.y },
          };
        }),
      );

      // Move the label DOM element directly to follow the cursor.
      const el = dragLabelRef.current;
      if (el) {
        const screenDx = e.clientX - active.startClientX;
        const screenDy = e.clientY - active.startClientY;
        el.style.transform = `translate(${screenDx}px, calc(-100% + ${screenDy}px))`;
      }
    };

    const finishDrag = (e: PointerEvent) => {
      const active = dragStateRef.current;
      if (!active || e.pointerId !== active.pointerId) return;

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      dragStateRef.current = null;

      // Capture label element before the re-render detaches its ref.
      const el = dragLabelRef.current;

      if (active.moved) {
        suppressClickUntilRef.current = performance.now() + 250;
      }

      const vp = viewportRef.current;
      const delta = active.moved
        ? screenDeltaToCanvasDelta(
            e.clientX - active.startClientX,
            e.clientY - active.startClientY,
            vp,
          )
        : { x: 0, y: 0 };
      const finalAnchorX = active.anchorX + delta.x;
      const finalAnchorY = active.anchorY + delta.y;

      const SNAP = 10;
      const snap = (v: number) => Math.round(v / SNAP) * SNAP;

      const updates = active.terminalIds.map((id) => {
        const offset = active.compactOffsets.get(id)!;
        return {
          projectId: active.projectId,
          worktreeId: active.worktreeId,
          terminalId: id,
          x: snap(finalAnchorX + offset.x),
          y: snap(finalAnchorY + offset.y),
        };
      });

      // Flush store + drag-flag together so React commits the new left/top
      // BEFORE we clear the imperative transform — otherwise the label paints
      // one frame at the old anchor position and visibly snaps back to start.
      flushSync(() => {
        useProjectStore.getState().updateTerminalPositions(updates);
        setIsDragging(false);
      });

      if (el) el.style.transform = "translate(0, -100%)";

      // Resolve collisions with all other terminals.
      const allProjects = useProjectStore.getState().projects;
      const movedIds = new Set(active.terminalIds);
      const allRects = allProjects.flatMap((p) =>
        p.worktrees.flatMap((w) =>
          w.terminals
            .filter((t) => !t.stashed)
            .map((t) => ({
              id: t.id,
              x: t.x,
              y: t.y,
              width: t.width,
              height: t.height,
            })),
        ),
      );
      const { resolved } = resolveCollisionsDetailed(
        allRects,
        8,
        active.terminalIds,
      );
      const updatePos = useProjectStore.getState().updateTerminalPosition;
      for (const rect of resolved) {
        if (movedIds.has(rect.id)) continue;
        const original = allRects.find((r) => r.id === rect.id);
        if (original && (original.x !== rect.x || original.y !== rect.y)) {
          for (const p of allProjects) {
            for (const w of p.worktrees) {
              if (w.terminals.some((t) => t.id === rect.id)) {
                updatePos(p.id, w.id, rect.id, rect.x, rect.y);
              }
            }
          }
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
  };

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 30 }}
      aria-hidden="true"
    >
      {collisionResolved.map((placed) => {
        if (placed.opacity <= 0.01) return null;
        const { entry } = placed;
        const isDragTarget = dragStateRef.current?.key === entry.key;
        return (
          <div
            key={entry.key}
            ref={isDragTarget ? dragLabelRef : undefined}
            className="absolute select-none whitespace-nowrap cursor-pointer pointer-events-auto"
            style={{
              ...LABEL_BASE_STYLE,
              left: placed.screenX,
              top: placed.screenY,
              transform: "translate(0, -100%)",
              opacity: placed.opacity,
              cursor: entry.worktreeId && !useLodMode ? "grab" : "pointer",
              transition: isDragging ? "none" : LABEL_BASE_STYLE.transition,
            }}
            onPointerDown={(event) => handleLabelPointerDown(event, entry)}
            onMouseEnter={() => setHoveredLabelKey(entry.key)}
            onMouseLeave={() =>
              setHoveredLabelKey((prev) => (prev === entry.key ? null : prev))
            }
            onClick={(e) => {
              e.stopPropagation();
              if (performance.now() < suppressClickUntilRef.current) {
                return;
              }
              // Pair pan with focus so the next cmd+t lands inside the
              // worktree the user just clicked. panToWorktree only updates
              // useSelectionStore (visual selection); cmd+t reads
              // focusedProjectId / focusedWorktreeId from useProjectStore,
              // so without focusWorktreeInScene the new terminal would go
              // to whichever worktree happened to be focused before.
              if (entry.worktreeId) {
                focusWorktreeInScene(entry.projectId, entry.worktreeId);
                panToWorktree(entry.projectId, entry.worktreeId, {
                  enterOverview: true,
                });
              } else if (useLodMode) {
                // LOD project label: pan to and focus the first populated
                // worktree so a follow-up cmd+t still has a valid target.
                const proj = projects.find((p) => p.id === entry.projectId);
                const wt = proj?.worktrees.find((w) =>
                  w.terminals.some((t) => !t.stashed && !t.minimized),
                );
                if (proj && wt) {
                  focusWorktreeInScene(proj.id, wt.id);
                  panToWorktree(proj.id, wt.id);
                }
              }
            }}
          >
            {entry.prefix && (
              <>
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                  {entry.prefix}
                </span>
                <span style={{ color: "var(--text-faint)", margin: "0 4px" }}>
                  /
                </span>
              </>
            )}
            <span
              style={{
                fontWeight: placed.isFocused || placed.isHovered ? 700 : 600,
                color:
                  placed.isFocused || placed.isHovered
                    ? "var(--accent)"
                    : "var(--text-primary)",
              }}
            >
              {entry.primary}
            </span>
          </div>
        );
      })}

      {showHud && focus.projectName && focus.worktreeName && (
        <div
          className="absolute select-none whitespace-nowrap flex items-center gap-1.5"
          style={{
            ...LABEL_BASE_STYLE,
            left: leftInset + 16,
            top: 56 + 12,
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: 6,
              height: 6,
              backgroundColor: "var(--accent)",
              boxShadow: "0 0 4px var(--accent)",
            }}
            aria-hidden="true"
          />
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
            {focus.projectName}
          </span>
          <span style={{ color: "var(--text-faint)" }}>/</span>
          <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>
            {focus.worktreeName}
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}
