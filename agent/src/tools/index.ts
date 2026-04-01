import type { ToolRegistry } from "../tool.ts";
import { canvasStateTool } from "./canvas-state.ts";
import { diffTool } from "./diff.ts";
import { telemetryTool } from "./telemetry.ts";
import { projectTool } from "./project.ts";
import { worktreeTool } from "./worktree.ts";
import { terminalTool } from "./terminal.ts";
import { hydraWorkflowTool } from "./hydra-workflow.ts";
import { hydraAgentTool } from "./hydra-agent.ts";
import { browseTool } from "./browse.ts";

export function registerAllTools(registry: ToolRegistry): void {
  registry.register(canvasStateTool);
  registry.register(diffTool);
  registry.register(telemetryTool);
  registry.register(projectTool);
  registry.register(worktreeTool);
  registry.register(terminalTool);
  registry.register(hydraWorkflowTool);
  registry.register(hydraAgentTool);
  registry.register(browseTool);
}
