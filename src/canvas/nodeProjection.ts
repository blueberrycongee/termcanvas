import type { Node } from "@xyflow/react";
import type { ProjectData } from "../types";

export interface TerminalNodeData {
  terminalId: string;
  projectId: string;
  worktreeId: string;
  projectName: string;
  [key: string]: unknown;
}

export type CanvasFlowNode = Node<TerminalNodeData, "terminal">;

export function buildCanvasFlowNodes(
  projects: ProjectData[],
  positionOverrides?: Map<string, { x: number; y: number }>,
): CanvasFlowNode[] {
  const nodes: CanvasFlowNode[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        const position = positionOverrides?.get(terminal.id);
        nodes.push({
          id: terminal.id,
          type: "terminal",
          position: position
            ? { x: position.x, y: position.y }
            : { x: terminal.x, y: terminal.y },
          data: {
            terminalId: terminal.id,
            projectId: project.id,
            worktreeId: worktree.id,
            projectName: project.name,
          },
          style: {
            width: terminal.width,
            height: terminal.minimized ? undefined : terminal.height,
          },
          draggable: true,
          selectable: true,
        });
      }
    }
  }
  return nodes;
}
