import { getProjectBounds, generateId, useProjectStore } from "../stores/projectStore";
import type { ProjectData } from "../types";

interface ScannedWorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

interface ScannedProjectInfo {
  name: string;
  path: string;
  worktrees: ScannedWorktreeInfo[];
}

const PROJECT_GAP = 80;

export function getNextProjectPositionX(projects: ProjectData[]): number {
  let placeX = 0;
  for (const project of projects) {
    const bounds = getProjectBounds(project);
    placeX = Math.max(placeX, bounds.x + bounds.w + PROJECT_GAP);
  }
  return placeX;
}

export function createProjectFromScan(
  info: ScannedProjectInfo,
  placeX: number,
): ProjectData {
  return {
    id: generateId(),
    name: info.name,
    path: info.path,
    position: { x: placeX, y: 0 },
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

export function addProjectAndFocusFirstWorktree(project: ProjectData): ProjectData {
  const { addProject, setFocusedWorktree } = useProjectStore.getState();
  addProject(project);
  const firstWorktree = project.worktrees[0];
  if (firstWorktree) {
    setFocusedWorktree(project.id, firstWorktree.id);
  }
  return project;
}

export function addScannedProjectAndFocus(info: ScannedProjectInfo): ProjectData {
  const { projects } = useProjectStore.getState();
  const project = createProjectFromScan(info, getNextProjectPositionX(projects));
  return addProjectAndFocusFirstWorktree(project);
}
