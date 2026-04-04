
import { HandoffManager } from "./manager.ts";
import type { Handoff } from "./types.ts";

export function createPlannerToImplementerHandoff(
  workspaceRoot: string,
  workflowId: string,
  task: string,
): Handoff {
  const manager = new HandoffManager(workspaceRoot);

  return manager.create({
    workflow_id: workflowId,
    from: {
      role: "planner",
      agent_type: "claude",
      agent_id: "claude-session-1",
    },
    to: {
      role: "implementer",
      agent_type: "codex",
      agent_id: null,
    },
    task: {
      type: "implement-feature",
      title: task,
      description: `实现功能: ${task}`,
      acceptance_criteria: [
        "功能完整实现",
        "测试通过",
        "代码符合规范",
      ],
    },
    context: {
      files: [],
      previous_handoffs: [],
    },
    max_retries: 2,
  });
}
