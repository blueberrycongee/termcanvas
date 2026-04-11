import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import {
  canvasPointToScreenPoint,
  getCanvasLeftInset,
} from "./viewportBounds";

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
 * The layer never participates in ReactFlow's node graph, never affects
 * terminal positions, and is pointer-events: none on the wrapper so it
 * cannot block any canvas interaction.
 */

const HUD_THRESHOLD = 0.7;
const FADE_END = 0.3;
const LOD_THRESHOLD = 0.15;

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

function clusterOpacity(
  scale: number,
  isFocused: boolean,
  hasFocus: boolean,
): number {
  if (scale >= HUD_THRESHOLD) return 0;
  const fadeProgress = Math.min(
    1,
    Math.max(0, (HUD_THRESHOLD - scale) / (HUD_THRESHOLD - FADE_END)),
  );
  let dim = 1;
  if (hasFocus) {
    dim = isFocused ? 1 : 0.35;
  } else {
    dim = 0.85;
  }
  return fadeProgress * dim;
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

export function WorktreeLabelLayer() {
  const projects = useProjectStore((s) => s.projects);
  const viewport = useCanvasStore((s) => s.viewport);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const [, setResizeTick] = useState(0);

  useEffect(() => {
    const onResize = () => setResizeTick((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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

  const clusterEntries = useLodMode
    ? projectLabels.map((entry) => ({
        key: entry.key,
        worldX: entry.worldX,
        worldY: entry.worldY,
        isFocused: entry.projectId === focus.projectId,
        primary: `${entry.projectName} (${entry.worktreeCount})`,
        prefix: null as string | null,
      }))
    : worktreeLabels.map((entry) => ({
        key: entry.key,
        worldX: entry.worldX,
        worldY: entry.worldY,
        isFocused:
          entry.projectId === focus.projectId &&
          entry.worktreeId === focus.worktreeId,
        primary: entry.worktreeName,
        prefix: entry.projectName as string | null,
      }));

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 30 }}
      aria-hidden="true"
    >
      {clusterEntries.map((entry) => {
        const opacity = clusterOpacity(scale, entry.isFocused, hasFocus);
        if (opacity <= 0.01) return null;
        const screen = canvasPointToScreenPoint(
          entry.worldX,
          entry.worldY,
          viewport,
          leftPanelCollapsed,
          leftPanelWidth,
        );
        return (
          <div
            key={entry.key}
            className="absolute select-none whitespace-nowrap"
            style={{
              ...LABEL_BASE_STYLE,
              left: screen.x,
              top: screen.y,
              transform: "translate(0, calc(-100% - 6px))",
              opacity,
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
                fontWeight: entry.isFocused ? 700 : 600,
                color: entry.isFocused
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
