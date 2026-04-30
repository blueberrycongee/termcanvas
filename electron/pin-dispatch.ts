import fs from "node:fs/promises";
import path from "node:path";
import type { ComposerImageAttachment } from "../src/types";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export interface PinComposerInput {
  id: string;
  title: string;
  body: string;
}

export interface PinComposerPayload {
  text: string;
  images: ComposerImageAttachment[];
}

function usesCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text);
}

function buildPinTaskInstruction(pin: PinComposerInput): string {
  const sourceText = `${pin.title}\n${pin.body}`;
  if (usesCjk(sourceText)) {
    return "这是一个已有的 TermCanvas pin，作为当前对话的上下文提供。不要把它再次记录为新的 pin；请根据用户的后续说明判断是执行、研究还是讨论。如果意图不明确，先询问下一步。";
  }
  return "This is an existing TermCanvas pin provided as context for the current conversation. Do not create or record it as a new pin; use the user's surrounding instructions to decide whether to execute, investigate, or discuss it. If the intent is unclear, ask what to do next.";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip image markdown that points into the pin's attachments dir, read each
 * referenced file, and return the cleaned text plus a ComposerImageAttachment
 * list ready to feed to submitComposerRequest. Non-image links and image
 * references that point outside the attachments dir are left in the text.
 */
export async function buildPinComposerPayload(
  pin: PinComposerInput,
  attachmentsDir: string,
  read: (filePath: string) => Promise<Buffer> = (p) => fs.readFile(p),
): Promise<PinComposerPayload> {
  const escapedId = escapeRegex(pin.id);
  const re = new RegExp(
    `!\\[([^\\]]*)\\]\\(\\.\\/${escapedId}\\.attachments\\/([^)\\s]+)\\)`,
    "g",
  );

  // Prepend the pin title as an h1 so the agent gets the user's framing,
  // not just the description. Title comes first; body follows after a blank
  // line. Empty bodies still produce a usable prompt with just the title.
  const instructionPrefix = `${buildPinTaskInstruction(pin)}\n\n`;
  const titlePrefix = pin.title.trim() ? `# ${pin.title.trim()}\n\n` : "";

  const matches: { full: string; alt: string; basename: string }[] = [];
  for (const m of pin.body.matchAll(re)) {
    matches.push({ full: m[0], alt: m[1] ?? "", basename: m[2] ?? "" });
  }

  if (matches.length === 0) {
    return {
      text: (instructionPrefix + titlePrefix + pin.body).trimEnd(),
      images: [],
    };
  }

  const images: ComposerImageAttachment[] = [];
  const seenBasenames = new Set<string>();
  let cleanedText = pin.body;

  for (const match of matches) {
    if (!match.basename || match.basename.includes("/") || match.basename.includes("..")) {
      continue;
    }
    const ext = path.extname(match.basename).slice(1).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) continue;

    let buffer: Buffer;
    try {
      buffer = await read(path.join(attachmentsDir, match.basename));
    } catch {
      continue;
    }

    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    if (!seenBasenames.has(match.basename)) {
      seenBasenames.add(match.basename);
      const id = match.basename.replace(/\.[^.]+$/, "") || match.basename;
      images.push({
        id,
        name: match.alt || match.basename,
        dataUrl,
      });
    }
    cleanedText = cleanedText.split(match.full).join("");
  }

  cleanedText = cleanedText.replace(/\n{3,}/g, "\n\n").trim();
  const text = (instructionPrefix + titlePrefix + cleanedText).trimEnd();
  return { text, images };
}
