import { useEffect } from "react";
import type { TerminalData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import {
  destroyTerminalRuntime,
  ensureTerminalRuntime,
  updateTerminalRuntime,
} from "./terminalRuntimeStore";

interface Props {
  projectId: string;
  terminal: TerminalData;
  worktreeId: string;
  worktreePath: string;
}

export function TerminalRuntimeHandle({
  projectId,
  terminal,
  worktreeId,
  worktreePath,
}: Props) {
  useEffect(() => {
    ensureTerminalRuntime({
      projectId,
      terminal,
      worktreeId,
      worktreePath,
    });

    return () => {
      const isStashed = useProjectStore
        .getState()
        .projects.some((project) =>
          project.worktrees.some((worktree) =>
            worktree.terminals.some(
              (candidate) =>
                candidate.id === terminal.id && candidate.stashed,
            ),
          ),
        );
      if (!isStashed) {
        destroyTerminalRuntime(terminal.id);
      }
    };
  }, [projectId, terminal.id, worktreeId, worktreePath]);

  useEffect(() => {
    updateTerminalRuntime({
      projectId,
      terminal,
      worktreeId,
      worktreePath,
    });
  }, [projectId, terminal, worktreeId, worktreePath]);

  return null;
}
