import {
  buildIssueBody,
  buildSnapshot,
  type ReportIssueResult,
} from "../../shared/diagnostics-snapshot";
import { collectRendererSnapshot } from "./diagnosticsSnapshot";

const DEFAULT_TITLE = "Bug: ";

export async function triggerReportIssue(): Promise<ReportIssueResult> {
  const diagnostics = window.termcanvas?.diagnostics;
  if (!diagnostics?.collectMainSnapshot || !diagnostics.openReportIssue) {
    return {
      outcome: "error",
      errorMessage: "diagnostics IPC unavailable",
    };
  }

  try {
    const main = await diagnostics.collectMainSnapshot();
    const renderer = collectRendererSnapshot();
    const snapshot = buildSnapshot(main, renderer);
    const body = buildIssueBody(snapshot);
    return await diagnostics.openReportIssue({
      title: DEFAULT_TITLE,
      body,
    });
  } catch (error) {
    return {
      outcome: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
