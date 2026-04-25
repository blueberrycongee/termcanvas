import fs from "node:fs";
import path from "node:path";

const MARKER = "## Hydra Orchestration Toolkit";
const LEGACY_MARKER = "## Hydra Sub-Agent Tool";
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const HYDRA_SECTION = `
## Hydra Orchestration Toolkit

Hydra is a Lead-driven orchestration toolkit. You (the Lead) make strategic
decisions at decision points; Hydra handles operational management.
\`result.json\` is the only completion evidence.

Why this design (vs. other coding-agent products):
- **SWF decider pattern, specialized for LLM deciders.** Hydra is the AWS SWF / Cadence / Temporal decider pattern. \`hydra watch\` is \`PollForDecisionTask\`; the Lead is the decider; \`lead_terminal_id\` enforces single-decider semantics.
- **Parallel-first, not bolted on.** \`dispatch\` + worktree + \`merge\` are first-class. Lead sequences nodes manually and passes context explicitly via \`--context-ref\`. Other products treat parallelism as open research; Hydra makes it the default.
- **Typed result contract.** Workers publish a schema-validated \`result.json\` (\`outcome: completed | stuck | error\`, optional \`stuck_reason: needs_clarification | needs_credentials | needs_context | blocked_technical\`). Other products return free-text final messages and require downstream parsing.
- **Lead intervention points.** \`hydra reset --feedback\` lets the Lead actually intervene at decision points instead of being block-and-join. A stale or wrong run is one \`reset\` away.

Core rules:
- Root cause first. Fix the implementation problem before changing tests.
- Do not hack tests, fixtures, or mocks to force a green result.
- Do not add silent fallbacks or swallowed errors.
- An assignment run is only complete when \`result.json\` exists and passes schema validation.

Workflow patterns:
1. Do the task directly when it is simple, local, or clearly faster without workflow overhead.
2. Use Hydra for ambiguous, risky, parallel, or multi-step work:
   \`\`\`
   hydra init --intent "<task>" --repo .
   hydra dispatch --workbench W --dispatch <id> --role <role> --intent "<desc>" --repo .
   hydra watch --workbench W --repo .
   # → DecisionPoint returned, decide next step
   hydra complete --workbench W --repo .
   \`\`\`
3. Use a direct isolated worker when only a separate worker is needed:
   \`hydra spawn --task "<specific task>" --repo . [--worktree .]\`

Agent launch rule:
- When dispatching Claude/Codex through TermCanvas CLI, start a fresh agent terminal with \`termcanvas terminal create --prompt "..."\`
- Do not use \`termcanvas terminal input\` for task dispatch; it is not a supported automation path

TermCanvas Computer Use:
- TermCanvas may dynamically inject a Computer Use MCP server into Claude/Codex terminals; it does not have to appear in static MCP settings files.
- For local macOS desktop apps or system UI, check for TermCanvas Computer Use before assuming only shell, browser, or Playwright tools are available.
- If available, call \`status\` first, then \`setup\` if permissions or helper health are missing, then \`get_instructions\` for the current operating protocol.
- Do not manually start \`computer-use-helper\`, write its state file, launch the MCP server, or hand-write JSON-RPC unless explicitly debugging Computer Use itself.

Workflow control:
- After dispatching, always call \`hydra watch\`. It returns at decision points.
1. Watch until decision point: \`hydra watch --workbench <workbenchId> --repo .\`
2. Inspect structured state: \`hydra status --workbench <workbenchId> --repo .\`
3. Reset a dispatch for rework: \`hydra reset --workbench W --dispatch N --feedback "..." --repo .\`
4. Approve a dispatch's output: \`hydra approve --workbench W --dispatch N --repo .\`
5. Merge parallel branches: \`hydra merge --workbench W --dispatches A,B --repo .\`
6. View event log: \`hydra ledger --workbench <workbenchId> --repo .\`
7. Clean up: \`hydra cleanup --workbench <workbenchId> --repo .\`

Telemetry polling:
1. Treat \`hydra watch\` as the main polling loop; do not infer progress from terminal prose alone.
2. Before deciding wait / retry / takeover, query:
   - \`termcanvas telemetry get --workbench <workbenchId> --repo .\`
   - \`termcanvas telemetry get --terminal <terminalId>\`
   - \`termcanvas telemetry events --terminal <terminalId> --limit 20\`
3. Trust \`derived_status\` and \`task_status\` as the primary decision signals.

\`result.json\` must contain (slim, schema_version \`hydra/result/v0.1\`):
- \`schema_version\`, \`workbench_id\`, \`assignment_id\`, \`run_id\` (passthrough IDs)
- \`outcome\` (completed/stuck/error — Hydra routes on this)
- \`report_file\` (path to a \`report.md\` written alongside \`result.json\`)

All human-readable content (summary, outputs, evidence, reflection) lives in
\`report.md\`. Hydra rejects any extra fields in \`result.json\`. Write \`report.md\`
first, then publish \`result.json\` atomically as the final artifact of the run.

When NOT to use: simple fixes, high-certainty tasks, or work that is faster to do directly in the current agent.
`;

export type InitInstructionStatus = "created" | "appended" | "updated" | "unchanged";

export interface InitInstructionResult {
  fileName: (typeof INSTRUCTION_FILES)[number];
  filePath: string;
  status: InitInstructionStatus;
}

export type HydraInjectStatus = "missing" | "outdated" | "current";

/**
 * Read-only check: are Hydra instructions present and up to date?
 * Returns the worst status across all instruction files.
 */
export function checkHydraInstructionsStatus(
  targetDir: string,
): HydraInjectStatus {
  const desiredSection = HYDRA_SECTION.trim();
  let worst: HydraInjectStatus = "current";

  for (const fileName of INSTRUCTION_FILES) {
    const filePath = path.join(targetDir, fileName);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return "missing";
    }

    const ranges = findHydraSectionRanges(content);
    if (ranges.length === 0) {
      return "missing";
    }
    if (ranges.length > 1) {
      worst = "outdated";
      continue;
    }

    const currentSection = extractHydraSection(content);
    if (normalizeSection(currentSection) !== normalizeSection(desiredSection)) {
      worst = "outdated";
    }
  }

  return worst;
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

function findHydraSectionRanges(
  content: string,
): Array<{ start: number; end: number }> {
  const headingRegex = /^## Hydra (?:Orchestration Toolkit|Sub-Agent Tool)$/gm;
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of content.matchAll(headingRegex)) {
    const start = match.index;
    if (start === undefined) continue;
    const nextHeadingStart = content.indexOf("\n## ", start + match[0].length);
    ranges.push({
      start,
      end: nextHeadingStart === -1 ? content.length : nextHeadingStart,
    });
  }

  return ranges;
}

function extractHydraSection(content: string): string | null {
  const range = findHydraSectionRanges(content)[0];
  if (!range) {
    return null;
  }
  return content.slice(range.start, range.end).trimEnd();
}

function replaceHydraSections(content: string): string {
  const ranges = findHydraSectionRanges(content);
  if (ranges.length === 0) {
    return content;
  }

  let updated = content.slice(0, ranges[0].start) + HYDRA_SECTION.trim();
  let cursor = ranges[0].end;
  for (const range of ranges.slice(1)) {
    updated += content.slice(cursor, range.start);
    cursor = range.end;
  }
  updated += content.slice(cursor);
  return updated;
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

  const ranges = findHydraSectionRanges(existing);
  const currentSection = extractHydraSection(existing);
  if (ranges.length > 0 && currentSection) {
    if (
      ranges.length === 1 &&
      normalizeSection(currentSection) === normalizeSection(desiredSection)
    ) {
      return { fileName, filePath, status: "unchanged" };
    }
    content = replaceHydraSections(existing);
    status = "updated";
  } else {
    content = existing ? buildAppendedContent(existing) : HYDRA_SECTION.trimStart();
    status = existing ? "appended" : "created";
  }
  fs.writeFileSync(filePath, content);
  return { fileName, filePath, status };
}
