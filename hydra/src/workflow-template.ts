import path from "node:path";
import type { WorkflowFailure } from "./workflow-store.ts";
import type { AgentType, Handoff } from "./handoff/types.ts";
import type { ResultContract } from "./protocol.ts";
import { buildTaskPackageDir } from "./task-package.ts";
import { getWorkflowDir } from "./workflow-store.ts";

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
  outcome: "complete" | "advance" | "loop" | "fail" | "await_approval" | "intent_confirmation";
  nextHandoffId?: string;
  requeueHandoffIds?: string[];
  failure?: WorkflowFailure;
}

function resultFile(repoPath: string, workflowId: string, handoffId: string): string {
  return path.join(buildTaskPackageDir(repoPath, workflowId, handoffId), "result.json");
}

export function researchBriefFile(
  repoPath: string,
  workflowId: string,
  handoffId: string,
): string {
  return path.join(buildTaskPackageDir(repoPath, workflowId, handoffId), "research-brief.md");
}

export function implementationBriefFile(
  repoPath: string,
  workflowId: string,
  handoffId: string,
): string {
  return path.join(buildTaskPackageDir(repoPath, workflowId, handoffId), "implementation-brief.md");
}

export function verificationBriefFile(
  repoPath: string,
  workflowId: string,
  handoffId: string,
): string {
  return path.join(buildTaskPackageDir(repoPath, workflowId, handoffId), "verification-brief.md");
}

export function approvalRequestFile(
  repoPath: string,
  workflowId: string,
  handoffId: string,
): string {
  return path.join(buildTaskPackageDir(repoPath, workflowId, handoffId), "approval-request.md");
}

export function approvedResearchResultFile(
  repoPath: string,
  workflowId: string,
): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "approved-research.json");
}

export function approvedResearchBriefFile(
  repoPath: string,
  workflowId: string,
): string {
  return path.join(getWorkflowDir(repoPath, workflowId), "approved-research-brief.md");
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

  const [researcherId, implementerId, testerId] = input.handoffIds;
  const approvedResearchResult = approvedResearchResultFile(input.repoPath, input.workflowId);
  const approvedResearchBrief = approvedResearchBriefFile(input.repoPath, input.workflowId);
  const implementerResult = resultFile(input.repoPath, input.workflowId, implementerId);
  const implementationBrief = implementationBriefFile(input.repoPath, input.workflowId, implementerId);
  const testerResult = resultFile(input.repoPath, input.workflowId, testerId);
  const testerBrief = verificationBriefFile(input.repoPath, input.workflowId, testerId);
  const researcherBrief = researchBriefFile(input.repoPath, input.workflowId, researcherId);
  const researcherApprovalRequest = approvalRequestFile(input.repoPath, input.workflowId, researcherId);

  return {
    template: input.template,
    startHandoffId: researcherId,
    handoffs: [
      {
        id: researcherId,
        from: {
          role: "researcher",
          agent_type: input.plannerAgentType,
          agent_id: "hydra-run",
        },
        to: {
          role: "researcher",
          agent_type: input.plannerAgentType,
          agent_id: null,
        },
        task: {
          type: "workflow-research",
          title: `Research: ${input.task.slice(0, 68)}`,
          description: [
            "You are the workflow researcher. Your job is to define the real problem before implementation begins.",
            "",
            `Task: ${input.task}`,
            "",
            "Investigate the current codebase, architecture, and affected components. Determine whether the system can support this work directly or whether structural technical debt changes the strategy.",
            "",
            `Write your structured handoff brief to ${researcherBrief}.`,
            `If you discover a blocker that would require a user-approved strategy change, also write ${researcherApprovalRequest}.`,
            `When the research handoff is complete, point next_action.handoff_id to ${implementerId}; Hydra will pause for user approval before implementation starts.`,
          ].join("\n"),
          acceptance_criteria: [
            "Produce research-brief.md with Intent, Success Criteria, Current Reality, Problems Found, Architecture & Component Impact, Structural Risks / Technical Debt, Constraints, Unknowns / Assumptions, Verification Focus, Recommended Direction, and Decision",
            "Investigate the impacted architecture and component boundaries instead of restating the task",
            "Call out structural blockers that would require user confirmation before implementation",
            "Keep the result actionable for the implementer and tester",
            `Write ${path.basename(researcherBrief)} before finishing`,
            `Use next_action.handoff_id=${implementerId} when the research handoff is complete`,
          ],
          skills: ["writing-plans"],
        },
        context: {
          files: [],
          previous_handoffs: [],
          shared_state: {
            downstream_handoff_id: implementerId,
            approved_research_result_file: approvedResearchResult,
            approved_research_brief_file: approvedResearchBrief,
            research_brief_file: researcherBrief,
            approval_request_file: researcherApprovalRequest,
          },
        },
      },
      {
        id: implementerId,
        from: {
          role: "researcher",
          agent_type: input.plannerAgentType,
          agent_id: researcherId,
        },
        to: {
          role: "implementer",
          agent_type: input.implementerAgentType,
          agent_id: null,
        },
        task: {
          type: "workflow-implementation",
          title: `Implement: ${input.task.slice(0, 66)}`,
          description: [
            "Implement the task using only the approved research snapshot as the controlling input.",
            `Primary task: ${input.task}`,
            `Read the approved research result at ${approvedResearchResult} and the approved research brief at ${approvedResearchBrief}.`,
            `Write your implementation handoff brief to ${implementationBrief}.`,
            `If the approved research assumptions fail in the real code, set success=true, replan=true, and hand off back to ${researcherId}.`,
            `When implementation is ready for verification, hand off to ${testerId}.`,
          ].join("\n"),
          acceptance_criteria: [
            "Implement the requested change without test hacking",
            "Use the approved research snapshot as the controlling brief",
            "If research assumptions fail, surface a replan instead of forcing a broken implementation",
            `Write ${path.basename(implementationBrief)} before finishing`,
            `Use next_action.handoff_id=${testerId} when verification should start`,
            `Use next_action.handoff_id=${researcherId} with replan=true when the approved research is no longer valid`,
          ],
          skills: ["test-driven-development", "verification-before-completion"],
        },
        context: {
          files: [
            approvedResearchResult,
            approvedResearchBrief,
            testerResult,
            testerBrief,
          ],
          previous_handoffs: [researcherId, testerId],
          shared_state: {
            downstream_handoff_id: testerId,
            approved_research_result_file: approvedResearchResult,
            approved_research_brief_file: approvedResearchBrief,
            tester_result_file: testerResult,
            verification_brief_file: testerBrief,
            implementation_brief_file: implementationBrief,
            replan_handoff_id: researcherId,
          },
        },
      },
      {
        id: testerId,
        from: {
          role: "implementer",
          agent_type: input.implementerAgentType,
          agent_id: implementerId,
        },
        to: {
          role: "tester",
          agent_type: input.evaluatorAgentType,
          agent_id: null,
        },
        task: {
          type: "workflow-verification",
          title: `Verify: ${input.task.slice(0, 68)}`,
          description: [
            "You are the workflow tester. Validate the implementation against the approved research snapshot and the actual code changes.",
            "",
            "Start with the baseline checks (tests/build/runtime). Then verify the approved constraints, regression risks, and the implementer's claims with concrete evidence.",
            "",
            `Read the approved research result at ${approvedResearchResult}, the approved research brief at ${approvedResearchBrief}, the implementer result at ${implementerResult}, and the implementation brief at ${implementationBrief}.`,
            `Write your verification handoff brief to ${testerBrief}.`,
            `If blocking issues remain, set success=true and hand off to ${implementerId}.`,
            `If the work passes verification, set success=true and hand off to ${researcherId} for intent confirmation.`,
          ].join("\n"),
          acceptance_criteria: [
            "Run baseline verification before declaring success",
            "Check the implementation against the approved constraints and verification focus",
            "Verify regressions in the changed areas with evidence",
            "Compare implementer claims with code/runtime reality",
            `Write ${path.basename(testerBrief)} before finishing`,
            "Include a verification object in result.json",
            `Use next_action.handoff_id=${implementerId} when issues must go back to implementation`,
            `Use next_action.handoff_id=${researcherId} when verification passes and intent confirmation should start`,
          ],
          skills: ["qa", "requesting-code-review", "verification-before-completion"],
        },
        context: {
          files: [
            approvedResearchResult,
            approvedResearchBrief,
            implementerResult,
            implementationBrief,
          ],
          previous_handoffs: [researcherId, implementerId],
          shared_state: {
            remediation_handoff_id: implementerId,
            intent_confirmation_handoff_id: researcherId,
            approved_research_result_file: approvedResearchResult,
            approved_research_brief_file: approvedResearchBrief,
            implementer_result_file: implementerResult,
            implementation_brief_file: implementationBrief,
            verification_brief_file: testerBrief,
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
  result: Pick<ResultContract, "success" | "summary" | "next_action" | "replan">,
  options?: { currentTaskType?: string },
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

  const [researcherId, implementerId, testerId] = handoffIds;
  const currentTaskType = options?.currentTaskType;

  if (currentIndex === 0) {
    if (currentTaskType === "workflow-intent-confirmation") {
      if (!result.success) {
        return {
          outcome: "fail",
          failure: {
            code: "WORKFLOW_INTENT_CONFIRMATION_FAILED",
            message: result.summary,
            stage: "workflow.template",
          },
        };
      }

      if (result.next_action.type === "complete") {
        return { outcome: "complete" };
      }

      const requested = result.next_action.handoff_id;
      if (result.next_action.type !== "handoff" || !requested) {
        return {
          outcome: "fail",
          failure: {
            code: "WORKFLOW_INVALID_INTENT_CONFIRMATION_ACTION",
            message: "Intent confirmation must either complete or hand off to implementer/researcher.",
            stage: "workflow.template",
          },
        };
      }

      if (requested === researcherId) {
        if (result.replan !== true) {
          return {
            outcome: "fail",
            failure: {
              code: "WORKFLOW_INVALID_REPLAN_SIGNAL",
              message: "Intent confirmation may only hand off back to researcher when replan=true.",
              stage: "workflow.template",
            },
          };
        }
        return {
          outcome: "loop",
          nextHandoffId: researcherId,
          requeueHandoffIds: [researcherId, implementerId, testerId],
        };
      }

      if (requested === implementerId) {
        if (result.replan === true) {
          return {
            outcome: "fail",
            failure: {
              code: "WORKFLOW_INVALID_REPLAN_SIGNAL",
              message: "Intent confirmation cannot send work back to implementer with replan=true.",
              stage: "workflow.template",
            },
          };
        }
        return {
          outcome: "loop",
          nextHandoffId: implementerId,
          requeueHandoffIds: [implementerId, testerId],
        };
      }

      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_INTENT_CONFIRMATION_TARGET",
          message: `Intent confirmation attempted to hand off to unexpected target: ${requested}`,
          stage: "workflow.template",
        },
      };
    }

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

    if (result.next_action.type !== "handoff") {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_RESEARCHER_ACTION",
          message: "Researcher must hand off to implementer before approval.",
          stage: "workflow.template",
        },
      };
    }

    const researcherTarget = result.next_action.handoff_id;
    if (researcherTarget !== implementerId) {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_RESEARCHER_TARGET",
          message: `Researcher attempted to hand off to unexpected target: ${researcherTarget ?? "<none>"}`,
          stage: "workflow.template",
        },
      };
    }

    return {
      outcome: "await_approval",
      nextHandoffId: implementerId,
    };
  }

  if (currentIndex === 1) {
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

    const requested = result.next_action.handoff_id;
    if (requested === researcherId) {
      if (result.replan !== true) {
        return {
          outcome: "fail",
          failure: {
            code: "WORKFLOW_INVALID_REPLAN_SIGNAL",
            message: "Implementer may only hand off to researcher when replan=true.",
            stage: "workflow.template",
          },
        };
      }
      return {
        outcome: "loop",
        nextHandoffId: researcherId,
        requeueHandoffIds: [researcherId, implementerId],
      };
    }

    if (result.next_action.type !== "handoff") {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_IMPLEMENTER_ACTION",
          message: "Implementer must hand off either to tester or back to researcher.",
          stage: "workflow.template",
        },
      };
    }

    const implementerTarget = requested ?? testerId;
    if (implementerTarget !== testerId) {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_IMPLEMENTER_TARGET",
          message: `Implementer attempted to hand off to unexpected target: ${implementerTarget}`,
          stage: "workflow.template",
        },
      };
    }

    return {
      outcome: "advance",
      nextHandoffId: testerId,
    };
  }

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

  if (result.next_action.type !== "handoff") {
    return {
      outcome: "fail",
      failure: {
        code: "WORKFLOW_INVALID_TESTER_ACTION",
        message: "Tester must hand off either to implementer or back to researcher for intent confirmation.",
        stage: "workflow.template",
      },
    };
  }

  const testerTarget = result.next_action.handoff_id;
  if (testerTarget === implementerId) {
    return {
      outcome: "loop",
      nextHandoffId: implementerId,
      requeueHandoffIds: [implementerId, testerId],
    };
  }

  if (testerTarget === researcherId) {
    if (result.replan === true) {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_TESTER_REPLAN",
          message: "Tester cannot trigger a replan directly; it must hand off to researcher for intent confirmation.",
          stage: "workflow.template",
        },
      };
    }
    return {
      outcome: "intent_confirmation",
      nextHandoffId: researcherId,
      requeueHandoffIds: [researcherId],
    };
  }

  return {
    outcome: "fail",
    failure: {
      code: "WORKFLOW_INVALID_TESTER_TARGET",
      message: `Tester attempted to hand off to unexpected target: ${testerTarget}`,
      stage: "workflow.template",
    },
  };
}
