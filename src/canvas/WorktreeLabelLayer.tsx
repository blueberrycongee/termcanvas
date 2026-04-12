import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import {
  canvasPointToScreenPoint,
  getCanvasLeftInset,
} from "./viewportBounds";
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
const FADE_END = 0.3;
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
  const fadeProgress = Math.min(
    1,
    Math.max(0, (HUD_THRESHOLD - scale) / (HUD_THRESHOLD - FADE_END)),
  );
  let dim: number;
  if (isFocused || isHovered) {
    dim = 1;
  } else if (hasFocus) {
    dim = 0.35;
  } else {
    dim = 0.85;
  }
  return fadeProgress * dim;
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
  transition:
    "opacity 120ms ease-out, transform 120ms ease-out, background-color 120ms ease-out",
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

export function WorktreeLabelLayer() {
  const projects = useProjectStore((s) => s.projects);
  const viewport = useCanvasStore((s) => s.viewport);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const [, setResizeTick] = useState(0);
  const [hoveredLabelKey, setHoveredLabelKey] = useState<string | null>(null);
  const [hoveredTerminalKey, setHoveredTerminalKey] = useState<string | null>(
    null,
  );

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
      // Compute key lazily from current state — store ref capture would
      // race with the project store on rapid hovers.
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
  const projectLabels = useMemo(
    () => buildProjectLabels(projects),
    [projects],
  );

  if (typeof document === "undefined") return null;
  if (worktreeLabels.length === 0) return null;

  const scale = viewport.scale;
  const useLodMode = scale < LOD_THRESHOLD;
  const showHud = scale >= HUD_THRESHOLD && focus.worktreeId !== null;
  const hasFocus = focus.worktreeId !== null;
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);

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

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 30 }}
      aria-hidden="true"
    >
      {collisionResolved.map((placed) => {
        if (placed.opacity <= 0.01) return null;
        const { entry } = placed;
        return (
          <div
            key={entry.key}
            className="absolute select-none whitespace-nowrap cursor-pointer pointer-events-auto"
            style={{
              ...LABEL_BASE_STYLE,
              left: placed.screenX,
              top: placed.screenY,
              transform: "translate(0, -100%)",
              opacity: placed.opacity,
            }}
            onMouseEnter={() => setHoveredLabelKey(entry.key)}
            onMouseLeave={() =>
              setHoveredLabelKey((prev) => (prev === entry.key ? null : prev))
            }
            onClick={(e) => {
              e.stopPropagation();
              // Pair pan with focus so the next cmd+t lands inside the
              // worktree the user just clicked. panToWorktree only updates
              // useSelectionStore (visual selection); cmd+t reads
              // focusedProjectId / focusedWorktreeId from useProjectStore,
              // so without focusWorktreeInScene the new terminal would go
              // to whichever worktree happened to be focused before.
              if (entry.worktreeId) {
                focusWorktreeInScene(entry.projectId, entry.worktreeId);
                panToWorktree(entry.projectId, entry.worktreeId);
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
                <span
                  style={{ color: "var(--text-faint)", margin: "0 4px" }}
                >
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
          <span
            style={{ fontWeight: 700, color: "var(--text-primary)" }}
          >
            {focus.worktreeName}
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}
