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
  outcome: "complete" | "advance" | "loop" | "fail" | "await_approval";
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
            "You are a senior architect. Before proposing any solution, you must first understand the problem space. Users often give vague or incomplete descriptions — your job is to discover what actually needs to change.",
            "",
            `Task: ${input.task}`,
            "",
            "Your output MUST contain these three sections in order:",
            "",
            "## Problems Found",
            "Investigate the current codebase and list concrete problems you discover — not just what the user described, but what you find through systematic examination. Look for:",
            "- Anti-patterns (dead code paths, unreachable states, misleading interfaces)",
            "- Inconsistencies (naming, structure, behavior that contradicts conventions)",
            "- Regression risks (fragile dependencies, broken invariants)",
            "- Missing functionality the user likely expects but didn't explicitly request",
            "",
            "## Constraints",
            "Convert your findings into verifiable rules that the implementer must follow and the evaluator can check. Each constraint should be a concrete, testable statement — not a vague guideline. Examples: 'no UI element may lead to an empty state', 'every state transition must have a visual indicator ≥150ms', 'existing API contracts must not change'.",
            "",
            "## Implementation Plan",
            "List the concrete steps to execute under the above constraints. Each step should reference which problems it solves and which constraints it must satisfy.",
            "",
            `Hand off to ${implementerId} once the plan is concrete and actionable.`,
          ].join("\n"),
          acceptance_criteria: [
            "List specific problems discovered through investigation, not just restated from the task",
            "Define verifiable constraints derived from the problems found",
            "Provide implementation steps that reference which problems and constraints they address",
            "Call out regression risks and how to mitigate them",
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
            "1. **Constraint verification** — Read the planner's Constraints section. Verify each constraint with concrete evidence. A constraint without a verification result is an incomplete evaluation.",
            "2. **Problem resolution** — Read the planner's Problems Found section. Verify each problem was actually addressed by the implementation, not just worked around or ignored.",
            "3. **Regression check** — Review the git diff. For each changed file, verify that existing functionality in that area still works. Regressions in unchanged behavior are blocking defects.",
            "4. **Implementation honesty** — Look for stub functions, empty catch blocks, hardcoded values standing in for real logic, TODO/FIXME left as actual behavior, and mock implementations disguised as production code.",
            "5. **Code health** — Is the code maintainable and easy to reason about? Flag over-engineering (unnecessary abstractions, premature generalization), under-engineering (copy-paste duplication, magic numbers), and poor naming that obscures intent.",
            "6. **New anti-patterns** — Did the implementation introduce problems that didn't exist before? An improvement that creates new issues is not an improvement.",
            "",
            `If blocking issues remain, set success=false and hand off back to ${implementerId}.`,
            `If the work passes evaluation, set success=true and next_action.type=complete.`,
            "Include a `verification` object in result.json reporting what you checked at each tier so the implementer can act on specific findings.",
          ].join("\n"),
          acceptance_criteria: [
            "Run the test suite and build as a baseline — report immediately if either fails",
            "Verify every constraint from the planner's Constraints section with evidence",
            "Verify every problem from the planner's Problems Found section was addressed",
            "Check git diff for regressions in each changed file's existing functionality",
            "Flag any new anti-patterns introduced by the changes",
            "Report issues with concrete evidence (file paths, code snippets, command output)",
            `Use next_action.handoff_id=${implementerId} when issues must go back to implementation`,
          ],
          skills: ["qa", "requesting-code-review", "verification-before-completion"],
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
  options?: { approvePlan?: boolean },
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
    if (currentIndex === 0 && options?.approvePlan) {
      return {
        outcome: "await_approval",
        nextHandoffId: handoffIds[1],
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
