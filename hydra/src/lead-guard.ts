import { HydraError } from "./errors.ts";
import type { WorkflowRecord } from "./workflow-store.ts";

// Lead guard: every Lead-facing operation (dispatch, watch, approve,
// reset, complete, fail, etc.) must verify that the calling terminal
// matches the workflow's lead_terminal_id. This enforces single-Lead
// semantics and prevents accidental cross-terminal interference.

export function getCurrentTerminalId(): string | undefined {
  return process.env.TERMCANVAS_TERMINAL_ID;
}

export function ensureLeadCaller(workflow: WorkflowRecord): void {
  const callerId = getCurrentTerminalId();
  if (!callerId) {
    // No TERMCANVAS_TERMINAL_ID — caller is outside TermCanvas. Allow this
    // for tooling/scripts; the workflow's lead_terminal_id is informational.
    // If we want strict enforcement, change this to throw.
    return;
  }
  if (callerId !== workflow.lead_terminal_id) {
    throw new HydraError(
      `Workflow ${workflow.id} is owned by terminal ${workflow.lead_terminal_id}; ` +
      `current terminal is ${callerId}. Only the Lead terminal may operate on this workflow.`,
      {
        errorCode: "WORKFLOW_NOT_LEAD",
        stage: "lead_guard",
        ids: { workflow_id: workflow.id },
      },
    );
  }
}
