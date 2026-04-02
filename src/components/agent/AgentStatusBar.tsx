interface AgentStatusBarProps {
  generating: boolean;
  tokenUsage: { input: number; output: number } | null;
  model?: string;
  toolsCount?: number;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
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

export function AgentStatusBar({
  generating,
  tokenUsage,
  model,
  costUsd,
  durationMs,
  isDark,
}: AgentStatusBarProps) {
  return (
    <div className={`shrink-0 flex items-center gap-3 px-3 py-1 border-b text-[10px] ${
      isDark ? "border-zinc-700 bg-zinc-900 text-zinc-500" : "border-zinc-200 bg-zinc-50 text-zinc-400"
    }`}>
      {generating && (
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Generating…
        </span>
      )}
      {model && <span className="truncate">{model}</span>}
      <span className="ml-auto flex items-center gap-3">
        {tokenUsage && (
          <span>{formatTokens(tokenUsage.input)} in / {formatTokens(tokenUsage.output)} out</span>
        )}
        {costUsd != null && <span>{formatCost(costUsd)}</span>}
        {durationMs != null && <span>{formatDuration(durationMs)}</span>}
      </span>
    </div>
  );
}
