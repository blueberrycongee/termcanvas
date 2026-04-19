import { useState, useCallback } from "react";

interface ToolCardProps {
  name: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  isDark: boolean;
  approval?: {
    requestId: string;
    sessionId: string;
  };
  onApprove?: (sessionId: string, requestId: string) => void;
  onDeny?: (sessionId: string, requestId: string) => void;
}

function StatusDot({ tone }: { tone: "running" | "ok" | "error" | "pending" }) {
  const color =
    tone === "ok"
      ? "var(--cyan)"
      : tone === "error"
        ? "var(--red)"
        : tone === "pending"
          ? "var(--amber)"
          : "var(--text-faint)";
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{
        background: color,
        boxShadow: tone === "running" ? "0 0 6px var(--accent)" : undefined,
      }}
    />
  );
}

export function ToolCard({
  name,
  input,
  result,
  isError,
  approval,
  onApprove,
  onDeny,
}: ToolCardProps) {
  const [inputExpanded, setInputExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [approvalState, setApprovalState] = useState<"pending" | "approved" | "denied">("pending");

  const handleApprove = useCallback(() => {
    if (!approval) return;
    setApprovalState("approved");
    onApprove?.(approval.sessionId, approval.requestId);
  }, [approval, onApprove]);

  const handleDeny = useCallback(() => {
    if (!approval) return;
    setApprovalState("denied");
    onDeny?.(approval.sessionId, approval.requestId);
  }, [approval, onDeny]);

  const tone: "running" | "ok" | "error" | "pending" =
    approval && approvalState === "pending"
      ? "pending"
      : isError
        ? "error"
        : result !== undefined
          ? "ok"
          : "running";

  const resultLines = result?.split("\n") ?? [];
  const resultCollapsedHeight = resultLines.length > 6;

  return (
    <div
      className="my-2 rounded-md overflow-hidden"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-2 px-3 h-8">
        <StatusDot tone={tone} />
        <span className="tc-ui tc-mono truncate" style={{ color: "var(--text-primary)" }}>
          {name}
        </span>
        <span
          className="tc-caption ml-auto shrink-0"
          style={{ color: "var(--text-faint)" }}
        >
          {tone === "running" && "running"}
          {tone === "ok" && "done"}
          {tone === "error" && "error"}
          {tone === "pending" && "needs approval"}
        </span>
      </div>

      {input && Object.keys(input).length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button
            className="flex items-center gap-1.5 w-full px-3 h-7 tc-caption transition-colors hover:text-[var(--text-secondary)]"
            onClick={() => setInputExpanded((v) => !v)}
            style={{ color: "var(--text-muted)" }}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 10 10"
              className={`transition-transform duration-150 ${inputExpanded ? "rotate-90" : ""}`}
            >
              <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="tc-eyebrow" style={{ color: "var(--text-muted)" }}>Input</span>
          </button>
          {inputExpanded && (
            <pre
              className="tc-mono px-3 pb-2 overflow-x-auto whitespace-pre-wrap"
              style={{
                fontSize: "11.5px",
                lineHeight: "var(--leading-relaxed)",
                color: "var(--text-muted)",
              }}
            >
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
        </div>
      )}

      {result !== undefined && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <pre
            className="tc-mono px-3 py-2 overflow-x-auto whitespace-pre-wrap"
            style={{
              fontSize: "11.5px",
              lineHeight: "var(--leading-relaxed)",
              color: isError ? "var(--red)" : "var(--text-secondary)",
              maxHeight: resultCollapsedHeight && !resultExpanded ? 132 : undefined,
              overflowY: resultCollapsedHeight && !resultExpanded ? "hidden" : undefined,
              maskImage:
                resultCollapsedHeight && !resultExpanded
                  ? "linear-gradient(to bottom, black 70%, transparent)"
                  : undefined,
            }}
          >
            {result}
          </pre>
          {resultCollapsedHeight && (
            <button
              className="w-full text-left px-3 h-6 tc-caption hover:text-[var(--text-secondary)] transition-colors"
              style={{ color: "var(--text-muted)" }}
              onClick={() => setResultExpanded((v) => !v)}
            >
              {resultExpanded ? "Collapse" : `Show ${resultLines.length - 6} more lines`}
            </button>
          )}
        </div>
      )}

      {approval && approvalState === "pending" && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            className="px-3 py-1 tc-ui rounded-md transition-opacity hover:opacity-90"
            style={{
              background: "var(--accent)",
              color: "white",
            }}
            onClick={handleApprove}
          >
            Approve
          </button>
          <button
            className="px-3 py-1 tc-ui rounded-md transition-colors"
            style={{
              background: "var(--surface-hover)",
              color: "var(--text-secondary)",
            }}
            onClick={handleDeny}
          >
            Deny
          </button>
        </div>
      )}
      {approval && approvalState !== "pending" && (
        <div className="px-3 py-2" style={{ borderTop: "1px solid var(--border)" }}>
          <span
            className="tc-label"
            style={{ color: approvalState === "approved" ? "var(--cyan)" : "var(--red)" }}
          >
            {approvalState === "approved" ? "Approved" : "Denied"}
          </span>
        </div>
      )}
    </div>
  );
}
