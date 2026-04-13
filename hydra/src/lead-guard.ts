import { HydraError } from "./errors.ts";
import type { WorkbenchRecord } from "./workflow-store.ts";

// Lead guard: every Lead-facing operation (dispatch, watch, approve,
// reset, complete, fail, etc.) must verify that the calling terminal
// matches the workbench's lead_terminal_id. This enforces single-Lead
// semantics and prevents accidental cross-terminal interference.

export function getCurrentTerminalId(): string | undefined {
  return process.env.TERMCANVAS_TERMINAL_ID;
}

export function ensureLeadCaller(workbench: WorkbenchRecord): void {
  const callerId = getCurrentTerminalId();
  if (!callerId) {
    // No TERMCANVAS_TERMINAL_ID — caller is outside TermCanvas. Allow this
    // for tooling/scripts; the workbench's lead_terminal_id is informational.
    // If we want strict enforcement, change this to throw.
    return;
  }
  if (callerId !== workbench.lead_terminal_id) {
    throw new HydraError(
      `Workbench ${workbench.id} is owned by terminal ${workbench.lead_terminal_id}; ` +
      `current terminal is ${callerId}. Only the Lead terminal may operate on this workbench.`,
      {
        errorCode: "WORKBENCH_NOT_LEAD",
        stage: "lead_guard",
        ids: { workbench_id: workbench.id },
      },
    );
  }
}
