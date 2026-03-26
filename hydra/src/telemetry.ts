import { isTermCanvasRunning, telemetryWorkflow } from "./termcanvas.ts";
import type { WorkflowStatusView } from "./workflow.ts";

export interface HydraStatusWithTelemetry extends WorkflowStatusView {
  telemetry: unknown | null;
}

interface WorkflowTelemetryDeps {
  isTermCanvasRunning(): boolean;
  telemetryWorkflow(workflowId: string, repoPath: string): unknown;
}

const DEFAULT_DEPS: WorkflowTelemetryDeps = {
  isTermCanvasRunning,
  telemetryWorkflow,
};

export function enrichWorkflowStatusView(
  view: WorkflowStatusView,
  deps: WorkflowTelemetryDeps = DEFAULT_DEPS,
): HydraStatusWithTelemetry {
  if (!deps.isTermCanvasRunning()) {
    return {
      ...view,
      telemetry: null,
    };
  }

  try {
    return {
      ...view,
      telemetry: deps.telemetryWorkflow(view.workflow.id, view.workflow.repo_path),
    };
  } catch {
    return {
      ...view,
      telemetry: null,
    };
  }
}
