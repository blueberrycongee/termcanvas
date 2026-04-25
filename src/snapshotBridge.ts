import type { DrawingElement } from "./stores/drawingStore";
import type {
  PersistedProjectData,
  PersistedStashedTerminal,
  ProjectData,
  StashedTerminal,
  TerminalOrigin,
  TerminalStatus,
  TerminalType,
} from "./types";
import type { SceneDocument } from "./types/scene";
import type { useProjectStore } from "./stores/projectStore";
import type { useCanvasStore } from "./stores/canvasStore";
import type { useDrawingStore } from "./stores/drawingStore";
import type { useBrowserCardStore } from "./stores/browserCardStore";
import { normalizeProjectsFocus } from "./stores/projectFocus";
import {
  buildSceneDocumentFromLegacyState,
  drawingToAnnotation,
  sceneDocumentToLegacyState,
} from "./canvas/sceneProjection";
import { clusterByTag } from "./clustering";

export interface LegacyWorkspaceSnapshot {
  version: 1;
  viewport: ReturnType<typeof useCanvasStore.getState>["viewport"];
  projects: PersistedProjectData[];
  drawings: ReturnType<typeof useDrawingStore.getState>["elements"];
  browserCards: ReturnType<typeof useBrowserCardStore.getState>["cards"];
  stashedTerminals?: PersistedStashedTerminal[];
}

export interface SceneWorkspaceSnapshot {
  version: 2;
  scene: SceneDocument;
}

export type WorkspaceSnapshot =
  | LegacyWorkspaceSnapshot
  | SceneWorkspaceSnapshot;

export interface RestoredWorkspaceSnapshot {
  legacy: LegacyWorkspaceSnapshot;
  scene: SceneDocument;
  sourceVersion: number;
}

export interface SkipRestoreSnapshot {
  skipRestore: true;
}

function normalizeViewport(
  value: unknown,
): LegacyWorkspaceSnapshot["viewport"] {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { x?: unknown }).x === "number" &&
    typeof (value as { y?: unknown }).y === "number" &&
    typeof (value as { scale?: unknown }).scale === "number"
  ) {
    return {
      scale: (value as { scale: number }).scale,
      x: (value as { x: number }).x,
      y: (value as { y: number }).y,
    };
  }

  return { scale: 1, x: 0, y: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizePosition(value: unknown): { x: number; y: number } {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { x?: unknown }).x === "number" &&
    typeof (value as { y?: unknown }).y === "number"
  ) {
    return {
      x: (value as { x: number }).x,
      y: (value as { y: number }).y,
    };
  }

  return { x: 0, y: 0 };
}

function normalizeTerminalType(value: unknown): TerminalType {
  switch (value) {
    case "claude":
    case "codex":
    case "kimi":
    case "gemini":
    case "opencode":
    case "wuu":
    case "lazygit":
    case "tmux":
    case "shell":
      return value;
    default:
      return "shell";
  }
}

function normalizeTerminalStatus(value: unknown): TerminalStatus {
  switch (value) {
    case "running":
    case "active":
    case "waiting":
    case "completed":
    case "success":
    case "error":
    case "idle":
      return value;
    default:
      return "idle";
  }
}

function isScenePoint(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function isSceneStrokePoint(
  value: unknown,
): value is { x: number; y: number; pressure?: number } {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    (typeof value.pressure === "undefined" ||
      typeof value.pressure === "number")
  );
}

function isAnnotationAnchor(
  value: unknown,
): value is SceneDocument["annotations"][number]["anchor"] {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "world") {
    return isScenePoint(value.position);
  }

  if (value.kind === "entity") {
    return typeof value.entityId === "string" && isScenePoint(value.offset);
  }

  return false;
}

function isSceneAnnotation(
  value: unknown,
): value is SceneDocument["annotations"][number] {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.color !== "string" ||
    !isAnnotationAnchor(value.anchor)
  ) {
    return false;
  }

  switch (value.type) {
    case "pen":
      return (
        typeof value.size === "number" &&
        Array.isArray(value.points) &&
        value.points.every(isSceneStrokePoint)
      );
    case "text":
      return (
        typeof value.fontSize === "number" && typeof value.content === "string"
      );
    case "rect":
      return (
        typeof value.strokeWidth === "number" &&
        typeof value.width === "number" &&
        typeof value.height === "number"
      );
    case "arrow":
      return typeof value.strokeWidth === "number" && isScenePoint(value.end);
    default:
      return false;
  }
}

function isLegacyDrawingElement(value: unknown): value is DrawingElement {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.color !== "string"
  ) {
    return false;
  }

  switch (value.type) {
    case "pen":
      return (
        typeof value.size === "number" &&
        Array.isArray(value.points) &&
        value.points.every(isSceneStrokePoint)
      );
    case "text":
      return (
        typeof value.x === "number" &&
        typeof value.y === "number" &&
        typeof value.fontSize === "number" &&
        typeof value.content === "string"
      );
    case "rect":
      return (
        typeof value.x === "number" &&
        typeof value.y === "number" &&
        typeof value.w === "number" &&
        typeof value.h === "number" &&
        typeof value.strokeWidth === "number"
      );
    case "arrow":
      return (
        typeof value.x1 === "number" &&
        typeof value.y1 === "number" &&
        typeof value.x2 === "number" &&
        typeof value.y2 === "number" &&
        typeof value.strokeWidth === "number"
      );
    default:
      return false;
  }
}

function normalizeSceneCamera(value: unknown): SceneDocument["camera"] {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { x?: unknown }).x === "number" &&
    typeof (value as { y?: unknown }).y === "number"
  ) {
    if (typeof (value as { zoom?: unknown }).zoom === "number") {
      return {
        x: (value as { x: number }).x,
        y: (value as { y: number }).y,
        zoom: (value as { zoom: number }).zoom,
      };
    }

    if (typeof (value as { scale?: unknown }).scale === "number") {
      return {
        x: (value as { x: number }).x,
        y: (value as { y: number }).y,
        zoom: (value as { scale: number }).scale,
      };
    }
  }

  return { x: 0, y: 0, zoom: 1 };
}

interface LegacySpan {
  cols?: unknown;
  rows?: unknown;
}

function widthFromSpan(span: LegacySpan, baseW: number): number {
  const cols = Math.max(1, Number(span?.cols ?? 1));
  return cols * baseW + Math.max(0, cols - 1) * 8;
}

function heightFromSpan(span: LegacySpan, baseH: number): number {
  const rows = Math.max(1, Number(span?.rows ?? 1));
  return rows * baseH + Math.max(0, rows - 1) * 8;
}

const FREE_CANVAS_DEFAULT_TILE = { w: 640, h: 480 };

function migrateProjects(projects: Record<string, unknown>[]): ProjectData[] {
  // Track terminal IDs that need cluster placement (legacy v1 records that
  // lack x/y/tags). After we project everything, we run clusterByTag to
  // assign positions for these.
  const pendingClusterIds = new Set<string>();
  const result = projects.flatMap((project) => {
    if (
      typeof project.id !== "string" ||
      typeof project.name !== "string" ||
      typeof project.path !== "string"
    ) {
      return [];
    }

    const worktrees = Array.isArray(project.worktrees)
      ? project.worktrees.filter(isRecord).flatMap((worktree) => {
          if (
            typeof worktree.id !== "string" ||
            typeof worktree.name !== "string" ||
            typeof worktree.path !== "string"
          ) {
            return [];
          }

          const terminals = Array.isArray(worktree.terminals)
            ? worktree.terminals.filter(isRecord).flatMap((terminal) => {
                if (
                  typeof terminal.id !== "string" ||
                  typeof terminal.title !== "string"
                ) {
                  return [];
                }

                const hasNumericWidth = typeof terminal.width === "number";
                const hasNumericHeight = typeof terminal.height === "number";
                const hasNumericX = typeof terminal.x === "number";
                const hasNumericY = typeof terminal.y === "number";
                const span =
                  isRecord(terminal.span)
                    ? (terminal.span as LegacySpan)
                    : undefined;

                const width = hasNumericWidth
                  ? (terminal.width as number)
                  : span
                    ? widthFromSpan(span, FREE_CANVAS_DEFAULT_TILE.w)
                    : FREE_CANVAS_DEFAULT_TILE.w;
                const height = hasNumericHeight
                  ? (terminal.height as number)
                  : span
                    ? heightFromSpan(span, FREE_CANVAS_DEFAULT_TILE.h)
                    : FREE_CANVAS_DEFAULT_TILE.h;
                const x = hasNumericX ? (terminal.x as number) : 0;
                const y = hasNumericY ? (terminal.y as number) : 0;
                const existingTags = Array.isArray(terminal.tags)
                  ? (terminal.tags as string[])
                  : [];
                const needsAutoTags =
                  existingTags.length === 0 || (!hasNumericX && !hasNumericY);
                const tags = needsAutoTags
                  ? [
                      `project:${project.name as string}`,
                      `worktree:${worktree.name as string}`,
                      `type:${normalizeTerminalType(terminal.type)}`,
                      ...existingTags.filter((tag) => tag.startsWith("custom:")),
                    ]
                  : existingTags;
                const origin: TerminalOrigin =
                  terminal.origin === "agent" ? "agent" : "user";

                if (!hasNumericX && !hasNumericY) {
                  pendingClusterIds.add(terminal.id as string);
                }

                return [
                  {
                    autoApprove:
                      typeof terminal.autoApprove === "boolean"
                        ? terminal.autoApprove
                        : undefined,
                    customTitle:
                      typeof terminal.customTitle === "string"
                        ? terminal.customTitle
                        : undefined,
                    focused: terminal.focused === true,
                    id: terminal.id,
                    initialPrompt:
                      typeof terminal.initialPrompt === "string"
                        ? terminal.initialPrompt
                        : undefined,
                    minimized: terminal.minimized === true,
                    origin,
                    parentTerminalId:
                      typeof terminal.parentTerminalId === "string"
                        ? terminal.parentTerminalId
                        : undefined,
                    ptyId: null,
                    scrollback:
                      typeof terminal.scrollback === "string"
                        ? terminal.scrollback
                        : undefined,
                    sessionId:
                      typeof terminal.sessionId === "string"
                        ? terminal.sessionId
                        : undefined,
                    starred: terminal.starred === true,
                    status: normalizeTerminalStatus(terminal.status),
                    tags,
                    title: terminal.title,
                    type: normalizeTerminalType(terminal.type),
                    width,
                    height,
                    x,
                    y,
                  },
                ];
              })
            : [];

          return [
            {
              id: worktree.id,
              name: worktree.name,
              path: worktree.path,
              ...(typeof worktree.isPrimary === "boolean"
                ? { isPrimary: worktree.isPrimary }
                : {}),
              terminals,
            },
          ];
        })
      : [];

    return [
      {
        id: project.id,
        name: project.name,
        path: project.path,
        worktrees,
      },
    ];
  });

  if (pendingClusterIds.size > 0) {
    const tilesForCluster = result.flatMap((project) =>
      project.worktrees.flatMap((worktree) =>
        worktree.terminals
          .filter((terminal) => pendingClusterIds.has(terminal.id))
          .map((terminal) => ({
            id: terminal.id,
            width: terminal.width,
            height: terminal.height,
            tags: terminal.tags,
          })),
      ),
    );
    const positions = clusterByTag(tilesForCluster, "project");
    for (const project of result) {
      for (const worktree of project.worktrees) {
        for (const terminal of worktree.terminals) {
          const position = positions.get(terminal.id);
          if (position) {
            terminal.x = position.x;
            terminal.y = position.y;
          }
        }
      }
    }
  }

  return result;
}

function migrateLegacySnapshot(
  value: Record<string, unknown>,
): LegacyWorkspaceSnapshot {
  const projectsSource = Array.isArray(value.projects)
    ? value.projects.filter(isRecord)
    : [];
  const drawingsSource = Array.isArray(value.drawings) ? value.drawings : [];
  const browserCardsSource =
    value.browserCards && typeof value.browserCards === "object"
      ? value.browserCards
      : {};

  const stashedTerminals = normalizeStashedTerminals(value.stashedTerminals);

  return {
    version: 1,
    browserCards: browserCardsSource as LegacyWorkspaceSnapshot["browserCards"],
    drawings: drawingsSource as LegacyWorkspaceSnapshot["drawings"],
    projects: normalizeProjectsFocus(migrateProjects(projectsSource)).projects,
    viewport: normalizeViewport(value.viewport),
    ...(stashedTerminals.length > 0 ? { stashedTerminals } : {}),
  };
}

function normalizeStashedTerminals(raw: unknown): StashedTerminal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((entry) => {
    if (
      typeof entry.projectId !== "string" ||
      typeof entry.worktreeId !== "string" ||
      typeof entry.stashedAt !== "number" ||
      !isRecord(entry.terminal)
    ) {
      return [];
    }
    const t = entry.terminal;
    if (typeof t.id !== "string" || typeof t.title !== "string") {
      return [];
    }
    const width = typeof t.width === "number" ? t.width : 640;
    const height = typeof t.height === "number" ? t.height : 480;
    const x = typeof t.x === "number" ? t.x : 0;
    const y = typeof t.y === "number" ? t.y : 0;
    const tags = Array.isArray(t.tags) ? (t.tags as string[]) : [];
    const origin: TerminalOrigin = t.origin === "agent" ? "agent" : "user";
    return [
      {
        projectId: entry.projectId,
        worktreeId: entry.worktreeId,
        stashedAt: entry.stashedAt,
        terminal: {
          autoApprove:
            typeof t.autoApprove === "boolean" ? t.autoApprove : undefined,
          customTitle:
            typeof t.customTitle === "string" ? t.customTitle : undefined,
          focused: false,
          id: t.id,
          initialPrompt:
            typeof t.initialPrompt === "string" ? t.initialPrompt : undefined,
          minimized: false,
          origin,
          parentTerminalId:
            typeof t.parentTerminalId === "string"
              ? t.parentTerminalId
              : undefined,
          ptyId: null,
          scrollback:
            typeof t.scrollback === "string" ? t.scrollback : undefined,
          sessionId: typeof t.sessionId === "string" ? t.sessionId : undefined,
          starred: t.starred === true,
          status: normalizeTerminalStatus(t.status),
          tags,
          title: t.title,
          type: normalizeTerminalType(t.type),
          width,
          height,
          x,
          y,
        },
      },
    ];
  });
}

function coerceSceneDocument(value: unknown): SceneDocument | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value;
  const rawProjects = Array.isArray(record.projects) ? record.projects : null;
  if (rawProjects === null) {
    return null;
  }

  const projectRecords = rawProjects.filter(isRecord);
  if (projectRecords.length !== rawProjects.length) {
    return null;
  }

  const projects = normalizeProjectsFocus(
    migrateProjects(projectRecords),
  ).projects;

  if (!projects) {
    return null;
  }

  const annotations = Array.isArray(record.annotations)
    ? record.annotations.flatMap((annotation) => {
        if (isSceneAnnotation(annotation)) {
          return [annotation];
        }

        if (isLegacyDrawingElement(annotation)) {
          return [drawingToAnnotation(annotation)];
        }

        return [];
      })
    : [];

  const stashedTerminals = normalizeStashedTerminals(record.stashedTerminals);

  return {
    version: 2,
    camera: normalizeSceneCamera(record.camera),
    projects,
    browserCards:
      record.browserCards && typeof record.browserCards === "object"
        ? (record.browserCards as SceneDocument["browserCards"])
        : {},
    annotations,
    ...(stashedTerminals.length > 0 ? { stashedTerminals } : {}),
  };
}

function looksLikeSceneWorkspaceSnapshot(record: Record<string, unknown>) {
  return (
    hasOwn(record, "scene") ||
    record.version === 2 ||
    hasOwn(record, "camera") ||
    hasOwn(record, "annotations")
  );
}

function looksLikeLegacyWorkspaceSnapshot(record: Record<string, unknown>) {
  return (
    record.version === 1 ||
    hasOwn(record, "viewport") ||
    hasOwn(record, "drawings") ||
    hasOwn(record, "browserCards")
  );
}

function legacySnapshotFromScene(
  scene: SceneDocument,
): LegacyWorkspaceSnapshot {
  const legacyState = sceneDocumentToLegacyState(scene);
  return {
    version: 1,
    viewport: legacyState.viewport,
    projects: normalizeProjectsFocus(legacyState.projects).projects,
    drawings: legacyState.drawings,
    browserCards: legacyState.browserCards,
    ...(scene.stashedTerminals && scene.stashedTerminals.length > 0
      ? { stashedTerminals: scene.stashedTerminals }
      : {}),
  };
}

export function readWorkspaceSnapshot(
  source: unknown,
): RestoredWorkspaceSnapshot | SkipRestoreSnapshot | null {
  let parsed = source;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch (error) {
      console.error(
        "[snapshotBridge] failed to parse workspace snapshot:",
        error,
      );
      return null;
    }
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if ((parsed as { skipRestore?: boolean }).skipRestore) {
    return { skipRestore: true };
  }

  if (hasOwn(parsed, "scene")) {
    const scene = coerceSceneDocument(parsed.scene);
    if (!scene) {
      return null;
    }

    return {
      legacy: legacySnapshotFromScene(scene),
      scene,
      sourceVersion: 2,
    };
  }

  if (looksLikeSceneWorkspaceSnapshot(parsed)) {
    const scene = coerceSceneDocument(parsed);
    if (!scene) {
      return null;
    }

    return {
      legacy: legacySnapshotFromScene(scene),
      scene,
      sourceVersion: 2,
    };
  }

  if (looksLikeLegacyWorkspaceSnapshot(parsed)) {
    const legacy = migrateLegacySnapshot(parsed);
    return {
      legacy,
      scene: buildSceneDocumentFromLegacyState(legacy),
      sourceVersion: 1,
    };
  }

  return null;
}
