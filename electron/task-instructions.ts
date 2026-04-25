import fs from "node:fs";
import path from "node:path";

const MARKER = "## TermCanvas Task System";
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const TASK_SECTION = `
## TermCanvas Task System

TermCanvas has a first-class task store. Tasks are persistent records of work
the user wants done — captured when the user expresses intent, not when the
work happens. Use the \`termcanvas task\` CLI to read and write them. Any agent
terminal can record, read, and update tasks.

When to record a task:
- User says "记一下", "回头处理", "帮我留意", "later", "todo this", or any phrasing that defers the work.
- User describes a problem or idea but isn't asking you to fix it right now.
- User pastes a GitHub issue URL and asks you to track it (record the URL via \`--link\`).

Do NOT silently nod — capture the task with \`termcanvas task add\` so it survives the session.

Recording a task:
\`\`\`
termcanvas task add --title "<short imperative>" --body "<detail>" [--link <url>]
\`\`\`
- \`--title\`: short, scannable. Rephrase the user's words into imperative mood.
- \`--body\`: longer description, including any context the user gave.
- \`--link <url>\`: attach an external reference (GitHub issue, doc, etc.). Use \`--link-type github_issue\` for issue URLs.
- Repo defaults to cwd. Pass \`--repo <path>\` only if you need a different one.

Reading and updating tasks:
- \`termcanvas task list\` — list tasks for the current repo (filter \`--status done\` etc.)
- \`termcanvas task show <id>\` — read a single task before acting on it
- \`termcanvas task update <id> --status done\` — mark complete after finishing the work
- \`termcanvas task update <id> --body "..."\` — refine the description as you learn more

Rules:
- Tasks belong to the user. Don't invent tasks the user didn't ask for.
- One task per intent. Three deferred items = three \`task add\` calls.
- After completing work that originated from a task, call \`task update <id> --status done\`.
- The task store is local to TermCanvas. It does NOT auto-sync to GitHub. If the user wants something on GitHub, they will say so explicitly.
- Status values: \`open\` (default), \`done\`, \`dropped\`. Pick \`dropped\` (not delete) when a task is abandoned, so the history is preserved.
`;

export type TaskInjectStatus = "missing" | "outdated" | "current";
export type TaskInstructionStatus =
  | "created"
  | "appended"
  | "updated"
  | "unchanged";

export interface TaskInstructionResult {
  fileName: (typeof INSTRUCTION_FILES)[number];
  filePath: string;
  status: TaskInstructionStatus;
}

export function checkTaskInstructionsStatus(
  targetDir: string,
): TaskInjectStatus {
  const desiredSection = TASK_SECTION.trim();
  let worst: TaskInjectStatus = "current";

  for (const fileName of INSTRUCTION_FILES) {
    const filePath = path.join(targetDir, fileName);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return "missing";
    }

    const ranges = findTaskSectionRanges(content);
    if (ranges.length === 0) return "missing";
    if (ranges.length > 1) {
      worst = "outdated";
      continue;
    }

    const currentSection = extractTaskSection(content);
    if (normalizeSection(currentSection ?? "") !== normalizeSection(desiredSection)) {
      worst = "outdated";
    }
  }

  return worst;
}

export function syncTaskInstructions(
  targetDir: string,
): TaskInstructionResult[] {
  return INSTRUCTION_FILES.map((fileName) =>
    upsertTaskInstructions(path.join(targetDir, fileName), fileName),
  );
}

function normalizeSection(section: string): string {
  return section.trim().replace(/\s+$/gm, "");
}

function findTaskSectionRanges(
  content: string,
): Array<{ start: number; end: number }> {
  const headingRegex = /^## TermCanvas Task System$/gm;
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

function extractTaskSection(content: string): string | null {
  const range = findTaskSectionRanges(content)[0];
  if (!range) return null;
  return content.slice(range.start, range.end).trimEnd();
}

function replaceTaskSections(content: string): string {
  const ranges = findTaskSectionRanges(content);
  if (ranges.length === 0) return content;

  let updated = content.slice(0, ranges[0].start) + TASK_SECTION.trim();
  let cursor = ranges[0].end;
  for (const range of ranges.slice(1)) {
    updated += content.slice(cursor, range.start);
    cursor = range.end;
  }
  updated += content.slice(cursor);
  return updated;
}

function buildAppendedContent(existing: string): string {
  return existing.trimEnd() + "\n\n" + TASK_SECTION.trimStart();
}

function upsertTaskInstructions(
  filePath: string,
  fileName: (typeof INSTRUCTION_FILES)[number],
): TaskInstructionResult {
  const desiredSection = TASK_SECTION.trim();
  let existing = "";
  let content = "";
  let status: TaskInstructionStatus = "created";

  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    content = TASK_SECTION.trimStart();
    fs.writeFileSync(filePath, content);
    return { fileName, filePath, status };
  }

  const ranges = findTaskSectionRanges(existing);
  const currentSection = extractTaskSection(existing);
  if (ranges.length > 0 && currentSection) {
    if (
      ranges.length === 1 &&
      normalizeSection(currentSection) === normalizeSection(desiredSection)
    ) {
      return { fileName, filePath, status: "unchanged" };
    }
    content = replaceTaskSections(existing);
    status = "updated";
  } else {
    content = existing
      ? buildAppendedContent(existing)
      : TASK_SECTION.trimStart();
    status = existing ? "appended" : "created";
  }
  fs.writeFileSync(filePath, content);
  return { fileName, filePath, status };
}

export const __TASK_MARKER = MARKER;
