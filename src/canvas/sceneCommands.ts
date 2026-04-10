import { useNotificationStore } from "../stores/notificationStore";
import { generateId, useProjectStore } from "../stores/projectStore";
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
    const terminals = project.worktrees.flatMap((w) =>
      w.terminals.filter((t) => !t.stashed),
    );
    if (terminals.length === 0) continue;
    const maxRight = Math.max(...terminals.map((t) => t.x + t.width));
    placeX = Math.max(placeX, maxRight + gap);
  }

  return placeX;
}

function buildProjectFromScan(
  info: NonNullable<ProjectScanResult>,
): ProjectData {
  return {
    id: generateId(),
    name: info.name,
    path: info.path,
    worktrees: info.worktrees.map((worktree) => ({
      id: generateId(),
      name: worktree.branch,
      path: worktree.path,
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
  _options: { bringToFront?: boolean } = {},
) {
  useProjectStore.getState().clearFocus();
  useSelectionStore.getState().selectProject(projectId);
}

export function activateWorktreeInScene(
  projectId: string,
  worktreeId: string,
  _options: { bringToFront?: boolean } = {},
) {
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
  const project = buildProjectFromScan(info);
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
