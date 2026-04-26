import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type OnMove,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  addProjectFromDirectoryPath,
  clearSceneFocusAndSelection,
  promptAndAddProjectToScene,
} from "./sceneCommands";
import { getStashedTerminalIds } from "./sceneState";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useCanvasToolStore } from "../stores/canvasToolStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useSidebarDragStore } from "../stores/sidebarDragStore";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";
import { useT } from "../i18n/useT";
import { FamilyTreeOverlay } from "../components/FamilyTreeOverlay";
import { FocusCaretOverlay } from "../components/FocusCaretOverlay";
import { BoxSelectOverlay } from "./BoxSelectOverlay";
import { CanvasCardLayer } from "./CanvasCardLayer";
import { DrawingLayer } from "./DrawingLayer";
import { PetOverlay } from "../pet/PetOverlay";
import { useBoxSelect } from "../hooks/useBoxSelect";
import { useTrackpadSwipeFocus } from "./trackpadSwipeFocus";
import {
  publishTerminalGeometry,
  unpublishTerminalGeometry,
} from "../terminal/terminalGeometryRegistry";
import { resolveTerminalMountMode } from "../terminal/terminalRuntimePolicy";
import {
  destroyTerminalRuntime,
  setTerminalRuntimeMode,
  updateTerminalRuntime,
} from "../terminal/terminalRuntimeStore";
import { fromFlowViewport, toFlowViewport } from "./viewportAdapter";
import { buildCanvasFlowNodes } from "./nodeProjection";
import { xyflowNodeTypes, type CanvasFlowNode } from "./xyflowNodes";
import {
  getCanvasLeftInset,
  rectIntersectsCanvasViewport,
} from "./viewportBounds";
import { clampScale, zoomAtClientPoint } from "./viewportZoom";
import { resolveCollisions } from "./collisionResolver";
import { WorktreeLabelLayer } from "./WorktreeLabelLayer";
import { ContextMenu } from "../components/ContextMenu";
import { createTerminalInScene } from "../actions/terminalSceneActions";
import type { TerminalType } from "../types";

const EMPTY_EDGES: never[] = [];
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const SNAP_GRID: [number, number] = [10, 10];

function normalizeWheelDelta(event: React.WheelEvent): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY * 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * window.innerHeight;
    default:
      return event.deltaY;
  }
}

/**
 * Build a stable cache key for the terminal layout.
 * In the flat canvas model, each terminal's own position and size
 * determines the layout (no project/worktree container offsets).
 */
function buildLayoutKey(
  projects: ReturnType<typeof useProjectStore.getState>["projects"],
) {
  return projects
    .map((project) =>
      [
        project.id,
        project.worktrees
          .map((worktree) =>
            [
              worktree.id,
              worktree.terminals
                .map(
                  (t) =>
                    `${t.id}:${t.x},${t.y},${t.width}x${t.height}:${t.stashed ? 1 : 0}:${t.minimized ? 1 : 0}`,
                )
                .join(","),
            ].join(":"),
          )
          .join(";"),
      ].join("|"),
    )
    .join("||");
}

function TerminalRuntimeLayer({
  projects,
  viewport,
  rightPanelCollapsed,
  rightPanelWidth,
  leftPanelCollapsed,
  leftPanelWidth,
  taskDrawerOpen,
}: {
  projects: ReturnType<typeof useProjectStore.getState>["projects"];
  viewport: ReturnType<typeof useCanvasStore.getState>["viewport"];
  rightPanelCollapsed: boolean;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  taskDrawerOpen: boolean;
}) {
  const managedTerminalIdsRef = useRef<Set<string>>(new Set());
  const publishedTerminalIdsRef = useRef<Set<string>>(new Set());

  const runtimeMetas = useMemo(
    () =>
      projects.flatMap((project) =>
        project.worktrees.flatMap((worktree) =>
          worktree.terminals.map((terminal) => ({
            projectId: project.id,
            terminal,
            worktreeId: worktree.id,
            worktreePath: worktree.path,
          })),
        ),
      ),
    [projects],
  );

  // Flat terminal entries — no project/worktree offset calculation needed
  const terminalEntries = useMemo(
    () =>
      projects.flatMap((project) =>
        project.worktrees.flatMap((worktree) =>
          worktree.terminals
            .filter((t) => !t.stashed)
            .map((terminal) => ({
              absoluteRect: {
                x: terminal.x,
                y: terminal.y,
                w: terminal.width,
                h: terminal.height,
              },
              project,
              terminal,
              worktree,
            })),
        ),
      ),
    [projects],
  );

  useEffect(() => {
    const nextTerminalIds = new Set<string>();

    for (const meta of runtimeMetas) {
      nextTerminalIds.add(meta.terminal.id);
      updateTerminalRuntime(meta);
    }

    const stashedIds = getStashedTerminalIds(projects);
    for (const terminalId of managedTerminalIdsRef.current) {
      if (!nextTerminalIds.has(terminalId) && !stashedIds.has(terminalId)) {
        destroyTerminalRuntime(terminalId, {
          caller: "TerminalRuntimeLayer.runtimeMetasEffect",
          reason: "terminal_removed_from_runtime_metas",
        });
      }
    }

    managedTerminalIdsRef.current = nextTerminalIds;
  }, [runtimeMetas]);

  useEffect(() => {
    const nextTerminalIds = new Set<string>();

    for (const entry of terminalEntries) {
      nextTerminalIds.add(entry.terminal.id);
      publishTerminalGeometry({
        h: entry.absoluteRect.h,
        projectId: entry.project.id,
        terminalId: entry.terminal.id,
        worktreeId: entry.worktree.id,
        w: entry.absoluteRect.w,
        x: entry.absoluteRect.x,
        y: entry.absoluteRect.y,
      });
    }

    for (const terminalId of publishedTerminalIdsRef.current) {
      if (!nextTerminalIds.has(terminalId)) {
        unpublishTerminalGeometry(terminalId);
      }
    }

    publishedTerminalIdsRef.current = nextTerminalIds;
  }, [terminalEntries]);

  useEffect(() => {
    const visibleEntryIds = new Set(
      terminalEntries.map((entry) => entry.terminal.id),
    );

    for (const project of projects) {
      for (const worktree of project.worktrees) {
        for (const terminal of worktree.terminals) {
          if (!visibleEntryIds.has(terminal.id)) {
            setTerminalRuntimeMode(terminal.id, "parked", {
              caller: "TerminalRuntimeLayer.visibilityEffect",
              reason: "terminal_missing_from_visible_entries",
            });
          }
        }
      }
    }

    for (const entry of terminalEntries) {
      const visible = rectIntersectsCanvasViewport(
        entry.absoluteRect,
        viewport,
        rightPanelCollapsed,
        leftPanelCollapsed,
        leftPanelWidth,
        rightPanelWidth,
        taskDrawerOpen,
      );
      setTerminalRuntimeMode(
        entry.terminal.id,
        resolveTerminalMountMode({
          focused: entry.terminal.focused,
          visible,
        }),
        {
          caller: "TerminalRuntimeLayer.visibilityEffect",
          detail: {
            visible,
          },
          reason: "viewport_visibility_recomputed",
        },
      );
    }
  }, [
    leftPanelCollapsed,
    leftPanelWidth,
    projects,
    rightPanelCollapsed,
    rightPanelWidth,
    taskDrawerOpen,
    terminalEntries,
    viewport,
  ]);

  useEffect(
    () => () => {
      for (const terminalId of managedTerminalIdsRef.current) {
        destroyTerminalRuntime(terminalId, {
          caller: "TerminalRuntimeLayer.cleanup",
          reason: "terminal_runtime_layer_unmount",
        });
      }

      for (const terminalId of publishedTerminalIdsRef.current) {
        unpublishTerminalGeometry(terminalId);
      }
    },
    [],
  );

  return null;
}

function XyFlowCanvasInner() {
  const t = useT();
  const viewport = useCanvasStore((state) => state.viewport);
  const isAnimating = useCanvasStore((state) => state.isAnimating);
  const rightPanelCollapsed = useCanvasStore(
    (state) => state.rightPanelCollapsed,
  );
  const leftPanelCollapsed = useCanvasStore(
    (state) => state.leftPanelCollapsed,
  );
  const leftPanelWidth = useCanvasStore((state) => state.leftPanelWidth);
  const rightPanelWidth = useCanvasStore((state) => state.rightPanelWidth);
  const taskDrawerOpen = usePinStore(
    (state) => state.openProjectPath !== null,
  );
  const projects = useProjectStore((state) => state.projects);
  const drawingEnabled = usePreferencesStore((state) => state.drawingEnabled);
  const petEnabled = usePreferencesStore((state) => state.petEnabled);
  const animationBlur = usePreferencesStore((state) => state.animationBlur);
  const drawingTool = useDrawingStore((state) => state.tool);
  const canvasTool = useCanvasToolStore((state) => state.tool);
  const spaceHeld = useCanvasToolStore((state) => state.spaceHeld);
  const { handleMouseDown: handleBoxSelectMouseDown } = useBoxSelect();
  const layoutKey = useMemo(() => buildLayoutKey(projects), [projects]);
  const leftOffset = getCanvasLeftInset(
    leftPanelCollapsed,
    leftPanelWidth,
    taskDrawerOpen,
  );
  const sidebarDragging = useSidebarDragStore((s) => s.active);
  const isDrawing = drawingEnabled && drawingTool !== "select";
  const isPanMode = canvasTool === "hand" || spaceHeld;
  const [isPanning, setIsPanning] = useState(false);
  const previousAnimatingRef = useRef(isAnimating);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  useTrackpadSwipeFocus(canvasContainerRef);

  const reactFlow = useReactFlow();
  const [contextMenu, setContextMenu] = useState<{
    clientX: number;
    clientY: number;
    flowX: number;
    flowY: number;
  } | null>(null);

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      const flow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: flow.x,
        flowY: flow.y,
      });
    },
    [reactFlow],
  );

  const handleContextMenuPick = useCallback(
    (type: TerminalType) => {
      if (!contextMenu) return;
      const {
        focusedProjectId,
        focusedWorktreeId,
        projects: currentProjects,
      } = useProjectStore.getState();
      let projectId = focusedProjectId;
      let worktreeId = focusedWorktreeId;
      if (!projectId || !worktreeId) {
        const fallbackProject = currentProjects[0];
        const fallbackWorktree = fallbackProject?.worktrees[0];
        if (!fallbackProject || !fallbackWorktree) {
          return;
        }
        projectId = fallbackProject.id;
        worktreeId = fallbackWorktree.id;
      }
      createTerminalInScene({
        projectId,
        worktreeId,
        type,
        position: { x: contextMenu.flowX, y: contextMenu.flowY },
      });
    },
    [contextMenu],
  );

  const projectedNodes = useMemo(
    () => buildCanvasFlowNodes(projects),
    [layoutKey],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<CanvasFlowNode>(projectedNodes);

  useEffect(() => {
    setNodes(projectedNodes);
  }, [projectedNodes, setNodes]);

  useEffect(
    () => () => {
      useCanvasStore.getState().registerViewportAdapter(null);
    },
    [],
  );

  const handleInit = useCallback(
    (reactFlow: ReactFlowInstance<CanvasFlowNode>) => {
      useCanvasStore.getState().registerViewportAdapter({
        setViewport: (nextViewport, options) => {
          void reactFlow.setViewport(
            {
              x: nextViewport.x,
              y: nextViewport.y,
              zoom: nextViewport.scale,
            },
            options,
          );
        },
        getViewport: () => {
          const current = reactFlow.getViewport();
          return fromFlowViewport(current);
        },
      });
      useCanvasStore
        .getState()
        .syncViewportFromRenderer(fromFlowViewport(reactFlow.getViewport()));
    },
    [],
  );

  const handleMove = useCallback<OnMove>(
    (_event, nextViewport) => {
      const vp = fromFlowViewport(nextViewport);
      const snapped = {
        x: Math.round(vp.x),
        y: Math.round(vp.y),
        scale: vp.scale,
      };

      // Snap viewport translation to integer pixels during pan. When the
      // transform has fractional coordinates, 1px borders / background dots /
      // text edges render across sub-pixel boundaries and snap between pixel
      // grids frame-to-frame. This produces the "stutter" and eye-strain the
      // user describes as "low grid adhesion". Rounding forces the GPU
      // compositor to align to physical pixels, eliminating the jitter.
      if (snapped.x !== vp.x || snapped.y !== vp.y) {
        reactFlow.setViewport(
          { x: snapped.x, y: snapped.y, zoom: snapped.scale },
          { duration: 0 },
        );
      }

      useCanvasStore.getState().syncViewportFromRenderer(snapped);
    },
    [reactFlow],
  );

  const handleMoveEnd = useCallback<OnMove>((_event, nextViewport) => {
    const vp = fromFlowViewport(nextViewport);
    const snapped = {
      x: Math.round(vp.x),
      y: Math.round(vp.y),
      scale: vp.scale,
    };
    useCanvasStore.getState().commitViewportFromRenderer(snapped);
  }, []);

  const handlePaneClick = useCallback(() => {
    clearSceneFocusAndSelection();
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler<CanvasFlowNode>>(
    (_event, node) => {
      // Space-held panning is a transient override on top of whatever
      // tool is active — a click that lands while Space is down is the
      // tail of a pan gesture, so suppress the activate. Persistent
      // Hand mode is different: clicking a terminal there is the user's
      // way of getting *into* a terminal without leaving Hand. Without
      // this distinction the now-default Hand tool can't focus a
      // worktree by clicking, which made the canvas feel inert.
      if (spaceHeld) return;
      const { projectId, worktreeId } = node.data;
      useProjectStore.getState().setFocusedWorktree(projectId, worktreeId);
    },
    [spaceHeld],
  );

  const handleNodeDragStart = useCallback<OnNodeDrag<CanvasFlowNode>>(() => {
    // No-op in flat canvas — no bringToFront needed
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasFlowNode>>(
    (_event, node) => {
      // Write terminal position back to store
      const { projectId, worktreeId, terminalId } = node.data;
      const snappedX =
        Math.round(node.position.x / SNAP_GRID[0]) * SNAP_GRID[0];
      const snappedY =
        Math.round(node.position.y / SNAP_GRID[1]) * SNAP_GRID[1];
      useProjectStore
        .getState()
        .updateTerminalPosition(
          projectId,
          worktreeId,
          terminalId,
          snappedX,
          snappedY,
        );

      // Resolve collisions after drag
      const allProjects = useProjectStore.getState().projects;
      const allRects = allProjects.flatMap((p) =>
        p.worktrees.flatMap((w) =>
          w.terminals
            .filter((t) => !t.stashed)
            .map((t) => ({
              id: t.id,
              x: t.id === terminalId ? snappedX : t.x,
              y: t.id === terminalId ? snappedY : t.y,
              width: t.width,
              height: t.height,
            })),
        ),
      );
      const resolved = resolveCollisions(allRects, 8, terminalId);
      const updatePos = useProjectStore.getState().updateTerminalPosition;
      for (const rect of resolved) {
        if (rect.id === terminalId) continue;
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
    },
    [],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) {
        return;
      }

      const file = files[0];
      const dirPath = window.termcanvas.fs.getFilePath(file);
      if (!dirPath) {
        return;
      }

      await addProjectFromDirectoryPath(dirPath, t);
    },
    [t],
  );

  const handleAddProject = useCallback(async () => {
    await promptAndAddProjectToScene(t);
  }, [t]);

  const handleWheelCapture = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      // Two distinct gestures land here:
      //   1. Cmd/Ctrl + wheel — explicit zoom intent.
      //   2. Trackpad pinch — Chromium synthesises wheel events with
      //      ctrlKey=true even though no key is pressed. Same code path
      //      handles both, anchored at the cursor position.
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const delta = normalizeWheelDelta(event);
      if (Math.abs(delta) < 0.001) {
        return;
      }

      const scaleFactor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
      const nextViewport = zoomAtClientPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        leftPanelCollapsed,
        leftPanelWidth,
        taskDrawerOpen,
        nextScale: clampScale(viewport.scale * scaleFactor),
        viewport,
      });

      useCanvasStore.getState().setViewport(nextViewport);
    },
    [leftPanelCollapsed, leftPanelWidth, taskDrawerOpen, viewport],
  );

  const handleContainerMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isPanMode && event.button === 0) {
        setIsPanning(true);
      }
      handleBoxSelectMouseDown(event);
    },
    [handleBoxSelectMouseDown, isPanMode],
  );

  useEffect(() => {
    if (!isPanning) return;
    const stop = () => setIsPanning(false);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, [isPanning]);

  // isPanning takes precedence over isPanMode for the cursor: if the
  // user holds Space, presses the mouse, then releases Space before
  // mouseup, the gesture is still in flight and the cursor must keep
  // saying "grabbing". Without this, the cursor snaps back to default
  // mid-drag.
  const cursorClass = isDrawing
    ? "cursor-crosshair"
    : isPanning
      ? "cursor-grabbing"
      : isPanMode
        ? "cursor-grab"
        : "";

  // Cursors set on the outer div lose to the `cursor: text !important`
  // rule that .tc-xterm-host / .xterm enforces inside terminal tiles.
  // Toggle body classes that the matching CSS overrides target so the
  // pan cursor wins everywhere on the canvas, not just over empty
  // pane.
  useEffect(() => {
    const body = document.body;
    body.classList.toggle("tc-canvas-pan-mode", isPanMode || isPanning);
    body.classList.toggle("tc-canvas-pan-grabbing", isPanning);
    return () => {
      body.classList.remove("tc-canvas-pan-mode");
      body.classList.remove("tc-canvas-pan-grabbing");
    };
  }, [isPanMode, isPanning]);

  return (
    <div
      ref={canvasContainerRef}
      className={`fixed top-0 right-0 bottom-0 overflow-hidden canvas-bg ${cursorClass}`}
      style={{
        left: leftOffset,
        transition: sidebarDragging
          ? undefined
          : `left ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`,
      }}
      onMouseDownCapture={handleContainerMouseDown}
      onWheelCapture={handleWheelCapture}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <TerminalRuntimeLayer
        projects={projects}
        viewport={viewport}
        rightPanelCollapsed={rightPanelCollapsed}
        rightPanelWidth={rightPanelWidth}
        leftPanelCollapsed={leftPanelCollapsed}
        leftPanelWidth={leftPanelWidth}
        taskDrawerOpen={taskDrawerOpen}
      />
      <ReactFlow
        className="tc-xyflow"
        style={{
          willChange: isAnimating ? "transform" : undefined,
          filter:
            animationBlur > 0 && isAnimating
              ? `blur(${animationBlur}px)`
              : "none",
          transition: animationBlur > 0 ? "filter 0.15s ease" : "none",
        }}
        defaultViewport={toFlowViewport(viewport)}
        nodes={nodes}
        edges={EMPTY_EDGES}
        nodeTypes={xyflowNodeTypes}
        onInit={handleInit}
        onNodesChange={onNodesChange}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeClick={handleNodeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        nodesDraggable={!isPanMode}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        // In Hand mode (or Space-held), left+middle both pan. In Move
        // mode, only middle-button pans — the left button is reserved
        // for marquee on empty canvas (handled by useBoxSelect) and
        // node drag (handled by React Flow's nodesDraggable).
        panOnDrag={isPanMode ? [0, 1] : [1]}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        snapToGrid
        snapGrid={SNAP_GRID}
        zoomOnScroll={false}
        zoomOnPinch={false}
        minZoom={0.1}
        maxZoom={2}
        // Runtime park/live policy already downshifts offscreen terminals to
        // preview mode. Letting React Flow also cull offscreen nodes causes
        // TerminalTile remount churn during viewport animation and focus
        // cycling, which in turn destabilizes xterm/WebGL lifecycle.
        preventScrolling
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={2} color="var(--border)" />
      </ReactFlow>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.clientX}
          y={contextMenu.clientY}
          items={[
            {
              label: t.canvas_empty_action,
              onClick: () => {
                void handleAddProject();
              },
            },
            { type: "separator" },
            {
              label: "New Shell",
              onClick: () => handleContextMenuPick("shell"),
            },
            {
              label: "New Claude",
              onClick: () => handleContextMenuPick("claude"),
            },
            {
              label: "New Codex",
              onClick: () => handleContextMenuPick("codex"),
            },
            {
              label: "New Gemini",
              onClick: () => handleContextMenuPick("gemini"),
            },
            {
              label: "New Lazygit",
              onClick: () => handleContextMenuPick("lazygit"),
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      <BoxSelectOverlay />
      <CanvasCardLayer />
      {drawingEnabled && <DrawingLayer />}
      {petEnabled && <PetOverlay />}

      <WorktreeLabelLayer />

      <FamilyTreeOverlay />

      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto">
            <div className="text-[var(--text-muted)] text-lg font-light mb-4">
              {t.canvas_empty_title}
            </div>
            <button
              onClick={handleAddProject}
              className="px-6 py-3 bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)] text-[var(--button-text)] rounded-lg transition-colors"
            >
              {t.canvas_empty_action}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function XyFlowCanvas() {
  return (
    <ReactFlowProvider>
      <XyFlowCanvasInner />
      <FocusCaretOverlay />
    </ReactFlowProvider>
  );
}
