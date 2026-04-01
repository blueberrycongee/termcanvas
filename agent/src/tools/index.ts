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
import { readFileTool } from "./read-file.ts";
import { globFileTool } from "./glob-file.ts";
import { grepFileTool } from "./grep-file.ts";

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
  registry.register(readFileTool);
  registry.register(globFileTool);
  registry.register(grepFileTool);
}
