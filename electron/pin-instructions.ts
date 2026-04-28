import fs from "node:fs";
import path from "node:path";

const MARKER = "## TermCanvas Pin System";
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const PIN_SECTION = `
## TermCanvas Pin System

TermCanvas has a first-class pin store. Pins are persistent records of work
the user wants done — captured when the user expresses intent, not when the
work happens. Use the \`termcanvas pin\` CLI to read and write them. Any agent
terminal can record, read, and update pins.

When to record a pin:
- User says "记一下", "回头处理", "帮我留意", "later", "todo this", or any phrasing that defers the work.
- User describes a problem or idea but isn't asking you to fix it right now.
- User pastes a GitHub issue URL and asks you to track it (record the URL via \`--link\`).

Do NOT silently nod — capture the pin with \`termcanvas pin add\` so it survives the session.

Recording a pin:
\`\`\`
termcanvas pin add --title "<short imperative>" --body "<detail>" [--link <url>]
\`\`\`
- \`--title\`: short, scannable. Rephrase the user's words into imperative mood.
- \`--body\`: preserve enough context for a future agent or the user to resume without re-asking basic questions. Do not store only the user's raw sentence unless it is truly just a lightweight memo.
- For bugs, feature requests, research threads, design feedback, or follow-up engineering work, write the body like a compact issue. Prefer sections such as:
  \`Background\`: what prompted this and where it came from.
  \`Observed / Request\`: the concrete symptom, ask, or idea.
  \`Expected / Goal\`: what should be true when this is handled.
  \`Evidence / References\`: user quote, screenshot, link, file path, command output, or code location if available.
  \`Next action\`: the first useful step when someone picks it up.
  \`Why pinned\`: why this is being saved instead of handled immediately.
  \`Unknowns\`: missing decisions or facts that still need confirmation.
- If the information is thin, choose deliberately:
  If local context can answer it cheaply, inspect the relevant code, state, logs, or files before recording and include what you found.
  If the missing information changes scope, product behavior, security, or architecture, ask the user one concise question before recording.
  If the user is clearly deferring and cannot answer now, record the pin anyway but mark assumptions and unknowns explicitly.
- If it is only a personal memo or reminder, a short body is acceptable, but still include why it matters or when to revisit it if that is known.
- For multi-line bodies, pass real newlines. In shell commands, use ANSI-C quoting such as
  \`--body $'line 1\\nline 2'\`; do not put literal \`\\n\` sequences inside ordinary quotes.
- \`--link <url>\`: attach an external reference (GitHub issue, doc, etc.). Use \`--link-type github_issue\` for issue URLs.
- Repo defaults to cwd. Pass \`--repo <path>\` only if you need a different one.

Reading and updating pins:
- \`termcanvas pin list\` — list pins for the current repo (filter \`--status done\` etc.)
- \`termcanvas pin show <id>\` — read a single pin before acting on it
- \`termcanvas pin update <id> --status done\` — mark complete after finishing the work
- \`termcanvas pin update <id> --body "..."\` — refine the description as you learn more

Rules:
- Pins belong to the user. Don't invent pins the user didn't ask for.
- One pin per intent. Three deferred items = three \`pin add\` calls.
- After completing work that originated from a pin, call \`pin update <id> --status done\`.
- The pin store is local to TermCanvas. It does NOT auto-sync to GitHub. If the user wants something on GitHub, they will say so explicitly.
- Status values: \`open\` (default), \`done\`, \`dropped\`. Pick \`dropped\` (not delete) when a pin is abandoned, so the history is preserved.
`;

export type PinInjectStatus = "missing" | "outdated" | "current";
export type PinInstructionStatus =
  | "created"
  | "appended"
  | "updated"
  | "unchanged";

export interface PinInstructionResult {
  fileName: (typeof INSTRUCTION_FILES)[number];
  filePath: string;
  status: PinInstructionStatus;
}

export function checkPinInstructionsStatus(
  targetDir: string,
): PinInjectStatus {
  const desiredSection = PIN_SECTION.trim();
  let worst: PinInjectStatus = "current";

  for (const fileName of INSTRUCTION_FILES) {
    const filePath = path.join(targetDir, fileName);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return "missing";
    }

    const ranges = findPinSectionRanges(content);
    if (ranges.length === 0) return "missing";
    if (ranges.length > 1) {
      worst = "outdated";
      continue;
    }

    const currentSection = extractPinSection(content);
    if (normalizeSection(currentSection ?? "") !== normalizeSection(desiredSection)) {
      worst = "outdated";
    }
  }

  return worst;
}

export function syncPinInstructions(
  targetDir: string,
): PinInstructionResult[] {
  return INSTRUCTION_FILES.map((fileName) =>
    upsertPinInstructions(path.join(targetDir, fileName), fileName),
  );
}

function normalizeSection(section: string): string {
  return section.trim().replace(/\s+$/gm, "");
}

function findPinSectionRanges(
  content: string,
): Array<{ start: number; end: number }> {
  const headingRegex = /^## TermCanvas Pin System$/gm;
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

function extractPinSection(content: string): string | null {
  const range = findPinSectionRanges(content)[0];
  if (!range) return null;
  return content.slice(range.start, range.end).trimEnd();
}

function replacePinSections(content: string): string {
  const ranges = findPinSectionRanges(content);
  if (ranges.length === 0) return content;

  let updated = content.slice(0, ranges[0].start) + PIN_SECTION.trim();
  let cursor = ranges[0].end;
  for (const range of ranges.slice(1)) {
    updated += content.slice(cursor, range.start);
    cursor = range.end;
  }
  updated += content.slice(cursor);
  return updated;
}

function buildAppendedContent(existing: string): string {
  return existing.trimEnd() + "\n\n" + PIN_SECTION.trimStart();
}

function upsertPinInstructions(
  filePath: string,
  fileName: (typeof INSTRUCTION_FILES)[number],
): PinInstructionResult {
  const desiredSection = PIN_SECTION.trim();
  let existing = "";
  let content = "";
  let status: PinInstructionStatus = "created";

  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    content = PIN_SECTION.trimStart();
    fs.writeFileSync(filePath, content);
    return { fileName, filePath, status };
  }

  const ranges = findPinSectionRanges(existing);
  const currentSection = extractPinSection(existing);
  if (ranges.length > 0 && currentSection) {
    if (
      ranges.length === 1 &&
      normalizeSection(currentSection) === normalizeSection(desiredSection)
    ) {
      return { fileName, filePath, status: "unchanged" };
    }
    content = replacePinSections(existing);
    status = "updated";
  } else {
    content = existing
      ? buildAppendedContent(existing)
      : PIN_SECTION.trimStart();
    status = existing ? "appended" : "created";
  }
  fs.writeFileSync(filePath, content);
  return { fileName, filePath, status };
}

export const __PIN_MARKER = MARKER;
