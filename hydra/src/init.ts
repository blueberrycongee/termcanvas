import fs from "node:fs";
import path from "node:path";

const MARKER = "## Hydra Sub-Agent Tool";
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const HYDRA_SECTION = `
## Hydra Sub-Agent Tool

Classify the task before choosing a mode. Hydra is for file-driven
orchestration, not the default path for every change.
Hydra treats \`result.json\` + \`done\` as the only completion evidence.
Terminal conversation is not a source of truth.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- A handoff is only complete when both \`result.json\` and \`done\` exist and pass schema validation.

Mode selection:
1. Do the task directly when it is simple, local, or clearly faster without workflow overhead.
2. Use a single implementer workflow when you still want Hydra evidence and retry control:
   \`hydra run --task "<specific task>" --repo . --template single-step [--worktree .]\`
3. Use the default planner -> implementer -> evaluator workflow for ambiguous, risky, or PRD-driven work:
   \`hydra run --task "<specific task>" --repo . [--worktree .]\`
4. Use a direct isolated worker when the split is already known:
   \`hydra spawn --task "<specific task>" --repo . [--worktree .]\`

Workflow control:
1. Inspect one-shot progress: \`hydra tick --repo . --workflow <workflowId>\`
2. Watch until terminal state: \`hydra watch --repo . --workflow <workflowId>\`
3. Inspect structured state and failures: \`hydra status --repo . --workflow <workflowId>\`
4. Retry a failed/timed-out workflow when allowed: \`hydra retry --repo . --workflow <workflowId>\`
5. Clean up runtime state or worktrees: \`hydra cleanup --workflow <workflowId> --repo .\`

\`result.json\` must contain:
- \`success\`
- \`summary\`
- \`outputs[]\`
- \`evidence[]\`
- \`next_action\`

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly in the current agent.
`;

export type InitInstructionStatus = "created" | "appended" | "updated" | "unchanged";

export interface InitInstructionResult {
  fileName: (typeof INSTRUCTION_FILES)[number];
  filePath: string;
  status: InitInstructionStatus;
}

export function syncHydraInstructions(
  targetDir: string,
): InitInstructionResult[] {
  return INSTRUCTION_FILES.map((fileName) =>
    upsertHydraInstructions(path.join(targetDir, fileName), fileName)
  );
}

export async function init(targetDir = process.cwd()): Promise<InitInstructionResult[]> {
  const results = syncHydraInstructions(targetDir);
  for (const result of results) {
    console.log(formatInitLog(result));
  }
  return results;
}

function formatInitLog(result: InitInstructionResult): string {
  switch (result.status) {
    case "created":
      return `Created ${result.fileName} with hydra instructions`;
    case "appended":
      return `Appended hydra instructions to ${result.fileName}`;
    case "updated":
      return `Updated hydra instructions in ${result.fileName}`;
    case "unchanged":
      return `${result.fileName} already contains current hydra instructions`;
  }
}

function normalizeSection(section: string): string {
  return section.trim().replace(/\s+$/gm, "");
}

function findHydraSectionRange(
  content: string,
): { start: number; end: number } | null {
  const start = content.indexOf(MARKER);
  if (start === -1) {
    return null;
  }

  const nextHeadingStart = content.indexOf("\n## ", start + MARKER.length);
  return {
    start,
    end: nextHeadingStart === -1 ? content.length : nextHeadingStart,
  };
}

function extractHydraSection(content: string): string | null {
  const range = findHydraSectionRange(content);
  if (!range) {
    return null;
  }
  return content.slice(range.start, range.end).trimEnd();
}

function replaceHydraSection(content: string): string {
  const range = findHydraSectionRange(content);
  if (!range) {
    return content;
  }
  return content.slice(0, range.start) + HYDRA_SECTION.trim() + content.slice(range.end);
}

function buildAppendedContent(existing: string): string {
  return existing.trimEnd() + "\n\n" + HYDRA_SECTION.trimStart();
}

function upsertHydraInstructions(
  filePath: string,
  fileName: (typeof INSTRUCTION_FILES)[number],
): InitInstructionResult {
  const desiredSection = HYDRA_SECTION.trim();
  let existing = "";
  let content = "";
  let status: InitInstructionStatus = "created";

  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    content = HYDRA_SECTION.trimStart();
    fs.writeFileSync(filePath, content);
    return { fileName, filePath, status };
  }

  const currentSection = extractHydraSection(existing);
  if (currentSection) {
    if (normalizeSection(currentSection) === normalizeSection(desiredSection)) {
      return { fileName, filePath, status: "unchanged" };
    }
    content = replaceHydraSection(existing);
    status = "updated";
  } else {
    content = existing ? buildAppendedContent(existing) : HYDRA_SECTION.trimStart();
    status = existing ? "appended" : "created";
  }
  fs.writeFileSync(filePath, content);
  return { fileName, filePath, status };
}
