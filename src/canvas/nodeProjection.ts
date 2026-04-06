import type { Node } from "@xyflow/react";
import {
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";
import { getRenderableWorktreeSize } from "./sceneState";
import type { ProjectData } from "../types";
import { getProjectBounds } from "../stores/projectStore";
import { getVisibleWorktreeSpans } from "../utils/worktreeLayout";

export interface ProjectNodeData {
  projectId: string;
  [key: string]: unknown;
}

export interface WorktreeNodeData {
  projectId: string;
  worktreeId: string;
  [key: string]: unknown;
}

export type CanvasFlowNodeData = ProjectNodeData | WorktreeNodeData;
export type CanvasFlowNode =
  | Node<ProjectNodeData, "project">
  | Node<WorktreeNodeData, "worktree">;

export function projectNodeId(projectId: string) {
  return `project:${projectId}`;
}

export function worktreeNodeId(worktreeId: string) {
  return `worktree:${worktreeId}`;
}

export function buildCanvasFlowNodes(projects: ProjectData[]): CanvasFlowNode[] {
  return projects.flatMap((project) => {
    const projectBounds = getProjectBounds(project);
    const projectNode: CanvasFlowNode = {
      id: projectNodeId(project.id),
      type: "project",
      position: {
        x: project.position.x,
        y: project.position.y,
      },
      data: {
        projectId: project.id,
      },
      className: "tc-flow-node tc-flow-project",
      style: {
        width: projectBounds.w,
        height: projectBounds.h,
      },
      width: projectBounds.w,
      height: projectBounds.h,
      draggable: true,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      dragHandle: ".tc-project-drag-handle",
      zIndex: project.zIndex ?? 0,
      ariaLabel: `Project ${project.name}`,
    };

    const worktreeNodes: CanvasFlowNode[] = project.worktrees.map((worktree) => {
      const baseSize = getRenderableWorktreeSize(worktree);
      return {
        id: worktreeNodeId(worktree.id),
        type: "worktree",
        position: {
          x: PROJ_PAD + worktree.position.x,
          y: PROJ_TITLE_H + PROJ_PAD + worktree.position.y,
        },
        parentId: projectNode.id,
        data: {
          projectId: project.id,
          worktreeId: worktree.id,
        },
        className: "tc-flow-node tc-flow-worktree",
        style: {
          width: baseSize.w,
          height: baseSize.h,
        },
        width: baseSize.w,
        height: baseSize.h,
        hidden: project.collapsed,
        draggable: true,
        selectable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        dragHandle: ".tc-worktree-drag-handle",
        zIndex: (project.zIndex ?? 0) + 1,
        ariaLabel: `Worktree ${worktree.name}`,
      };
    });

    return [projectNode, ...worktreeNodes];
  });
}
