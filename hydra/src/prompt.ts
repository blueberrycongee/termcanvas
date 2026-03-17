export interface SpawnContext {
  task: string;
  worktreePath: string;
  branch: string | null;
  baseBranch: string;
}

export function buildSpawnPrompt(ctx: SpawnContext): string {
  const lines = [
    `You are a Hydra sub-agent working in an isolated git worktree.`,
    ``,
    `Worktree: ${ctx.worktreePath}`,
    `Branch: ${ctx.branch ?? "(existing worktree)"}`,
    `Base branch: ${ctx.baseBranch}`,
    ``,
    `## Task`,
    ``,
    ctx.task,
    ``,
    `## Rules`,
    ``,
    `- Stay within this worktree. Do not modify files outside it.`,
    `- Commit your changes before finishing.`,
    `- Do not push to remote.`,
  ];
  return lines.join("\n");
}
