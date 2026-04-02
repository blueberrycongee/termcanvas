import { useState, useCallback } from "react";

interface ToolCardProps {
  name: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  approval?: {
    requestId: string;
    sessionId: string;
  };
  onApprove?: (sessionId: string, requestId: string) => void;
  onDeny?: (sessionId: string, requestId: string) => void;
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

  return (
    <div className="my-2 rounded-md border border-zinc-700 bg-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 border-b border-zinc-700">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0">
          <path d="M14.3 2.3L9.9 6.7M5.1 8.1L2.5 13.5L7.9 10.9M6.5 9.5L10.5 5.5" />
          <path d="M9.9 6.7L12 8.8C12.4 9.2 12.4 9.8 12 10.2L7.5 14.7C7.1 15.1 6.5 15.1 6.1 14.7L1.3 9.9C0.9 9.5 0.9 8.9 1.3 8.5L5.8 4C6.2 3.6 6.8 3.6 7.2 4L9.9 6.7Z" />
        </svg>
        <span className="text-xs font-medium text-zinc-300 truncate">{name}</span>
        {result !== undefined && (
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${isError ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"}`}>
            {isError ? "error" : "done"}
          </span>
        )}
      </div>

      {/* Input (collapsible) */}
      {input && Object.keys(input).length > 0 && (
        <div className="border-b border-zinc-700">
          <button
            className="flex items-center gap-1.5 w-full px-3 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
            onClick={() => setInputExpanded((v) => !v)}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 10 10"
              className={`transition-transform duration-150 ${inputExpanded ? "rotate-90" : ""}`}
            >
              <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Input
          </button>
          {inputExpanded && (
            <pre className="px-3 pb-2 text-[11px] font-mono text-zinc-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Result */}
      {result !== undefined && (
        <div className="px-3 py-2">
          <pre className={`text-xs font-mono whitespace-pre-wrap leading-relaxed ${isError ? "text-red-400" : "text-zinc-400"}`}>
            {result}
          </pre>
        </div>
      )}

      {/* Approval buttons */}
      {approval && approvalState === "pending" && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-700">
          <button
            className="px-3 py-1 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors duration-150"
            onClick={handleApprove}
          >
            Approve
          </button>
          <button
            className="px-3 py-1 text-xs font-medium rounded bg-zinc-700 hover:bg-red-600 text-zinc-300 hover:text-white transition-colors duration-150"
            onClick={handleDeny}
          >
            Deny
          </button>
        </div>
      )}
      {approval && approvalState !== "pending" && (
        <div className="px-3 py-2 border-t border-zinc-700">
          <span className={`text-xs ${approvalState === "approved" ? "text-emerald-400" : "text-red-400"}`}>
            {approvalState === "approved" ? "Approved" : "Denied"}
          </span>
        </div>
      )}
    </div>
  );
}
