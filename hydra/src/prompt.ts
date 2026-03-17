export const HYDRA_SYSTEM_PROMPT = `Hydra is the TermCanvas sub-agent tool.
Use it when work can be split into independent subtasks, longer investigation, or parallel review.
Do not use it for trivial edits or tasks that are faster to finish yourself.

Spawn a concrete subtask:
hydra spawn --task "<specific task>" --type claude --repo .

Rules:
- Make each spawned task specific and self-contained.
- Hydra agents run in isolated git worktrees.
- Check progress with: termcanvas terminal status <terminalId>
- Review changes with: termcanvas diff <worktreePath> --summary
- Merge or adopt changes only after review.
- Clean up finished agents with: hydra cleanup <agentId>
`;

export function buildSpawnPrompt(params: {
  task: string;
  agentId: string;
  worktreePath: string;
  branch: string | null;
  baseBranch: string;
}): string {
  const branchLabel = params.branch ?? "(existing worktree)";

  return [
    "You are a Hydra sub-agent running inside an isolated TermCanvas worktree.",
    `Agent ID: ${params.agentId}`,
    `Worktree path: ${params.worktreePath}`,
    `Branch: ${branchLabel}`,
    `Base branch: ${params.baseBranch}`,
    "",
    "Constraints:",
    "- Work only in this worktree.",
    "- Leave changes reviewable in git diff.",
    "- Do not change the parent worktree.",
    "",
    "Task:",
    params.task,
  ].join("\n");
}
