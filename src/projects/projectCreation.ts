import { generateId, useProjectStore } from "../stores/projectStore";
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

export function createProjectFromScan(info: ScannedProjectInfo): ProjectData {
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

export function addProjectAndFocusFirstWorktree(
  project: ProjectData,
): ProjectData {
  const { addProject, setFocusedWorktree } = useProjectStore.getState();
  addProject(project);
  const firstWorktree = project.worktrees[0];
  if (firstWorktree) {
    setFocusedWorktree(project.id, firstWorktree.id);
  }
  return project;
}

export function addScannedProjectAndFocus(
  info: ScannedProjectInfo,
): ProjectData {
  const project = createProjectFromScan(info);
  return addProjectAndFocusFirstWorktree(project);
}

export function addDefaultTerminalProject(homePath: string): ProjectData {
  const project: ProjectData = {
    id: generateId(),
    name: "~",
    path: homePath,
    worktrees: [
      {
        id: generateId(),
        name: "~",
        path: homePath,
        terminals: [],
      },
    ],
  };
  return addProjectAndFocusFirstWorktree(project);
}

export function ensureTerminalCreationTarget(homePath: string): {
  projectId: string;
  worktreeId: string;
} | null {
  const { focusedProjectId, focusedWorktreeId, projects } =
    useProjectStore.getState();
  if (focusedProjectId && focusedWorktreeId) {
    return {
      projectId: focusedProjectId,
      worktreeId: focusedWorktreeId,
    };
  }

  if (projects.length > 0) {
    return null;
  }

  const project = addDefaultTerminalProject(homePath);
  const worktree = project.worktrees[0];
  if (!worktree) {
    return null;
  }

  return {
    projectId: project.id,
    worktreeId: worktree.id,
  };
}
