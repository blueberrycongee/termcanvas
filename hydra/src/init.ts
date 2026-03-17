import fs from "node:fs";
import path from "node:path";

const MARKER = "## Hydra Sub-Agent Tool";
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const HYDRA_SECTION = `
## Hydra Sub-Agent Tool

When task uncertainty is high (unclear root cause, multiple valid approaches,
decomposable subtasks), investigate first, then use hydra to spawn sub-agents.

Workflow:
1. Investigate the problem yourself first, form a clear task description
2. Pick the right mode:
   - Read-only: \`hydra spawn --task "<specific task>" --type <agent-type> --repo . --worktree .\`
   - Code changes: \`hydra spawn --task "<specific task>" --type <agent-type> --repo .\`
3. Poll progress: \`termcanvas terminal status <terminalId>\`
4. Read the result file returned by spawn: \`cat <resultFile>\`
5. For code-change tasks: \`termcanvas diff <worktreePath> --summary\` then \`git merge <branch>\`
6. Clean up: \`hydra cleanup <agentId>\`

When NOT to use: simple fixes, high-certainty tasks, faster to do yourself.
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
