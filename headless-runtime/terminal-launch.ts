import type { PtyManager } from "../electron/pty-manager.ts";
import type { TelemetryService } from "../electron/telemetry-service.ts";
import type { ServerEventBus } from "./event-bus.ts";
import type { ProjectStore, TerminalType } from "./project-store.ts";

/**
 * CLI adapter for a single terminal type. Centralizes everything we know
 * about how to invoke a particular CLI: its shell binary, what flags to pass
 * for auto-approve / resume / model selection, and how to deliver the prompt.
 *
 * Methods (rather than optional fields) keep the call sites uniform — they
 * just spread the result. Adapters that don't support a capability return [].
 *
 * `supportsModel()` is the capability query the dispatcher uses to validate
 * that a role's `model` pin is actually deliverable to the spawned CLI
 * before the worker is launched.
 */
export interface CliAdapter {
  shell: string;
  supportsModel(): boolean;
  autoApproveArgs(): string[];
  resumeArgs(sessionId: string): string[];
  modelArgs(model: string): string[];
  promptArgs(prompt: string): string[];
}

const defaultPromptArgs = (prompt: string): string[] => [prompt];

const CLAUDE_ADAPTER: CliAdapter = {
  shell: "claude",
  supportsModel: () => true,
  autoApproveArgs: () => ["--dangerously-skip-permissions"],
  resumeArgs: (sessionId) => ["--resume", sessionId],
  modelArgs: (model) => ["--model", model],
  promptArgs: defaultPromptArgs,
};

const CODEX_ADAPTER: CliAdapter = {
  shell: "codex",
  supportsModel: () => true,
  autoApproveArgs: () => ["--dangerously-bypass-approvals-and-sandbox"],
  resumeArgs: () => [],
  modelArgs: (model) => ["-m", model],
  promptArgs: defaultPromptArgs,
};

// Non-Hydra terminal types — kept here so termcanvas can still spawn them
// directly. They do not participate in the role registry, so supportsModel
// and modelArgs are stubbed out.
const KIMI_ADAPTER: CliAdapter = {
  shell: "kimi",
  supportsModel: () => false,
  autoApproveArgs: () => [],
  resumeArgs: () => [],
  modelArgs: () => [],
  promptArgs: (prompt) => ["--prompt", prompt],
};

function makeBareAdapter(shell: string): CliAdapter {
  return {
    shell,
    supportsModel: () => false,
    autoApproveArgs: () => [],
    resumeArgs: () => [],
    modelArgs: () => [],
    promptArgs: defaultPromptArgs,
  };
}

export const CLI_LAUNCH: Partial<Record<TerminalType, CliAdapter>> = {
  claude: CLAUDE_ADAPTER,
  codex: CODEX_ADAPTER,
  kimi: KIMI_ADAPTER,
  gemini: makeBareAdapter("gemini"),
  opencode: makeBareAdapter("opencode"),
  lazygit: makeBareAdapter("lazygit"),
  tmux: makeBareAdapter("tmux"),
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
  // Resume the agent's prior session — only honored by agent types whose
  // adapter implements resumeArgs (currently claude).
  resumeSessionId?: string;
  // Pin the model for this launch — passed to adapter.modelArgs(). Only
  // honored when the adapter's supportsModel() returns true.
  model?: string;
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
    if (options.model && !launchConfig.supportsModel()) {
      throw Object.assign(
        new Error(
          `Terminal type "${options.type}" does not support model selection (requested model: ${options.model}).`,
        ),
        { status: 400 },
      );
    }
    const args: string[] = [];
    if (options.autoApprove) {
      args.push(...launchConfig.autoApproveArgs());
    }
    if (options.model) {
      args.push(...launchConfig.modelArgs(options.model));
    }
    if (options.resumeSessionId) {
      args.push(...launchConfig.resumeArgs(options.resumeSessionId));
    }
    if (options.prompt) {
      args.push(...launchConfig.promptArgs(options.prompt));
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
