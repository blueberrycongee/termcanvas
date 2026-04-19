import { HydraError } from "./errors.ts";
import { getRuntime } from "./runtime/index.ts";
import type { WorkbenchRecord } from "./workflow-store.ts";

// Lead guard: every Lead-facing operation (dispatch, watch, approve,
// reset, complete, fail, etc.) must verify that the calling terminal
// matches the workbench's lead_terminal_id. This enforces single-Lead
// semantics and prevents accidental cross-terminal interference.
//
// The lead id source depends on the active runtime:
//   - TermCanvas: TERMCANVAS_TERMINAL_ID from the owning terminal.
//   - Standalone: HYDRA_LEAD_ID or a stable synthesized id persisted to
//     ~/.hydra/standalone/lead-id.

export function getCurrentTerminalId(): string | undefined {
  return getRuntime().getCurrentLeadId();
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
