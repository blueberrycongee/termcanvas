import path from "node:path";
import type { WorkflowFailure } from "./workflow-store.ts";
import type { AgentType, Handoff } from "./handoff/types.ts";
import { buildTaskPackageDir } from "./task-package.ts";

export type WorkflowTemplateName = "single-step" | "planner-implementer-evaluator";

export interface WorkflowTemplatePlanHandoff {
  id: string;
  from: Handoff["from"];
  to: Handoff["to"];
  task: Handoff["task"];
  context: Handoff["context"];
}

export interface WorkflowTemplatePlan {
  template: WorkflowTemplateName;
  handoffs: WorkflowTemplatePlanHandoff[];
  startHandoffId: string;
}

export interface BuildWorkflowTemplatePlanInput {
  template: WorkflowTemplateName;
  workflowId: string;
  task: string;
  implementerAgentType: AgentType;
  evaluatorAgentType: AgentType;
  repoPath: string;
  handoffIds: string[];
}

export interface TemplateAdvanceDecision {
  outcome: "complete" | "advance" | "loop" | "fail";
  nextHandoffId?: string;
  requeueHandoffIds?: string[];
  failure?: WorkflowFailure;
}

function resultFile(repoPath: string, workflowId: string, handoffId: string): string {
  return path.join(buildTaskPackageDir(repoPath, workflowId, handoffId), "result.json");
}

export function buildWorkflowTemplatePlan(
  input: BuildWorkflowTemplatePlanInput,
): WorkflowTemplatePlan {
  if (input.template === "single-step") {
    const [handoffId] = input.handoffIds;
    return {
      template: input.template,
      startHandoffId: handoffId,
      handoffs: [
        {
          id: handoffId,
          from: {
            role: "planner",
            agent_type: "claude",
            agent_id: "hydra-run",
          },
          to: {
            role: "implementer",
            agent_type: input.implementerAgentType,
            agent_id: null,
          },
          task: {
            type: "code-change-task",
            title: input.task.slice(0, 80),
            description: input.task,
            acceptance_criteria: [
              "Write result.json and done",
              "Provide evidence for the outcome",
            ],
          },
          context: {
            files: [],
            previous_handoffs: [],
            shared_state: {},
          },
        },
      ],
    };
  }

  const [plannerId, implementerId, evaluatorId] = input.handoffIds;
  const plannerResult = resultFile(input.repoPath, input.workflowId, plannerId);
  const implementerResult = resultFile(input.repoPath, input.workflowId, implementerId);
  const evaluatorResult = resultFile(input.repoPath, input.workflowId, evaluatorId);

  return {
    template: input.template,
    startHandoffId: plannerId,
    handoffs: [
      {
        id: plannerId,
        from: {
          role: "planner",
          agent_type: "claude",
          agent_id: "hydra-run",
        },
        to: {
          role: "planner",
          agent_type: "claude",
          agent_id: null,
        },
        task: {
          type: "workflow-plan",
          title: `Plan: ${input.task.slice(0, 72)}`,
          description: [
            "Produce an execution plan for the requested task.",
            `Task: ${input.task}`,
            `Hand off to ${implementerId} once the plan is concrete and actionable.`,
          ].join("\n"),
          acceptance_criteria: [
            "Identify the concrete implementation steps",
            "Call out major risks and constraints",
            `Use next_action.handoff_id=${implementerId} when implementation should start`,
          ],
          skills: ["writing-plans"],
        },
        context: {
          files: [],
          previous_handoffs: [],
          shared_state: {
            downstream_handoff_id: implementerId,
          },
        },
      },
      {
        id: implementerId,
        from: {
          role: "planner",
          agent_type: "claude",
          agent_id: plannerId,
        },
        to: {
          role: "implementer",
          agent_type: input.implementerAgentType,
          agent_id: null,
        },
        task: {
          type: "workflow-implementation",
          title: `Implement: ${input.task.slice(0, 68)}`,
          description: [
            "Implement the requested task using the planner output as the controlling plan.",
            `Primary task: ${input.task}`,
            `The evaluator findings file may appear at ${evaluatorResult}; if it exists, treat it as mandatory remediation input.`,
            `Hand off to ${evaluatorId} when the implementation and evidence are ready.`,
          ].join("\n"),
          acceptance_criteria: [
            "Implement the planned changes without test hacking",
            "Leave concrete evidence for the evaluator",
            `Use next_action.handoff_id=${evaluatorId} when evaluation should start`,
          ],
          skills: ["test-driven-development", "verification-before-completion"],
        },
        context: {
          files: [plannerResult, evaluatorResult],
          previous_handoffs: [plannerId, evaluatorId],
          shared_state: {
            downstream_handoff_id: evaluatorId,
            planner_result_file: plannerResult,
            evaluator_result_file: evaluatorResult,
          },
        },
      },
      {
        id: evaluatorId,
        from: {
          role: "implementer",
          agent_type: input.implementerAgentType,
          agent_id: implementerId,
        },
        to: {
          role: "evaluator",
          agent_type: input.evaluatorAgentType,
          agent_id: null,
        },
        task: {
          type: "workflow-evaluation",
          title: `Evaluate: ${input.task.slice(0, 70)}`,
          description: [
            "Evaluate the implementation against the original task and the planner output.",
            "You must explicitly list vulnerabilities/risks/unmet standards instead of giving a subjective approval.",
            `If blocking issues remain, set success=false and hand off back to ${implementerId}.`,
            `If the work meets the bar, set success=true and next_action.type=complete.`,
          ].join("\n"),
          acceptance_criteria: [
            "Report vulnerabilities/risks/unmet standards explicitly",
            "Do not write a subjective approval-only summary",
            `Use next_action.handoff_id=${implementerId} when issues must go back to implementation`,
          ],
          skills: ["requesting-code-review"],
        },
        context: {
          files: [plannerResult, implementerResult],
          previous_handoffs: [plannerId, implementerId],
          shared_state: {
            remediation_handoff_id: implementerId,
            planner_result_file: plannerResult,
            implementer_result_file: implementerResult,
          },
        },
      },
    ],
  };
}

export function resolveTemplateAdvance(
  template: WorkflowTemplateName,
  handoffIds: string[],
  currentHandoffId: string,
  result: { success: boolean; summary: string; next_action: { type: string; handoff_id?: string } },
): TemplateAdvanceDecision {
  if (template === "single-step") {
    if (result.success) {
      return { outcome: "complete" };
    }
    return {
      outcome: "fail",
      failure: {
        code: "WORKFLOW_RESULT_UNSUCCESSFUL",
        message: result.summary,
        stage: "workflow.collect",
      },
    };
  }

  const currentIndex = handoffIds.indexOf(currentHandoffId);
  if (currentIndex === -1) {
    return {
      outcome: "fail",
      failure: {
        code: "WORKFLOW_UNKNOWN_HANDOFF",
        message: `Unknown handoff: ${currentHandoffId}`,
        stage: "workflow.template",
      },
    };
  }

  if (currentIndex < 2) {
    if (!result.success) {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_TEMPLATE_STAGE_FAILED",
          message: result.summary,
          stage: "workflow.template",
        },
      };
    }
    return {
      outcome: "advance",
      nextHandoffId: handoffIds[currentIndex + 1],
    };
  }

  if (result.success) {
    return { outcome: "complete" };
  }

  const implementerId = handoffIds[1];
  const requested = result.next_action.handoff_id ?? implementerId;
  if (requested !== implementerId) {
    return {
      outcome: "fail",
      failure: {
        code: "WORKFLOW_INVALID_EVALUATOR_LOOP",
        message: `Evaluator attempted to hand off to unexpected target: ${requested}`,
        stage: "workflow.template",
      },
    };
  }

  return {
    outcome: "loop",
    nextHandoffId: implementerId,
    requeueHandoffIds: [implementerId, handoffIds[2]],
  };
}
