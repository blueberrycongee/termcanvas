import path from "node:path";
import type { ProjectScanner } from "../electron/project-scanner.ts";
import {
  generateId,
  type ProjectData,
  type ProjectStore,
} from "./project-store.ts";

type ScannedProject = NonNullable<ReturnType<ProjectScanner["scan"]>>;

function buildProjectData(scanned: ScannedProject): ProjectData {
  return {
    id: generateId(),
    name: scanned.name,
    path: scanned.path,
    position: { x: 0, y: 0 },
    collapsed: false,
    zIndex: 0,
    worktrees: scanned.worktrees.map((worktree, index) => ({
      id: generateId(),
      name: worktree.branch,
      path: worktree.path,
      position: { x: 0, y: index * 400 },
      collapsed: false,
      terminals: [],
    })),
  };
}

export function ensureProjectTracked(input: {
  projectStore: ProjectStore;
  projectScanner: ProjectScanner;
  repoPath: string;
  onMutation?: () => void;
}): {
  project: ProjectData;
  created: boolean;
  worktrees: number;
} {
  const repoPath = path.resolve(input.repoPath);
  const scanned = input.projectScanner.scan(repoPath);
  if (!scanned) {
    throw Object.assign(new Error("Not a git repository"), { status: 400 });
  }

  const existing = input.projectStore.findProjectByPath(scanned.path);
  if (existing) {
    input.projectStore.syncWorktrees(existing.path, scanned.worktrees);
    input.onMutation?.();
    return {
      project: input.projectStore.getProjectById(existing.id) ?? existing,
      created: false,
      worktrees: scanned.worktrees.length,
    };
  }

  const project = buildProjectData(scanned);
  input.projectStore.addProject(project);
  input.onMutation?.();
  return {
    project,
    created: true,
    worktrees: project.worktrees.length,
  };
}

export function rescanTrackedProject(input: {
  projectStore: ProjectStore;
  projectScanner: ProjectScanner;
  projectId: string;
  onMutation?: () => void;
}): {
  project: ProjectData;
  worktrees: number;
} {
  const project = input.projectStore.getProjectById(input.projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found"), { status: 404 });
  }

  const worktrees = input.projectScanner.listWorktrees(project.path);
  input.projectStore.syncWorktrees(project.path, worktrees);
  input.onMutation?.();

  return {
    project: input.projectStore.getProjectById(project.id) ?? project,
    worktrees: worktrees.length,
  };
}
