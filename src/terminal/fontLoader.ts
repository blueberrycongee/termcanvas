import { FONT_REGISTRY, type FontEntry } from "./fontRegistry";

export function toFontFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const withLeadingSlash = /^[A-Za-z]:\//.test(normalized)
    ? `/${normalized}`
    : normalized.startsWith("/")
      ? normalized
      : `/${normalized}`;
  return `file://${encodeURI(withLeadingSlash)}`;
}

/** Load a single font into the document via FontFace API */
export async function loadFont(
  entry: FontEntry,
  fontsDir: string,
): Promise<boolean> {
  if (entry.source === "builtin") return true;
  try {
    const filePath = toFontFileUrl(`${fontsDir}/${entry.fileName}`);
    const face = new FontFace(
      entry.cssFamily.replace(/"/g, ""),
      `url("${filePath}")`,
    );
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

/** Load all downloaded fonts on app startup */
export async function loadAllDownloadedFonts(): Promise<void> {
  if (!window.termcanvas?.fonts) {
    return;
  }

  const fontsDir = await window.termcanvas.fonts.getPath();
  const downloaded = await window.termcanvas.fonts.listDownloaded();
  const downloadedSet = new Set(downloaded);

  for (const entry of FONT_REGISTRY) {
    if (entry.source === "builtin") continue;
    if (downloadedSet.has(entry.fileName)) {
      await loadFont(entry, fontsDir);
    }
  }
}
