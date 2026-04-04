import type { Page } from "playwright";

export interface RefEntry {
  role: string;
  name: string;
  index: number;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "tab",
  "switch",
  "slider",
  "spinbutton",
  "searchbox",
  "option",
  "menuitemcheckbox",
  "menuitemradio",
]);

interface ParsedLine {
  indent: number;
  role: string;
  name: string;
  raw: string;
}

function parseAriaSnapshot(snapshot: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (const raw of snapshot.split("\n")) {
    if (!raw.trim()) continue;
    const match = raw.match(/^(\s*)- (\w[\w-]*)\s*"([^"]*)"/);
    if (match) {
      lines.push({
        indent: match[1].length,
        role: match[2],
        name: match[3],
        raw,
      });
      continue;
    }
    // Role without name: "- list:" or "- navigation:"
    const matchNoName = raw.match(/^(\s*)- (\w[\w-]*):/);
    if (matchNoName) {
      lines.push({
        indent: matchNoName[1].length,
        role: matchNoName[2],
        name: "",
        raw,
      });
    }
  }
  return lines;
}

export function buildSnapshotFromAria(
  snapshot: string,
  interactiveOnly: boolean,
): { lines: string[]; refs: Map<string, RefEntry> } {
  const parsed = parseAriaSnapshot(snapshot);
  const lines: string[] = [];
  const refs = new Map<string, RefEntry>();
  let refCounter = 1;

  const occurrenceCount = new Map<string, number>();

  for (const item of parsed) {
    const isInteractive = INTERACTIVE_ROLES.has(item.role);
    if (interactiveOnly && !isInteractive) continue;

    const depth = Math.floor(item.indent / 2);
    const indentStr = "  ".repeat(depth);
    let ref = "";
    if (isInteractive) {
      const key = `${item.role}\0${item.name}`;
      const idx = occurrenceCount.get(key) ?? 0;
      occurrenceCount.set(key, idx + 1);
      const refId = `@e${refCounter++}`;
      refs.set(refId, { role: item.role, name: item.name, index: idx });
      ref = `${refId} `;
    }
    lines.push(`${indentStr}${ref}[${item.role}] "${item.name}"`);
  }

  return { lines, refs };
}

export async function takeSnapshot(
  page: Page,
  interactiveOnly: boolean,
): Promise<{ text: string; refs: Map<string, RefEntry> }> {
  const snapshot = await page.locator("body").ariaSnapshot();
  if (!snapshot) return { text: "(empty page)", refs: new Map() };

  const { lines, refs } = buildSnapshotFromAria(snapshot, interactiveOnly);
  return { text: lines.join("\n") || "(no elements found)", refs };
}
