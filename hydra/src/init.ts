import fs from "node:fs";
import path from "node:path";

const MARKER = "## Hydra Sub-Agent Tool";

const HYDRA_SECTION = `
## Hydra Sub-Agent Tool

When task uncertainty is high (unclear root cause, multiple valid approaches,
decomposable subtasks), investigate first, then use hydra to spawn sub-agents.

Workflow:
1. Investigate the problem yourself first, form a clear task description
2. \`hydra spawn --task "<specific task>" --type claude --repo .\`
3. Poll progress: \`termcanvas terminal status <terminalId>\`
4. Review: \`termcanvas diff <worktreePath> --summary\`
5. Adopt: \`git merge <branch>\`
6. Clean up: \`hydra cleanup <agentId>\`

When NOT to use: simple fixes, high-certainty tasks, faster to do yourself.
`;

export async function init(): Promise<void> {
  const claudeMdPath = path.join(process.cwd(), "CLAUDE.md");

  let existing = "";
  try {
    existing = fs.readFileSync(claudeMdPath, "utf-8");
  } catch {
    // file doesn't exist — will create
  }

  if (existing.includes(MARKER)) {
    console.log("CLAUDE.md already contains hydra instructions — skipping.");
    return;
  }

  const content = existing
    ? existing.trimEnd() + "\n" + HYDRA_SECTION
    : HYDRA_SECTION.trimStart();

  fs.writeFileSync(claudeMdPath, content);
  console.log(
    existing
      ? "Appended hydra instructions to CLAUDE.md"
      : "Created CLAUDE.md with hydra instructions",
  );
}
