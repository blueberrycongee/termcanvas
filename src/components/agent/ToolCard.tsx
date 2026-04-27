import { useCallback, useState } from "react";
import { useT } from "../../i18n/useT";

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

type Tone = "running" | "ok" | "error" | "pending";

function StatusDot({ tone }: { tone: Tone }) {
  const color =
    tone === "ok"
      ? "var(--cyan)"
      : tone === "error"
        ? "var(--red)"
        : tone === "pending"
          ? "var(--amber)"
          : "var(--accent)";
  return (
    <span
      aria-hidden
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${tone === "running" ? "status-pulse" : ""}`}
      style={{ background: color }}
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      aria-hidden
      className="shrink-0"
      style={{
        color: "var(--text-faint)",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform var(--duration-quick) var(--ease-out-soft)",
      }}
    >
      <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Pull a single user-recognisable subject out of arbitrary tool input.
 * Read/Write/Edit → file_path. Bash → command. Grep → pattern. Otherwise
 * the first short string value, falling back to nothing. The subject is
 * the only thing that distinguishes one Read call from another in a
 * stream of fifty Reads, so showing it inline keeps the row scannable
 * without expansion.
 */
function inputSubject(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const candidate =
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.path === "string" && input.path) ||
    (typeof input.command === "string" && input.command) ||
    (typeof input.pattern === "string" && input.pattern) ||
    (typeof input.url === "string" && input.url) ||
    (typeof input.notebook_path === "string" && input.notebook_path) ||
    "";
  if (typeof candidate !== "string" || !candidate) return "";
  if (candidate.length <= 80) return candidate;
  return candidate.slice(0, 80) + "…";
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
  const t = useT();
  const [expanded, setExpanded] = useState(false);
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

  const tone: Tone =
    approval && approvalState === "pending"
      ? "pending"
      : isError
        ? "error"
        : result !== undefined
          ? "ok"
          : "running";

  const subject = inputSubject(input);
  const hasInputDetail = !!input && Object.keys(input).length > 0;
  const hasOutput = result !== undefined;
  const isExpandable = hasInputDetail || hasOutput;
  const resultLines = result?.split("\n") ?? [];
  const resultCollapsed = resultLines.length > 8;

  return (
    <div className="my-0.5">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left py-0.5"
        onClick={() => isExpandable && setExpanded((v) => !v)}
        disabled={!isExpandable}
      >
        {isExpandable ? <Chevron open={expanded} /> : <span className="w-[9px] shrink-0" />}
        <StatusDot tone={tone} />
        <span
          className="shrink-0 tc-mono"
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-secondary)",
          }}
        >
          {name}
        </span>
        {subject && (
          <span
            className="truncate tc-mono"
            style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
            title={subject}
          >
            {subject}
          </span>
        )}
        {tone === "pending" && (
          <span
            className="ml-auto tc-eyebrow shrink-0"
            style={{ color: "var(--amber)" }}
          >
            {t["agent.tool.needsApproval"]}
          </span>
        )}
        {tone === "error" && (
          <span
            className="ml-auto tc-eyebrow shrink-0"
            style={{ color: "var(--red)" }}
          >
            {t["agent.tool.error"]}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-1 mb-1 pl-[18px] space-y-2 tc-enter-fade-quick">
          {hasInputDetail && (
            <div>
              <div className="mb-0.5 tc-eyebrow tc-mono">{t["agent.tool.input"]}</div>
              <pre
                className="whitespace-pre-wrap break-words tc-mono m-0"
                style={{
                  fontSize: "var(--text-xs)",
                  lineHeight: "var(--leading-snug)",
                  color: "var(--text-secondary)",
                }}
              >
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <div className="mb-0.5 tc-eyebrow tc-mono">{t["agent.tool.output"]}</div>
              <pre
                className="whitespace-pre-wrap break-words tc-mono m-0"
                style={{
                  fontSize: "var(--text-xs)",
                  lineHeight: "var(--leading-snug)",
                  color: isError ? "var(--red)" : "var(--text-secondary)",
                  maxHeight: resultCollapsed && !resultExpanded ? 168 : undefined,
                  overflowY: resultCollapsed && !resultExpanded ? "hidden" : undefined,
                  maskImage:
                    resultCollapsed && !resultExpanded
                      ? "linear-gradient(to bottom, black 70%, transparent)"
                      : undefined,
                }}
              >
                {result}
              </pre>
              {resultCollapsed && (
                <button
                  className="mt-1 tc-caption tc-mono"
                  style={{
                    color: "var(--text-muted)",
                    transition: "color var(--duration-quick) var(--ease-out-soft)",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setResultExpanded((v) => !v);
                  }}
                >
                  {resultExpanded
                    ? t["agent.tool.collapse"]
                    : t["agent.tool.showMoreLines"](resultLines.length - 8)}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {approval && approvalState === "pending" && (
        <div className="mt-1 mb-1 pl-[18px] flex items-center gap-2">
          <button
            className="px-2.5 h-6 tc-ui rounded-md"
            style={{
              background: "var(--accent)",
              color: "white",
              transition: "opacity var(--duration-quick) var(--ease-out-soft)",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.9")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
            onClick={handleApprove}
          >
            {t["agent.tool.approve"]}
          </button>
          <button
            className="px-2.5 h-6 tc-ui rounded-md"
            style={{
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              transition:
                "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "var(--surface-hover)";
              el.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = "transparent";
              el.style.color = "var(--text-secondary)";
            }}
            onClick={handleDeny}
          >
            {t["agent.tool.deny"]}
          </button>
        </div>
      )}
      {approval && approvalState !== "pending" && (
        <div className="mt-0.5 pl-[18px]">
          <span
            className="tc-eyebrow"
            style={{ color: approvalState === "approved" ? "var(--cyan)" : "var(--red)" }}
          >
            {approvalState === "approved"
              ? t["agent.tool.approved"]
              : t["agent.tool.denied"]}
          </span>
        </div>
      )}
    </div>
  );
}
