/**
 * Approval bridge — policy-based auto-approve and escalation for worker permissions.
 *
 * Detects workers awaiting permission, evaluates against policy,
 * and either auto-approves (read-only) or escalates to the user.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalPolicy = "auto_readonly" | "ask_all" | "auto_all";

export interface PendingApproval {
  terminalId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  isReadOnly: boolean;
  timestamp: number;
}

export interface ApprovalDecision {
  action: "approve" | "reject";
  reason: string;
}

export interface ApprovalBridge {
  detectPendingApprovals(): Promise<PendingApproval[]>;
  deliverDecision(terminalId: string, decision: ApprovalDecision): Promise<void>;
  policy: ApprovalPolicy;
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

export function evaluateApproval(
  pending: PendingApproval,
  policy: ApprovalPolicy,
): ApprovalDecision | "escalate" {
  switch (policy) {
    case "auto_all":
      return { action: "approve", reason: "Auto-approved by auto_all policy" };

    case "ask_all":
      return "escalate";

    case "auto_readonly":
      if (pending.isReadOnly) {
        return { action: "approve", reason: `Auto-approved: ${pending.toolName} is read-only` };
      }
      return "escalate";
  }
}
