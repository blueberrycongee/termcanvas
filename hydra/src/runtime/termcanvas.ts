import * as tc from "../termcanvas.ts";
import type {
  HydraRuntime,
  RuntimeTelemetrySnapshot,
  RuntimeTerminalRef,
  RuntimeTerminalStatus,
  TerminalCreateOptions,
} from "./types.ts";

/**
 * Adapter over the existing TermCanvas CLI wrapper. Preserves the
 * desktop / headless-server behavior bit-for-bit — this class just
 * re-exposes the old module functions under the HydraRuntime interface so
 * standalone and TC paths can be swapped without touching call sites.
 */
export class TermCanvasRuntime implements HydraRuntime {
  readonly name = "termcanvas" as const;

  isAvailable(): boolean {
    return tc.isTermCanvasRunning();
  }

  getCurrentLeadId(): string | undefined {
    return process.env.TERMCANVAS_TERMINAL_ID;
  }

  ensureProjectTracked(repoPath: string): { id: string; path: string } {
    return tc.ensureProjectTracked(repoPath);
  }

  syncProject(repoPath: string): void {
    const project = tc.findProjectByPath(repoPath);
    if (project) {
      tc.projectRescan(project.id);
    } else {
      tc.ensureProjectTracked(repoPath);
    }
  }

  findProjectByPath(repoPath: string): { id: string; path: string } | null {
    return tc.findProjectByPath(repoPath);
  }

  terminalCreate(options: TerminalCreateOptions): RuntimeTerminalRef {
    return tc.terminalCreate(
      options.worktreePath,
      options.type,
      options.prompt,
      options.autoApprove,
      options.parentTerminalId,
      options.workbenchId,
      options.assignmentId,
      options.repoPath,
      options.resumeSessionId,
    );
  }

  terminalStatus(terminalId: string): RuntimeTerminalStatus {
    return tc.terminalStatus(terminalId);
  }

  terminalDestroy(terminalId: string): void {
    tc.terminalDestroy(terminalId);
  }

  telemetryTerminal(terminalId: string): RuntimeTelemetrySnapshot | null {
    try {
      const snapshot = tc.telemetryTerminal(terminalId);
      return (snapshot ?? null) as RuntimeTelemetrySnapshot | null;
    } catch {
      return null;
    }
  }
}
