import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type OnMove,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  activateProjectInScene,
  activateWorktreeInScene,
  clearSceneFocusAndSelection,
} from "../actions/sceneSelectionActions";
import { useProjectStore } from "../stores/projectStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useCanvasStore } from "../stores/canvasStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useT } from "../i18n/useT";
import { FamilyTreeOverlay } from "../components/FamilyTreeOverlay";
import { BrowserCard } from "../components/BrowserCard";
import { BoxSelectOverlay } from "./BoxSelectOverlay";
import { DrawingLayer } from "./DrawingLayer";
import { useBoxSelect } from "../hooks/useBoxSelect";
import { useNotificationStore } from "../stores/notificationStore";
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
import { useStashStore } from "../stores/stashStore";
import { fromFlowViewport, toFlowViewport } from "./viewportAdapter";
import { buildCanvasFlowNodes } from "./nodeProjection";
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";
import {
  xyflowNodeTypes,
  type CanvasFlowNode,
} from "./xyflowNodes";
import {
  getCanvasLeftInset,
  rectIntersectsCanvasViewport,
} from "./viewportBounds";
import {
  WT_PAD,
  WT_TITLE_H,
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";
import {
  addScannedProjectAndFocus,
  ensureTerminalCreationTarget,
} from "../projects/projectCreation";
import { panToTerminal } from "../utils/panToTerminal";
import {
  getVisibleWorktreeSpans,
  getVisibleWorktreeTerminals,
} from "../utils/worktreeLayout";

const EMPTY_EDGES: never[] = [];

function buildProjectLayoutKey(
  projects: ReturnType<typeof useProjectStore.getState>["projects"],
) {
  return projects
    .map((project) =>
      [
        project.id,
        project.position.x,
        project.position.y,
        project.collapsed ? 1 : 0,
        project.zIndex ?? 0,
        project.worktrees
          .map((worktree) =>
            [
              worktree.id,
              worktree.position.x,
              worktree.position.y,
              worktree.collapsed ? 1 : 0,
              getVisibleWorktreeTerminals(worktree)
                .map(
                  (terminal) =>
                    `${terminal.id}:${terminal.span.cols}x${terminal.span.rows}:${terminal.stashed ? 1 : 0}`,
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
  nodes,
  projects,
  viewport,
  rightPanelCollapsed,
  leftPanelCollapsed,
  leftPanelWidth,
}: {
  nodes: CanvasFlowNode[];
  projects: ReturnType<typeof useProjectStore.getState>["projects"];
  viewport: ReturnType<typeof useCanvasStore.getState>["viewport"];
  rightPanelCollapsed: boolean;
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
}) {
  const managedTerminalIdsRef = useRef<Set<string>>(new Set());
  const publishedTerminalIdsRef = useRef<Set<string>>(new Set());
  const projectedPositions = useMemo(() => {
    const projectOffsets = new Map<string, { x: number; y: number }>();
    const worktreeOffsets = new Map<string, { x: number; y: number }>();

    for (const node of nodes) {
      if (node.type === "project") {
        projectOffsets.set(node.data.projectId, node.position);
      } else if (node.type === "worktree") {
        worktreeOffsets.set(node.data.worktreeId, node.position);
      }
    }

    return { projectOffsets, worktreeOffsets };
  }, [nodes]);
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
  const terminalEntries = useMemo(
    () =>
      projects.flatMap((project) =>
        project.worktrees.flatMap((worktree) => {
          const visibleTerminals = worktree.terminals.filter(
            (terminal) => !terminal.stashed,
          );
          const packed = packTerminals(
            visibleTerminals.map((terminal) => terminal.span),
          );
          const projectOffset =
            projectedPositions.projectOffsets.get(project.id) ?? project.position;
          const worktreeOffset =
            projectedPositions.worktreeOffsets.get(worktree.id) ?? {
              x: PROJ_PAD + worktree.position.x,
              y: PROJ_TITLE_H + PROJ_PAD + worktree.position.y,
            };

          return visibleTerminals.flatMap((terminal, index) => {
            const item = packed[index];
            if (!item) {
              return [];
            }

            const absoluteRect = {
              h: item.h,
              w: item.w,
              x: projectOffset.x + worktreeOffset.x + WT_PAD + item.x,
              y: projectOffset.y + worktreeOffset.y + WT_TITLE_H + WT_PAD + item.y,
            };

            return [
              {
                absoluteRect,
                project,
                terminal,
                worktree,
              },
            ];
          });
        }),
      ),
    [projects, projectedPositions.projectOffsets, projectedPositions.worktreeOffsets],
  );

  useEffect(() => {
    const nextTerminalIds = new Set<string>();

    for (const meta of runtimeMetas) {
      nextTerminalIds.add(meta.terminal.id);
      updateTerminalRuntime(meta);
    }

    const stashedIds = new Set(
      useStashStore.getState().items.map((item) => item.terminal.id),
    );
    for (const terminalId of managedTerminalIdsRef.current) {
      if (!nextTerminalIds.has(terminalId) && !stashedIds.has(terminalId)) {
        destroyTerminalRuntime(terminalId);
      }
    }

    managedTerminalIdsRef.current = nextTerminalIds;
  }, [runtimeMetas]);

  useEffect(() => {
    const nextTerminalIds = new Set<string>();

    for (const entry of terminalEntries) {
      if (entry.project.collapsed || entry.worktree.collapsed) {
        continue;
      }

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
    const visibleEntryIds = new Set(terminalEntries.map((entry) => entry.terminal.id));

    for (const project of projects) {
      for (const worktree of project.worktrees) {
        for (const terminal of worktree.terminals) {
          if (!visibleEntryIds.has(terminal.id)) {
            setTerminalRuntimeMode(terminal.id, "unmounted");
          }
        }
      }
    }

    for (const entry of terminalEntries) {
      const visible =
        !entry.project.collapsed &&
        !entry.worktree.collapsed &&
        rectIntersectsCanvasViewport(
          entry.absoluteRect,
          viewport,
          rightPanelCollapsed,
          leftPanelCollapsed,
          leftPanelWidth,
        );
      setTerminalRuntimeMode(
        entry.terminal.id,
        resolveTerminalMountMode({
          focused: entry.terminal.focused,
          visible,
        }),
      );
    }
  }, [leftPanelCollapsed, leftPanelWidth, projects, rightPanelCollapsed, terminalEntries, viewport]);

  useEffect(
    () => () => {
      for (const terminalId of managedTerminalIdsRef.current) {
        destroyTerminalRuntime(terminalId);
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
  const notify = useNotificationStore((state) => state.notify);
  const viewport = useCanvasStore((state) => state.viewport);
  const rightPanelCollapsed = useCanvasStore((state) => state.rightPanelCollapsed);
  const leftPanelCollapsed = useCanvasStore((state) => state.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((state) => state.leftPanelWidth);
  const drawingEnabled = usePreferencesStore((state) => state.drawingEnabled);
  const projects = useProjectStore((state) => state.projects);
  const browserCards = useBrowserCardStore((state) => Object.values(state.cards));
  const { handleMouseDown: handleBoxSelectMouseDown } = useBoxSelect();
  const projectLayoutKey = useMemo(() => buildProjectLayoutKey(projects), [projects]);
  const tileW = useTileDimensionsStore((s) => s.w);
  const tileH = useTileDimensionsStore((s) => s.h);
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const projectedNodes = useMemo(
    () => buildCanvasFlowNodes(projects),
    [projectLayoutKey, tileW, tileH],
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

  const handleMove = useCallback<OnMove>((_event, nextViewport) => {
    useCanvasStore
      .getState()
      .syncViewportFromRenderer(fromFlowViewport(nextViewport));
  }, []);

  const handleMoveEnd = useCallback<OnMove>((_event, nextViewport) => {
    useCanvasStore
      .getState()
      .commitViewportFromRenderer(fromFlowViewport(nextViewport));
  }, []);

  const handlePaneClick = useCallback(() => {
    clearSceneFocusAndSelection();
  }, []);

  const stopCanvasMouseDown = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  const handleAddProject = useCallback(async () => {
    if (!window.termcanvas) return;

    let dirPath: string | null;
    try {
      dirPath = await window.termcanvas.project.selectDirectory();
    } catch (err) {
      notify("error", t.error_dir_picker(err));
      return;
    }
    if (!dirPath) return;

    let info: Awaited<ReturnType<typeof window.termcanvas.project.scan>>;
    try {
      info = await window.termcanvas.project.scan(dirPath);
    } catch (err) {
      notify("error", t.error_scan(err));
      return;
    }
    if (!info) {
      notify("error", t.error_scan("Failed to scan directory"));
      return;
    }

    addScannedProjectAndFocus(info);
  }, [notify, t]);

  const handleNewTerminal = useCallback(() => {
    const homePath = window.termcanvas?.app.homePath;
    if (!homePath) return;

    const target = ensureTerminalCreationTarget(homePath);
    if (!target) return;

    const terminal = createTerminal("shell");
    const { addTerminal, setFocusedTerminal } = useProjectStore.getState();
    addTerminal(target.projectId, target.worktreeId, terminal);
    setFocusedTerminal(terminal.id);
    panToTerminal(terminal.id);
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler<CanvasFlowNode>>(
    (_event, node) => {
      if (node.type === "project") {
        const projectId = node.data.projectId;
        activateProjectInScene(projectId, { bringToFront: true });
        return;
      }

      if (node.type === "worktree") {
        const { projectId, worktreeId } = node.data;
        activateWorktreeInScene(projectId, worktreeId, { bringToFront: true });
      }
    },
    [],
  );

  const handleNodeDragStart = useCallback<OnNodeDrag<CanvasFlowNode>>(
    (_event, node) => {
      if (node.type === "project") {
        useProjectStore.getState().bringToFront(node.data.projectId);
        return;
      }

      if (node.type === "worktree") {
        useProjectStore.getState().bringToFront(node.data.projectId);
      }
    },
    [],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasFlowNode>>(
    (_event, node) => {
      if (node.type === "project") {
        useProjectStore.getState().updateProjectPosition(
          node.data.projectId,
          node.position.x,
          node.position.y,
        );
        return;
      }

      if (node.type === "worktree") {
        const { projectId, worktreeId } = node.data;
        useProjectStore.getState().updateWorktreePosition(
          projectId,
          worktreeId,
          Math.max(0, node.position.x - PROJ_PAD),
          Math.max(0, node.position.y - (PROJ_TITLE_H + PROJ_PAD)),
        );
      }
    },
    [],
  );

  return (
    <div
      className="fixed top-0 right-0 bottom-0 overflow-hidden canvas-bg"
      style={{ left: leftOffset }}
      onMouseDownCapture={handleBoxSelectMouseDown}
    >
      <TerminalRuntimeLayer
        nodes={nodes}
        projects={projects}
        viewport={viewport}
        rightPanelCollapsed={rightPanelCollapsed}
        leftPanelCollapsed={leftPanelCollapsed}
        leftPanelWidth={leftPanelWidth}
      />
      <ReactFlow
        className="tc-xyflow"
        defaultViewport={toFlowViewport(viewport)}
        nodes={nodes}
        edges={EMPTY_EDGES}
        nodeTypes={xyflowNodeTypes}
        onInit={handleInit}
        onNodesChange={onNodesChange}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onPaneClick={handlePaneClick}
        onNodeClick={handleNodeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        panOnDrag={[0, 1]}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements
        preventScrolling
      >
        <Background gap={20} size={1} color="var(--border)" />
      </ReactFlow>

      <BoxSelectOverlay />
      {drawingEnabled && <DrawingLayer />}

      <div
        id="canvas-layer"
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: "0 0",
          }}
        >
          {browserCards.map((card) => (
            <div
              key={card.id}
              style={{ pointerEvents: "auto" }}
            >
              <BrowserCard card={card} />
            </div>
          ))}
        </div>
      </div>

      <FamilyTreeOverlay />

      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto">
            <div className="text-[var(--text-muted)] text-lg font-light mb-4">
              {t.canvas_empty_title}
            </div>
            <div
              className="flex items-center justify-center gap-3"
              onMouseDown={stopCanvasMouseDown}
            >
              <button
                onClick={handleNewTerminal}
                className="px-6 py-3 bg-[var(--accent)] hover:brightness-110 text-white rounded-lg transition-all"
              >
                {t.shortcut_new_terminal}
              </button>
              <button
                onClick={handleAddProject}
                className="px-6 py-3 bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)] text-[var(--button-text)] rounded-lg transition-colors"
              >
                {t.canvas_empty_action}
              </button>
            </div>
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
    </ReactFlowProvider>
  );
}
