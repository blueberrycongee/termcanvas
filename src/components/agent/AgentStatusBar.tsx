interface AgentStatusBarProps {
  generating: boolean;
  tokenUsage: { input: number; output: number } | null;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  isDark: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function Sep() {
  return (
    <span
      aria-hidden
      className="inline-block w-[3px] h-[3px] rounded-full opacity-60"
      style={{ background: "var(--text-faint)" }}
    />
  );
}

export function AgentStatusBar({
  generating,
  tokenUsage,
  model,
  costUsd,
  durationMs,
}: AgentStatusBarProps) {
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 h-7"
      style={{
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {generating ? (
        <span className="flex items-center gap-1.5 tc-label" style={{ color: "var(--text-secondary)" }}>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full status-pulse"
            style={{ background: "var(--accent)" }}
          />
          Generating
        </span>
      ) : (
        <span className="tc-label" style={{ color: "var(--text-faint)" }}>Idle</span>
      )}
      {model && (
        <>
          <Sep />
          <span className="tc-label tc-mono truncate" title={model} style={{ color: "var(--text-muted)" }}>
            {model}
          </span>
        </>
      )}

      <span className="ml-auto flex items-center gap-2">
        {tokenUsage && (
          <span className="tc-caption tc-num tc-mono" style={{ color: "var(--text-muted)" }}>
            {formatTokens(tokenUsage.input)}↑ {formatTokens(tokenUsage.output)}↓
          </span>
        )}
        {costUsd != null && (
          <>
            <Sep />
            <span className="tc-caption tc-num tc-mono" style={{ color: "var(--text-muted)" }}>
              {formatCost(costUsd)}
            </span>
          </>
        )}
        {durationMs != null && (
          <>
            <Sep />
            <span className="tc-caption tc-num tc-mono" style={{ color: "var(--text-faint)" }}>
              {formatDuration(durationMs)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
