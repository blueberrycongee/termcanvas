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
