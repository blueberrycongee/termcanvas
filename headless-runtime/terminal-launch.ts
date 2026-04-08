import type { PtyManager } from "../electron/pty-manager.ts";
import type { TelemetryService } from "../electron/telemetry-service.ts";
import type { ServerEventBus } from "./event-bus.ts";
import type { ProjectStore, TerminalType } from "./project-store.ts";

interface CliLaunchConfig {
  shell: string;
  autoApproveArgs?: string[];
  promptArgs?: (prompt: string) => string[];
}

export const CLI_LAUNCH: Partial<Record<TerminalType, CliLaunchConfig>> = {
  claude: {
    shell: "claude",
    autoApproveArgs: ["--dangerously-skip-permissions"],
  },
  codex: {
    shell: "codex",
    autoApproveArgs: ["--dangerously-bypass-approvals-and-sandbox"],
  },
  kimi: {
    shell: "kimi",
    promptArgs: (prompt) => ["--prompt", prompt],
  },
  gemini: { shell: "gemini" },
  opencode: { shell: "opencode" },
  lazygit: { shell: "lazygit" },
  tmux: { shell: "tmux" },
};

export interface TerminalLaunchDeps {
  projectStore: ProjectStore;
  ptyManager: PtyManager;
  telemetryService: TelemetryService;
  eventBus?: ServerEventBus;
  onMutation?: () => void;
}

export interface LaunchTrackedTerminalOptions extends TerminalLaunchDeps {
  worktree: string;
  type: TerminalType;
  prompt?: string;
  autoApprove?: boolean;
  parentTerminalId?: string;
  workflowId?: string;
  assignmentId?: string;
  repoPath?: string;
}

export async function launchTrackedTerminal(
  options: LaunchTrackedTerminalOptions,
): Promise<{
  id: string;
  type: TerminalType;
  title: string;
  projectId: string;
  worktreeId: string;
}> {
  const found = options.projectStore.findWorktree(options.worktree);
  if (!found) {
    throw Object.assign(new Error("Worktree not found on canvas"), {
      status: 404,
    });
  }

  const terminal = options.projectStore.addTerminal(
    found.projectId,
    found.worktreeId,
    options.type,
    options.prompt,
    options.autoApprove,
    options.parentTerminalId,
  );

  const launchConfig = CLI_LAUNCH[options.type];
  const ptyOptions: {
    cwd: string;
    shell?: string;
    args?: string[];
    terminalId: string;
    terminalType: string;
  } = {
    cwd: options.worktree,
    terminalId: terminal.id,
    terminalType: options.type,
  };

  if (launchConfig) {
    const args: string[] = [];
    if (options.autoApprove && launchConfig.autoApproveArgs) {
      args.push(...launchConfig.autoApproveArgs);
    }
    if (options.prompt) {
      if (launchConfig.promptArgs) {
        args.push(...launchConfig.promptArgs(options.prompt));
      } else {
        args.push(options.prompt);
      }
    }
    ptyOptions.shell = launchConfig.shell;
    ptyOptions.args = args;
  }

  const ptyId = await options.ptyManager.create(ptyOptions);
  const pid = options.ptyManager.getPid(ptyId);

  options.projectStore.updateTerminalPtyId(
    found.projectId,
    found.worktreeId,
    terminal.id,
    ptyId,
  );
  options.projectStore.updateTerminalStatus(
    found.projectId,
    found.worktreeId,
    terminal.id,
    "running",
  );

  options.telemetryService.registerTerminal({
    terminalId: terminal.id,
    worktreePath: options.worktree,
    provider:
      options.type === "claude" || options.type === "codex"
        ? options.type
        : "unknown",
    workflowId: options.workflowId,
    assignmentId: options.assignmentId,
    repoPath: options.repoPath,
    ptyId,
    shellPid: pid ?? null,
  });
  options.telemetryService.recordPtyCreated({
    terminalId: terminal.id,
    ptyId,
    shellPid: pid ?? null,
  });

  options.ptyManager.onData(ptyId, (data: string) => {
    options.ptyManager.captureOutput(ptyId, data);
    options.telemetryService.recordPtyOutputByPtyId(ptyId, data);
    options.eventBus?.emit("terminal_output", {
      terminalId: terminal.id,
      chunk: data,
    });
  });

  options.ptyManager.onExit(ptyId, (exitCode: number) => {
    const status = exitCode === 0 ? "success" : "error";
    options.telemetryService.recordPtyExitByPtyId(ptyId, exitCode);
    options.projectStore.updateTerminalStatus(
      found.projectId,
      found.worktreeId,
      terminal.id,
      status,
    );
    options.onMutation?.();
    options.eventBus?.emit("terminal_status_changed", {
      terminalId: terminal.id,
      status,
      exitCode,
    });
  });

  options.onMutation?.();
  options.eventBus?.emit("terminal_status_changed", {
    terminalId: terminal.id,
    status: "running",
  });
  options.eventBus?.emit("terminal_created", {
    terminalId: terminal.id,
    type: terminal.type,
  });

  return {
    id: terminal.id,
    type: terminal.type,
    title: terminal.title,
    projectId: found.projectId,
    worktreeId: found.worktreeId,
  };
}

export function destroyTrackedTerminal(
  options: TerminalLaunchDeps & { terminalId: string },
): { ok: boolean } {
  const terminal = options.projectStore.getTerminal(options.terminalId);
  if (!terminal) {
    throw Object.assign(new Error("Terminal not found"), { status: 404 });
  }

  if (terminal.ptyId) {
    options.ptyManager.destroy(terminal.ptyId);
  }
  options.projectStore.removeTerminal(
    terminal.projectId,
    terminal.worktreeId,
    options.terminalId,
  );
  options.onMutation?.();
  options.eventBus?.emit("terminal_destroyed", {
    terminalId: options.terminalId,
    type: terminal.type,
  });
  return { ok: true };
}
