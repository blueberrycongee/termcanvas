export type PinStatus = "open" | "done" | "dropped";

export interface PinLink {
  type: string;
  url: string;
  id?: string;
}

export interface Pin {
  id: string;
  title: string;
  status: PinStatus;
  repo: string;
  body: string;
  links: PinLink[];
  created: string;
  updated: string;
  /**
   * Absolute file:// URL pointing to the directory containing this pin's
   * attachments. Populated only on pins served via IPC; not part of on-disk
   * frontmatter.
   */
  attachmentsUrl?: string;
}

export interface CreatePinInput {
  title: string;
  repo: string;
  body?: string;
  status?: PinStatus;
  links?: PinLink[];
}

export interface UpdatePinInput {
  title?: string;
  status?: PinStatus;
  body?: string;
  links?: PinLink[];
}

export function normalizePinBodyInput(body: string): string {
  const trimmed = body.trim();
  if (!shouldDecodeEscapedLineBreaks(trimmed)) return trimmed;
  return trimmed
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}

function shouldDecodeEscapedLineBreaks(text: string): boolean {
  const escapedLineBreaks = text.match(/(?:\\r\\n|\\n)/g)?.length ?? 0;
  if (escapedLineBreaks >= 2) return true;
  return /(?:\\r\\n|\\n)(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>\s)/.test(text);
}
