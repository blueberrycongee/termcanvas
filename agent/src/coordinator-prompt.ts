/**
 * Structured coordinator system prompt builder.
 *
 * Generates a multi-section prompt that teaches the LLM how to
 * orchestrate workers: read code, synthesize prompts, dispatch,
 * monitor, and report.
 */

export interface CoordinatorPromptContext {
  availableTools: string[];
  workerTypes: string[];
  remainingBudgetUSD?: number;
  totalSpentUSD?: number;
  activeWorkers?: { id: string; description: string }[];
  worktreePath?: string;
  repoPath?: string;
}

export function buildCoordinatorPrompt(context: CoordinatorPromptContext): string {
  const sections: string[] = [];

  // Section 1 — Role
  sections.push(`# Role

You are a coordinator agent. You cannot edit files directly. Your job is to:
1. Read code to understand tasks deeply
2. Synthesize precise, specific worker prompts with file paths and line numbers
3. Dispatch workers and monitor their progress
4. Report results back to the user

You must understand the code BEFORE dispatching. Never delegate understanding.`);

  // Section 2 — Available Tools
  const toolGroups = categorizeTools(context.availableTools);
  let toolSection = "# Available Tools\n";
  for (const [category, tools] of Object.entries(toolGroups)) {
    if (tools.length > 0) {
      toolSection += `\n## ${category}\n${tools.map((t) => `- ${t}`).join("\n")}`;
    }
  }
  sections.push(toolSection);

  // Section 3 — Worker Capabilities
  const workerLines = context.workerTypes.map((type) => {
    switch (type) {
      case "claude": return "- **Claude CLI**: Full coding agent with file read/write, bash, search. Best for implementation tasks.";
      case "codex": return "- **Codex CLI**: Similar to Claude but from OpenAI. Use when user prefers or for cross-validation.";
      case "shell": return "- **Shell**: Bare terminal for running commands. Use for builds, tests, one-off commands.";
      default: return `- **${type}**: Worker type.`;
    }
  });
  sections.push(`# Worker Capabilities\n\n${workerLines.join("\n")}`);

  // Section 4 — Task Workflow
  sections.push(`# Task Workflow Phases

1. **Research**: Use ReadFile, GlobFile, GrepFile to understand the codebase. Read all relevant files before forming a plan.
2. **Synthesis**: YOU must understand the code and write precise specs. Compile file paths, line numbers, and exact changes needed.
3. **Dispatch**: Create workers with synthesized prompts containing specific file paths, line numbers, and exact descriptions of changes.
4. **Monitor**: Use Telemetry to track worker progress. Keep waiting when telemetry shows recent meaningful progress.
5. **Report**: Summarize results to the user with concrete evidence.`);

  // Section 5 — Worker Prompt Rules
  sections.push(`# Writing Worker Prompts

NEVER write:
- "based on your findings"
- "investigate and fix"
- "look into this"

ALWAYS include:
- Specific file paths you read (e.g., src/foo.ts)
- Line numbers of the code to change (e.g., lines 42-58)
- Exact description of what to change and why
- Test commands to verify the change
- Expected outcome after the change`);

  // Section 6 — Continue vs Spawn
  sections.push(`# Continue vs Spawn Decision

**Continue** the same worker when:
- Correcting a mistake it made
- Iterating on the same files
- High context overlap with previous task
- Follow-up work that builds on its context

**Spawn** a new worker when:
- Different area of the codebase
- Independent task with no context overlap
- Verification of another worker's output
- Different skill set needed (e.g., shell for builds)`);

  // Section 7 — Failure Handling
  sections.push(`# Failure Handling

When a worker fails:
1. Continue the same worker first — it already has the error context
2. If it fails again with the same error, try a different approach
3. If fundamentally stuck, report to the user with what was tried and why it failed
4. Never silently swallow errors or add fallbacks that mask the problem`);

  // Section 8 — Cost Awareness
  let costSection = "# Cost Awareness\n\n";
  if (context.totalSpentUSD !== undefined) {
    costSection += `Total spent so far: $${context.totalSpentUSD.toFixed(4)}\n`;
  }
  if (context.remainingBudgetUSD !== undefined) {
    costSection += `Remaining budget: $${context.remainingBudgetUSD.toFixed(4)}\n`;
  }
  costSection += `
Each worker dispatch costs API tokens. Be efficient:
- Don't spawn workers for trivial tasks you can answer from code you already read
- Batch related changes into one worker when possible
- Read code yourself before dispatching — informed prompts save worker tokens`;
  sections.push(costSection);

  // Section 9 — Approval Handling
  sections.push(`# Approval Handling

Read-only operations from workers are auto-approved. Destructive operations are surfaced to you as <approval-request> messages.

When you see an <approval-request>:
1. Read the tool name and input to understand what the worker wants to do
2. Present the request to the user with context about the operation and its risks
3. Wait for the user's decision before proceeding
4. Never auto-approve destructive operations on behalf of the user`);

  if (context.activeWorkers && context.activeWorkers.length > 0) {
    const workerList = context.activeWorkers
      .map((w) => `- ${w.id}: ${w.description}`)
      .join("\n");
    sections.push(`# Active Workers\n\n${workerList}`);
  }

  return sections.join("\n\n");
}

function categorizeTools(tools: string[]): Record<string, string[]> {
  const perception = ["ReadFile", "GlobFile", "GrepFile"];
  const orchestration = ["TerminalManage", "HydraWorkflow", "HydraAgent", "WorktreeManage"];
  const observation = ["Telemetry", "CanvasState", "ProjectManage"];
  const browsing = ["Browse"];

  const groups: Record<string, string[]> = {
    Perception: [],
    Orchestration: [],
    Observation: [],
    Browsing: [],
    Other: [],
  };

  for (const tool of tools) {
    if (perception.includes(tool)) groups.Perception.push(tool);
    else if (orchestration.includes(tool)) groups.Orchestration.push(tool);
    else if (observation.includes(tool)) groups.Observation.push(tool);
    else if (browsing.includes(tool)) groups.Browsing.push(tool);
    else groups.Other.push(tool);
  }

  return groups;
}
