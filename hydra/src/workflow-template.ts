import fs from "node:fs";
import path from "node:path";
import type { RunTaskSpec } from "./run-task.ts";
import {
  getRunApprovalRequestFile,
  getRunBriefFile,
  getRunResultFile,
  getWorkflowRevisionRequestPath,
  getWorkflowUserRequestPath,
} from "./layout.ts";
import type { AssignmentRecord, AssignmentRole, AgentType } from "./assignment/types.ts";
import type { ApprovedArtifactRef, WorkflowFailure, WorkflowRecord } from "./workflow-store.ts";
import type { WorkflowResultContract } from "./protocol.ts";

export type WorkflowTemplateName = "single-step" | "researcher-implementer-tester";

export interface WorkflowTemplatePlanAssignment {
  id: string;
  role: AssignmentRole;
  kind: AssignmentRecord["kind"];
  from_assignment_id: string | null;
  requested_agent_type: AgentType;
}

export interface WorkflowTemplatePlan {
  template: WorkflowTemplateName;
  assignments: WorkflowTemplatePlanAssignment[];
  startAssignmentId: string;
}

export interface BuildWorkflowTemplatePlanInput {
  template: WorkflowTemplateName;
  workflowId: string;
  task: string;
  researcherAgentType: AgentType;
  implementerAgentType: AgentType;
  testerAgentType: AgentType;
  repoPath: string;
  assignmentIds: string[];
}

export interface TemplateAdvanceDecision {
  outcome: "complete" | "advance" | "loop" | "fail" | "await_approval" | "intent_confirmation";
  nextAssignmentId?: string;
  requeueAssignmentIds?: string[];
  failure?: WorkflowFailure;
}

function latestRun(assignment: AssignmentRecord): AssignmentRecord["runs"][number] | null {
  if (assignment.runs.length === 0) return null;
  const active = assignment.active_run_id
    ? assignment.runs.find((run) => run.id === assignment.active_run_id)
    : null;
  return active ?? assignment.runs[assignment.runs.length - 1] ?? null;
}

function requireApprovedResearch(workflow: WorkflowRecord): ApprovedArtifactRef {
  const approved = workflow.approved_refs?.research;
  if (!approved) {
    throw new Error(`Workflow ${workflow.id} is missing approved research refs`);
  }
  return approved;
}

function runBriefFile(
  workflow: WorkflowRecord,
  assignmentId: string,
  runId: string,
): string {
  return getRunBriefFile(workflow.repo_path, workflow.id, assignmentId, runId);
}

function runApprovalRequestFile(
  workflow: WorkflowRecord,
  assignmentId: string,
  runId: string,
): string {
  return getRunApprovalRequestFile(workflow.repo_path, workflow.id, assignmentId, runId);
}

function runResultFile(
  workflow: WorkflowRecord,
  assignmentId: string,
  runId: string,
): string {
  return getRunResultFile(workflow.repo_path, workflow.id, assignmentId, runId);
}

export function workflowUserRequestFile(
  repoPath: string,
  workflowId: string,
): string {
  return getWorkflowUserRequestPath(repoPath, workflowId);
}

export function assignmentRequiresBrief(kind: AssignmentRecord["kind"]): boolean {
  return kind === "research"
    || kind === "research_replan"
    || kind === "implementation"
    || kind === "verification";
}

export function buildWorkflowTemplatePlan(
  input: BuildWorkflowTemplatePlanInput,
): WorkflowTemplatePlan {
  if (input.template === "single-step") {
    const [assignmentId] = input.assignmentIds;
    return {
      template: input.template,
      startAssignmentId: assignmentId,
      assignments: [
        {
          id: assignmentId,
          role: "implementer",
          kind: "single_step",
          from_assignment_id: null,
          requested_agent_type: input.implementerAgentType,
        },
      ],
    };
  }

  const [researcherId, implementerId, testerId] = input.assignmentIds;
  return {
    template: input.template,
    startAssignmentId: researcherId,
    assignments: [
      {
        id: researcherId,
        role: "researcher",
        kind: "research",
        from_assignment_id: null,
        requested_agent_type: input.researcherAgentType,
      },
      {
        id: implementerId,
        role: "implementer",
        kind: "implementation",
        from_assignment_id: researcherId,
        requested_agent_type: input.implementerAgentType,
      },
      {
        id: testerId,
        role: "tester",
        kind: "verification",
        from_assignment_id: implementerId,
        requested_agent_type: input.testerAgentType,
      },
    ],
  };
}

export interface BuildAssignmentTaskSpecInput {
  workflow: WorkflowRecord;
  assignment: AssignmentRecord;
  assignmentsById: Map<string, AssignmentRecord>;
  runId: string;
}

export function buildAssignmentTaskSpec(
  input: BuildAssignmentTaskSpecInput,
): RunTaskSpec {
  const { workflow, assignment, assignmentsById, runId } = input;
  const userRequest = workflowUserRequestFile(workflow.repo_path, workflow.id);
  const briefFile = runBriefFile(workflow, assignment.id, runId);
  const approvalRequestFile = runApprovalRequestFile(workflow, assignment.id, runId);
  const resultFile = runResultFile(workflow, assignment.id, runId);
  const sourceAssignment = assignment.from_assignment_id
    ? assignmentsById.get(assignment.from_assignment_id) ?? null
    : null;
  const sourceRole = sourceAssignment?.role ?? (assignment.kind === "single_step" ? "orchestrator" : null);

  const readFiles: RunTaskSpec["readFiles"] = [
    { label: "User request", path: userRequest },
  ];
  const revisionRequest = getWorkflowRevisionRequestPath(workflow.repo_path, workflow.id);
  if (
    fs.existsSync(revisionRequest)
    && (assignment.kind === "research" || assignment.kind === "research_replan")
  ) {
    readFiles.push({ label: "Revision request", path: revisionRequest });
  }

  const writeTargets: RunTaskSpec["writeTargets"] = [];
  if (assignmentRequiresBrief(assignment.kind)) {
    writeTargets.push({
      label: "Brief",
      path: briefFile,
      note: "This is the main human-readable brief for the next stage.",
    });
  }
  if (assignment.kind === "research" || assignment.kind === "research_replan") {
    writeTargets.push({
      label: "Optional approval request",
      path: approvalRequestFile,
      note: "Write this only when the workflow should pause for user confirmation before implementation continues.",
    });
  }
  writeTargets.push({
    label: "Result JSON",
    path: resultFile,
    note: "Write this atomically after every required artifact is complete. Hydra advances only from this file.",
  });

  const commonCompletion = [
    assignmentRequiresBrief(assignment.kind)
      ? `Write ${path.basename(briefFile)} before publishing the result.`
      : "Publish the machine result only after you have finished the requested decision.",
    `Write ${path.basename(resultFile)} last, atomically, with schema_version=hydra/result/v1.`,
  ];

  switch (assignment.kind) {
    case "single_step":
      return {
        repoPath: workflow.repo_path,
        workflowId: workflow.id,
        assignmentId: assignment.id,
        runId,
        role: assignment.role,
        agentType: assignment.requested_agent_type,
        sourceRole,
        objective: [
          "Complete the requested change directly in the current worktree.",
          "",
          workflow.task,
        ],
        readFiles,
        writeTargets,
        decisionRules: [
          "- Solve the real implementation problem before changing tests or fixtures.",
          "- Do not fake success with silent fallbacks or placeholder outputs.",
          "- Use next_action.type=complete when the task is actually finished.",
        ],
        acceptanceCriteria: [
          "Complete the requested task honestly",
          "Provide evidence in result.json",
          ...commonCompletion,
        ],
        skills: [],
        extraSections: [],
      };
    case "research":
      return {
        repoPath: workflow.repo_path,
        workflowId: workflow.id,
        assignmentId: assignment.id,
        runId,
        role: assignment.role,
        agentType: assignment.requested_agent_type,
        sourceRole,
        objective: [
          "Turn the user request and current code reality into an actionable research brief.",
          "",
          `Task: ${workflow.task}`,
        ],
        readFiles,
        writeTargets,
        decisionRules: [
          "- Read the user request before forming any architecture conclusion.",
          "- Investigate the current codebase instead of restating the task.",
          `- When the work can proceed, use next_action.type=transition with assignment_id=${workflow.assignment_ids[1]}.`,
          "- If the strategy changes user-approved scope or prerequisites, also write approval-request.md.",
        ],
        acceptanceCriteria: [
          "Produce a research brief grounded in the current codebase",
          "Call out structural blockers, unknowns, and verification focus",
          `Use next_action.assignment_id=${workflow.assignment_ids[1]} when research is ready for implementation`,
          ...commonCompletion,
        ],
        skills: [],
        extraSections: [
          {
            title: "Research Strategy",
            lines: [
              "- Start from user-request.md, then confirm how the codebase changes the real problem.",
              "- Produce a brief that downstream implementer and tester can execute without re-reading the whole repo history.",
              "- Make constraints, risks, and validation focus explicit.",
            ],
          },
        ],
      };
    case "research_replan": {
      const approved = requireApprovedResearch(workflow);
      readFiles.push(
        { label: "Approved research brief", path: approved.brief_file },
        { label: "Approved research result", path: approved.result_file },
      );
      const implementer = assignmentsById.get(workflow.assignment_ids[1]);
      const tester = assignmentsById.get(workflow.assignment_ids[2]);
      const implementerRun = implementer ? latestRun(implementer) : null;
      const testerRun = tester ? latestRun(tester) : null;
      if (implementerRun) {
        readFiles.push(
          { label: "Implementation brief", path: runBriefFile(workflow, implementer!.id, implementerRun.id) },
          { label: "Implementation result", path: implementerRun.result_file },
        );
      }
      if (testerRun) {
        readFiles.push(
          { label: "Verification brief", path: runBriefFile(workflow, tester!.id, testerRun.id) },
          { label: "Verification result", path: testerRun.result_file },
        );
      }
      return {
        repoPath: workflow.repo_path,
        workflowId: workflow.id,
        assignmentId: assignment.id,
        runId,
        role: assignment.role,
        agentType: assignment.requested_agent_type,
        sourceRole,
        objective: [
          "Run a fresh research pass because the previously approved strategy no longer holds.",
          "",
          `Task: ${workflow.task}`,
        ],
        readFiles,
        writeTargets,
        decisionRules: [
          "- Treat the prior approved research as historical context, not binding truth.",
          "- Explain why the old frame failed before proposing the new path.",
          `- When replanning is complete, use next_action.type=transition with assignment_id=${workflow.assignment_ids[1]}.`,
          "- Write approval-request.md if the new direction changes scope, prerequisites, or task strategy.",
        ],
        acceptanceCriteria: [
          "Produce a fresh research brief rather than mutating the old one in place",
          "Explain why the prior approved strategy no longer holds",
          ...commonCompletion,
        ],
        skills: [],
        extraSections: [
          {
            title: "Research Strategy",
            lines: [
              "- Make the failure mode of the old plan explicit.",
              "- Carry forward only the evidence that still holds.",
              "- Keep the replanned brief executable for implementation and verification.",
            ],
          },
        ],
      };
    }
    case "implementation": {
      const approved = requireApprovedResearch(workflow);
      readFiles.push(
        { label: "Approved research brief", path: approved.brief_file },
        { label: "Approved research result", path: approved.result_file },
      );
      const tester = assignmentsById.get(workflow.assignment_ids[2]);
      const testerRun = tester ? latestRun(tester) : null;
      if (testerRun) {
        readFiles.push(
          { label: "Latest verification brief", path: runBriefFile(workflow, tester!.id, testerRun.id) },
          { label: "Latest verification result", path: testerRun.result_file },
        );
      }
      return {
        repoPath: workflow.repo_path,
        workflowId: workflow.id,
        assignmentId: assignment.id,
        runId,
        role: assignment.role,
        agentType: assignment.requested_agent_type,
        sourceRole,
        objective: [
          "Implement the requested change using the approved research as the controlling input.",
          "",
          `Task: ${workflow.task}`,
        ],
        readFiles,
        writeTargets,
        decisionRules: [
          "- Use the approved research and user request as controlling inputs.",
          "- If the approved assumptions fail in the real codebase, return a replan instead of forcing a brittle implementation.",
          `- Use next_action.type=transition with assignment_id=${workflow.assignment_ids[2]} when implementation is ready for verification.`,
          `- Use next_action.type=transition with assignment_id=${workflow.assignment_ids[0]} and replan=true when the approved research no longer holds.`,
        ],
        acceptanceCriteria: [
          "Implement the requested change without test hacking",
          "Keep the implementation brief focused on what changed, what remains risky, and what the tester should inspect next",
          ...commonCompletion,
        ],
        skills: [],
        extraSections: [
          {
            title: "Implementation Strategy",
            lines: [
              "- Treat the approved brief as the contract for what to build and what not to build.",
              "- Update code and tests honestly; do not fake success by weakening checks.",
              "- Use the brief to explain concrete code changes and open risks.",
            ],
          },
        ],
      };
    }
    case "verification": {
      const approved = requireApprovedResearch(workflow);
      const implementer = assignmentsById.get(workflow.assignment_ids[1]);
      if (!implementer) {
        throw new Error(`Workflow ${workflow.id} is missing implementer assignment metadata`);
      }
      const implementerRun = implementer ? latestRun(implementer) : null;
      if (!implementerRun) {
        throw new Error(`Workflow ${workflow.id} is missing an implementation run for verification`);
      }
      readFiles.push(
        { label: "Approved research brief", path: approved.brief_file },
        { label: "Approved research result", path: approved.result_file },
        { label: "Implementation brief", path: runBriefFile(workflow, implementer.id, implementerRun.id) },
        { label: "Implementation result", path: implementerRun.result_file },
      );
      return {
        repoPath: workflow.repo_path,
        workflowId: workflow.id,
        assignmentId: assignment.id,
        runId,
        role: assignment.role,
        agentType: assignment.requested_agent_type,
        sourceRole,
        objective: [
          "Independently validate the implementation against the approved research, actual code changes, and runtime evidence.",
          "",
          `Task: ${workflow.task}`,
        ],
        readFiles,
        writeTargets,
        decisionRules: [
          "- Form an independent judgment from code and runtime behavior before trusting the implementer's summary.",
          `- Use next_action.type=transition with assignment_id=${workflow.assignment_ids[1]} if blocking issues remain.`,
          `- Use next_action.type=transition with assignment_id=${workflow.assignment_ids[0]} when verification passes and intent confirmation should begin.`,
        ],
        acceptanceCriteria: [
          "Run baseline verification before declaring success",
          "Compare implementer claims with code/runtime reality",
          "Include a verification object in result.json",
          ...commonCompletion,
        ],
        skills: ["qa", "code-review"],
        extraSections: [
          {
            title: "Verification Strategy",
            lines: [
              "- Start with baseline checks first and stop early if they fail.",
              "- Verify the approved constraints, regression risks, and implementer claims with concrete evidence.",
              "- Treat discrepancies between code reality and the implementation brief as high-priority findings.",
            ],
          },
        ],
      };
    }
    case "intent_confirmation": {
      const approved = requireApprovedResearch(workflow);
      const implementer = assignmentsById.get(workflow.assignment_ids[1]);
      const tester = assignmentsById.get(workflow.assignment_ids[2]);
      if (!implementer || !tester) {
        throw new Error(`Workflow ${workflow.id} is missing implementation or verification assignment metadata`);
      }
      const implementerRun = latestRun(implementer);
      const testerRun = latestRun(tester);
      if (!implementerRun || !testerRun) {
        throw new Error(`Workflow ${workflow.id} is missing implementation or verification runs for intent confirmation`);
      }
      readFiles.push(
        { label: "Approved research brief", path: approved.brief_file },
        { label: "Approved research result", path: approved.result_file },
        { label: "Implementation brief", path: runBriefFile(workflow, implementer.id, implementerRun.id) },
        { label: "Implementation result", path: implementerRun.result_file },
        { label: "Verification brief", path: runBriefFile(workflow, tester.id, testerRun.id) },
        { label: "Verification result", path: testerRun.result_file },
      );
      return {
        repoPath: workflow.repo_path,
        workflowId: workflow.id,
        assignmentId: assignment.id,
        runId,
        role: assignment.role,
        agentType: assignment.requested_agent_type,
        sourceRole,
        objective: [
          "Decide whether the tested implementation still matches the approved research intent.",
          "",
          `Task: ${workflow.task}`,
        ],
        readFiles,
        writeTargets,
        decisionRules: [
          "- Do not redo the whole research pass. Make an intent decision.",
          "- Use next_action.type=complete when the workflow is genuinely ready to end.",
          `- Use next_action.type=transition with assignment_id=${workflow.assignment_ids[1]} when more implementation is needed under the same approved research.`,
          `- Use next_action.type=transition with assignment_id=${workflow.assignment_ids[0]} and replan=true when the approved frame must be rebuilt.`,
        ],
        acceptanceCriteria: [
          "Reach a concrete intent confirmation decision from the approved research plus implementation and verification evidence",
          "Use result.json to express complete, more implementation, or replan",
          ...commonCompletion,
        ],
        skills: [],
        extraSections: [
          {
            title: "Intent Confirmation",
            lines: [
              "- Compare approved intent against verified implementation, not against wishful summaries.",
              "- Distinguish 'same plan needs more implementation' from 'the approved frame is wrong'.",
            ],
          },
        ],
      };
    }
  }
}

export function resolveTemplateAdvance(
  template: WorkflowTemplateName,
  assignmentIds: string[],
  currentAssignmentId: string,
  result: Pick<WorkflowResultContract, "success" | "summary" | "next_action" | "replan">,
  options?: { currentKind?: AssignmentRecord["kind"] },
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

  const currentIndex = assignmentIds.indexOf(currentAssignmentId);
  if (currentIndex === -1) {
    return {
      outcome: "fail",
      failure: {
        code: "WORKFLOW_UNKNOWN_ASSIGNMENT",
        message: `Unknown assignment: ${currentAssignmentId}`,
        stage: "workflow.template",
      },
    };
  }

  const [researcherId, implementerId, testerId] = assignmentIds;
  const currentKind = options?.currentKind;

  if (currentIndex === 0) {
    if (currentKind === "intent_confirmation") {
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

      const requested = result.next_action.assignment_id;
      if (result.next_action.type !== "transition" || !requested) {
        return {
          outcome: "fail",
          failure: {
            code: "WORKFLOW_INVALID_INTENT_CONFIRMATION_ACTION",
            message: "Intent confirmation must either complete or transition to implementer/researcher.",
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
              message: "Intent confirmation may only return to researcher when replan=true.",
              stage: "workflow.template",
            },
          };
        }
        return {
          outcome: "loop",
          nextAssignmentId: researcherId,
          requeueAssignmentIds: [researcherId, implementerId, testerId],
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
          nextAssignmentId: implementerId,
          requeueAssignmentIds: [implementerId, testerId],
        };
      }

      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_INTENT_CONFIRMATION_TARGET",
          message: `Intent confirmation attempted to transition to unexpected target: ${requested}`,
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

    if (result.next_action.type !== "transition") {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_RESEARCHER_ACTION",
          message: "Researcher must transition to implementer before approval.",
          stage: "workflow.template",
        },
      };
    }

    if (result.next_action.assignment_id !== implementerId) {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_RESEARCHER_TARGET",
          message: `Researcher attempted to transition to unexpected target: ${result.next_action.assignment_id ?? "<none>"}`,
          stage: "workflow.template",
        },
      };
    }

    return {
      outcome: "await_approval",
      nextAssignmentId: implementerId,
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

    const requested = result.next_action.assignment_id;
    if (requested === researcherId) {
      if (result.replan !== true) {
        return {
          outcome: "fail",
          failure: {
            code: "WORKFLOW_INVALID_REPLAN_SIGNAL",
            message: "Implementer may only transition to researcher when replan=true.",
            stage: "workflow.template",
          },
        };
      }
      return {
        outcome: "loop",
        nextAssignmentId: researcherId,
        requeueAssignmentIds: [researcherId, implementerId],
      };
    }

    if (result.next_action.type !== "transition") {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_IMPLEMENTER_ACTION",
          message: "Implementer must transition either to tester or back to researcher.",
          stage: "workflow.template",
        },
      };
    }

    if ((requested ?? testerId) !== testerId) {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_IMPLEMENTER_TARGET",
          message: `Implementer attempted to transition to unexpected target: ${requested}`,
          stage: "workflow.template",
        },
      };
    }

    return {
      outcome: "advance",
      nextAssignmentId: testerId,
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

  if (result.next_action.type !== "transition") {
    return {
      outcome: "fail",
      failure: {
        code: "WORKFLOW_INVALID_TESTER_ACTION",
        message: "Tester must transition either to implementer or back to researcher for intent confirmation.",
        stage: "workflow.template",
      },
    };
  }

  const testerTarget = result.next_action.assignment_id;
  if (testerTarget === implementerId) {
    return {
      outcome: "loop",
      nextAssignmentId: implementerId,
      requeueAssignmentIds: [implementerId, testerId],
    };
  }

  if (testerTarget === researcherId) {
    if (result.replan === true) {
      return {
        outcome: "fail",
        failure: {
          code: "WORKFLOW_INVALID_TESTER_REPLAN",
          message: "Tester cannot trigger a replan directly; it must transition to researcher for intent confirmation.",
          stage: "workflow.template",
        },
      };
    }
    return {
      outcome: "intent_confirmation",
      nextAssignmentId: researcherId,
      requeueAssignmentIds: [researcherId],
    };
  }

  return {
    outcome: "fail",
    failure: {
      code: "WORKFLOW_INVALID_TESTER_TARGET",
      message: `Tester attempted to transition to unexpected target: ${testerTarget}`,
      stage: "workflow.template",
    },
  };
}
