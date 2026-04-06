import { useNotificationStore } from "../stores/notificationStore";
import {
  generateId,
  getProjectBounds,
  useProjectStore,
} from "../stores/projectStore";
import { useSelectionStore } from "../stores/selectionStore";
import type { ProjectData, TermCanvasAPI } from "../types";

type ProjectScanResult = Awaited<ReturnType<TermCanvasAPI["project"]["scan"]>>;

interface SceneTranslator {
  error_dir_picker: (error: unknown) => string;
  error_scan: (error: unknown) => string;
  info_added_project: (name: string, worktreeCount: number) => string;
}

interface AddProjectOptions {
  notifyAdded?: boolean;
}

function getNextProjectX(projects: ProjectData[]): number {
  let placeX = 0;
  const gap = 80;

  for (const project of projects) {
    const bounds = getProjectBounds(project);
    placeX = Math.max(placeX, bounds.x + bounds.w + gap);
  }

  return placeX;
}

function buildProjectFromScan(
  info: NonNullable<ProjectScanResult>,
  positionX: number,
): ProjectData {
  return {
    id: generateId(),
    name: info.name,
    path: info.path,
    position: { x: positionX, y: 0 },
    collapsed: false,
    zIndex: 0,
    worktrees: info.worktrees.map((worktree, index) => ({
      id: generateId(),
      name: worktree.branch,
      path: worktree.path,
      position: { x: 0, y: index * 360 },
      collapsed: false,
      terminals: [],
    })),
  };
}

async function scanProjectDirectory(
  dirPath: string,
  t: SceneTranslator,
): Promise<NonNullable<ProjectScanResult> | null> {
  if (!window.termcanvas) {
    return null;
  }

  const { notify } = useNotificationStore.getState();

  let info: ProjectScanResult;
  try {
    info = await window.termcanvas.project.scan(dirPath);
  } catch (error) {
    notify("error", t.error_scan(error));
    return null;
  }

  if (!info) {
    notify("error", t.error_scan("Failed to scan directory"));
    return null;
  }

  return info;
}

export function clearSceneFocusAndSelection() {
  useProjectStore.getState().clearFocus();
  useSelectionStore.getState().clearSelection();
}

export function activateProjectInScene(
  projectId: string,
  options: { bringToFront?: boolean } = {},
) {
  if (options.bringToFront) {
    useProjectStore.getState().bringToFront(projectId);
  }

  useProjectStore.getState().clearFocus();
  useSelectionStore.getState().selectProject(projectId);
}

export function activateWorktreeInScene(
  projectId: string,
  worktreeId: string,
  options: { bringToFront?: boolean } = {},
) {
  if (options.bringToFront) {
    useProjectStore.getState().bringToFront(projectId);
  }

  useProjectStore.getState().setFocusedWorktree(projectId, worktreeId);
  useSelectionStore.getState().selectWorktree(projectId, worktreeId);
}

export async function addProjectFromDirectoryPath(
  dirPath: string,
  t: SceneTranslator,
  options: AddProjectOptions = {},
): Promise<ProjectData | null> {
  const info = await scanProjectDirectory(dirPath, t);
  if (!info) {
    return null;
  }

  const { projects, addProject } = useProjectStore.getState();
  const project = buildProjectFromScan(info, getNextProjectX(projects));
  addProject(project);

  if (options.notifyAdded) {
    useNotificationStore
      .getState()
      .notify("info", t.info_added_project(info.name, info.worktrees.length));
  }

  return project;
}

export async function promptAndAddProjectToScene(
  t: SceneTranslator,
  options: AddProjectOptions = {},
): Promise<ProjectData | null> {
  if (!window.termcanvas) {
    return null;
  }

  const { notify } = useNotificationStore.getState();

  let dirPath: string | null;
  try {
    dirPath = await window.termcanvas.project.selectDirectory();
  } catch (error) {
    notify("error", t.error_dir_picker(error));
    return null;
  }

  if (!dirPath) {
    return null;
  }

  return addProjectFromDirectoryPath(dirPath, t, options);
}
