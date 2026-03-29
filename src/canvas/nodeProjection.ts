import type { Node } from "@xyflow/react";
import {
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
  getWorktreeSize,
  packTerminals,
} from "../layout";
import type { ProjectData } from "../types";
import { getProjectBounds } from "../stores/projectStore";

export interface FocusOverride {
  terminalId: string;
  w: number;
  h: number;
}

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

export function buildCanvasFlowNodes(projects: ProjectData[], focus?: FocusOverride | null): CanvasFlowNode[] {
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
      const spans = worktree.terminals.map((terminal) => terminal.span);
      const baseSize = getWorktreeSize(spans, worktree.collapsed);
      let size = baseSize;

      if (focus && !worktree.collapsed) {
        const fi = worktree.terminals.findIndex((t) => t.id === focus.terminalId && t.focused);
        if (fi >= 0) {
          const packed = packTerminals(spans);
          const item = packed[fi];
          if (item) {
            size = {
              w: Math.max(baseSize.w, item.x + focus.w + WT_PAD * 2 + 16),
              h: Math.max(baseSize.h, WT_TITLE_H + WT_PAD + item.y + focus.h + WT_PAD),
            };
          }
        }
      }

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
          width: size.w,
          height: size.h,
        },
        width: size.w,
        height: size.h,
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
