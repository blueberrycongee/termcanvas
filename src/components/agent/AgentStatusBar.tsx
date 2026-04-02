interface AgentStatusBarProps {
  generating: boolean;
  tokenUsage: { input: number; output: number } | null;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function AgentStatusBar({ generating, tokenUsage }: AgentStatusBarProps) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-3 py-1 border-b border-zinc-700 bg-zinc-900 text-[10px] text-zinc-500">
      {generating && (
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Generating…
        </span>
      )}
      {tokenUsage && (
        <span className="ml-auto">
          {formatTokens(tokenUsage.input)} in / {formatTokens(tokenUsage.output)} out
        </span>
      )}
    </div>
  );
}
