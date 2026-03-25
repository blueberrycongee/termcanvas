import fs from "node:fs";
import path from "node:path";

const MARKER = "## Hydra Sub-Agent Tool";
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const HYDRA_SECTION = `
## Hydra Sub-Agent Tool

Use Hydra when the task benefits from file-driven multi-agent orchestration.
Hydra now treats \`result.json\` + \`done\` as the only completion evidence.
Terminal conversation is not a source of truth.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- A handoff is only complete when both \`result.json\` and \`done\` exist and pass schema validation.

Workflow:
1. Start a workflow: \`hydra run --task "<specific task>" --repo . [--worktree .] [--template planner-implementer-evaluator]\`
2. Inspect one-shot progress: \`hydra tick --repo . --workflow <workflowId>\`
3. Watch until terminal state: \`hydra watch --repo . --workflow <workflowId>\`
4. Inspect structured state and failures: \`hydra status --repo . --workflow <workflowId>\`
5. Retry a failed/timed-out workflow when allowed: \`hydra retry --repo . --workflow <workflowId>\`
6. Clean up runtime state or worktrees: \`hydra cleanup --workflow <workflowId> --repo .\`

\`result.json\` must contain:
- \`success\`
- \`summary\`
- \`outputs[]\`
- \`evidence[]\`
- \`next_action\`

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly.
`;

export async function init(): Promise<void> {
  for (const fileName of INSTRUCTION_FILES) {
    upsertHydraInstructions(path.join(process.cwd(), fileName), fileName);
  }
}

function upsertHydraInstructions(filePath: string, fileName: string): void {
  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    // file doesn't exist — will create
  }

  if (existing.includes(MARKER)) {
    console.log(`${fileName} already contains hydra instructions — skipping.`);
    return;
  }

  const content = existing
    ? existing.trimEnd() + "\n" + HYDRA_SECTION
    : HYDRA_SECTION.trimStart();

  fs.writeFileSync(filePath, content);
  console.log(
    existing
      ? `Appended hydra instructions to ${fileName}`
      : `Created ${fileName} with hydra instructions`,
  );
}
