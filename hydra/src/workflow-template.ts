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
  plannerAgentType: AgentType;
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
            agent_type: input.plannerAgentType,
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
          agent_type: input.plannerAgentType,
          agent_id: "hydra-run",
        },
        to: {
          role: "planner",
          agent_type: input.plannerAgentType,
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
          agent_type: input.plannerAgentType,
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
            "You are a senior engineer performing a thorough evaluation. Passing CI is the bare minimum — the implementer should have already ensured that. Your job is to catch what CI cannot.",
            "",
            "Start by running the test suite and build to establish a baseline. If either fails, stop and report immediately. But when CI passes, your real work begins:",
            "",
            "1. **Intent alignment** — Does the implementation actually solve the requested task? Compare the planner spec against what was built. Flag gaps, misinterpretations, or partial implementations that technically compile but miss the point.",
            "2. **Interaction quality** — For UI work: is the flow intuitive and responsive? For APIs: is the interface clean and consistent? For CLI tools: are commands discoverable? Think as an end user, not a compiler.",
            "3. **Implementation honesty** — Look for stub functions, empty catch blocks, hardcoded values standing in for real logic, TODO/FIXME left as actual behavior, and mock implementations disguised as production code.",
            "4. **Code health** — Is the code maintainable and easy to reason about? Flag over-engineering (unnecessary abstractions, premature generalization), under-engineering (copy-paste duplication, magic numbers), and poor naming that obscures intent.",
            "5. **Test quality** — Are tests exercising real behavior or just chasing coverage? Flag dead tests that assert nothing meaningful, tests that validate mocks instead of the system, and overly brittle tests coupled to implementation details rather than contracts.",
            "6. **Architectural fit** — Do the changes respect the existing codebase patterns? New code should look like it belongs, not like a foreign transplant.",
            "",
            `If blocking issues remain, set success=false and hand off back to ${implementerId}.`,
            `If the work passes evaluation, set success=true and next_action.type=complete.`,
            "Include a `verification` object in result.json reporting what you checked at each tier so the implementer can act on specific findings.",
          ].join("\n"),
          acceptance_criteria: [
            "Run the test suite and build as a baseline — report immediately if either fails",
            "Evaluate whether the implementation fulfills the original task intent, not just whether it compiles",
            "Flag stub implementations, empty handlers, and mock code pretending to be real",
            "Assess test quality — dead tests, tautological assertions, and mock-only tests are defects",
            "Report issues with concrete evidence (file paths, code snippets, command output)",
            `Use next_action.handoff_id=${implementerId} when issues must go back to implementation`,
          ],
          skills: ["requesting-code-review", "verification-before-completion"],
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
