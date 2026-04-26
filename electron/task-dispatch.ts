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

export interface TaskComposerInput {
  id: string;
  body: string;
}

export interface TaskComposerPayload {
  text: string;
  images: ComposerImageAttachment[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip image markdown that points into the task's attachments dir, read each
 * referenced file, and return the cleaned text plus a ComposerImageAttachment
 * list ready to feed to submitComposerRequest. Non-image links and image
 * references that point outside the attachments dir are left in the text.
 */
export async function buildTaskComposerPayload(
  task: TaskComposerInput,
  attachmentsDir: string,
  read: (filePath: string) => Promise<Buffer> = (p) => fs.readFile(p),
): Promise<TaskComposerPayload> {
  const escapedId = escapeRegex(task.id);
  const re = new RegExp(
    `!\\[([^\\]]*)\\]\\(\\.\\/${escapedId}\\.attachments\\/([^)\\s]+)\\)`,
    "g",
  );

  const matches: { full: string; alt: string; basename: string }[] = [];
  for (const m of task.body.matchAll(re)) {
    matches.push({ full: m[0], alt: m[1] ?? "", basename: m[2] ?? "" });
  }

  if (matches.length === 0) {
    return { text: task.body, images: [] };
  }

  const images: ComposerImageAttachment[] = [];
  const seenBasenames = new Set<string>();
  let cleanedText = task.body;

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
  return { text: cleanedText, images };
}
