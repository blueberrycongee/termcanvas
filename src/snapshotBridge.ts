import type { DrawingElement } from "./stores/drawingStore";
import type {
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

export interface LegacyWorkspaceSnapshot {
  version: 1;
  viewport: ReturnType<typeof useCanvasStore.getState>["viewport"];
  projects: ReturnType<typeof useProjectStore.getState>["projects"];
  drawings: ReturnType<typeof useDrawingStore.getState>["elements"];
  browserCards: ReturnType<typeof useBrowserCardStore.getState>["cards"];
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
    (typeof value.pressure === "undefined" || typeof value.pressure === "number")
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
        typeof value.fontSize === "number" &&
        typeof value.content === "string"
      );
    case "rect":
      return (
        typeof value.strokeWidth === "number" &&
        typeof value.width === "number" &&
        typeof value.height === "number"
      );
    case "arrow":
      return (
        typeof value.strokeWidth === "number" &&
        isScenePoint(value.end)
      );
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

function normalizeSceneCamera(
  value: unknown,
): SceneDocument["camera"] {
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

function migrateProjects(projects: Record<string, unknown>[]): ProjectData[] {
  return projects.flatMap((project) => {
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

                const span =
                  isRecord(terminal.span) &&
                  typeof terminal.span.cols === "number" &&
                  typeof terminal.span.rows === "number"
                    ? { cols: terminal.span.cols, rows: terminal.span.rows }
                    : { cols: 1, rows: 1 };
                const origin: TerminalOrigin =
                  terminal.origin === "agent" ? "agent" : "user";

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
                    span,
                    starred: terminal.starred === true,
                    status: normalizeTerminalStatus(terminal.status),
                    title: terminal.title,
                    type: normalizeTerminalType(terminal.type),
                  },
                ];
              })
            : [];

          return [
            {
              collapsed: worktree.collapsed === true,
              id: worktree.id,
              name: worktree.name,
              path: worktree.path,
              position: normalizePosition(worktree.position),
              terminals,
            },
          ];
        })
      : [];

    return [
      {
        collapsed: project.collapsed === true,
        id: project.id,
        name: project.name,
        path: project.path,
        position: normalizePosition(project.position),
        worktrees,
        zIndex: typeof project.zIndex === "number" ? project.zIndex : 0,
      },
    ];
  });
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

  return {
    version: 1,
    browserCards:
      browserCardsSource as LegacyWorkspaceSnapshot["browserCards"],
    drawings: drawingsSource as LegacyWorkspaceSnapshot["drawings"],
    projects: normalizeProjectsFocus(migrateProjects(projectsSource)).projects,
    viewport: normalizeViewport(value.viewport),
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
    const span =
      isRecord(t.span) &&
      typeof t.span.cols === "number" &&
      typeof t.span.rows === "number"
        ? { cols: t.span.cols, rows: t.span.rows }
        : { cols: 1, rows: 1 };
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
          sessionId:
            typeof t.sessionId === "string" ? t.sessionId : undefined,
          span,
          starred: t.starred === true,
          status: normalizeTerminalStatus(t.status),
          title: t.title,
          type: normalizeTerminalType(t.type),
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

  const projects = normalizeProjectsFocus(migrateProjects(projectRecords)).projects;

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
      console.error("[snapshotBridge] failed to parse workspace snapshot:", error);
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
