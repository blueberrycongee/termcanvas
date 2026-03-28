import fs from "node:fs";
import path from "node:path";

export async function copyFiles(
  sources: string[],
  destDir: string,
): Promise<{ copied: string[]; skipped: string[] }> {
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const src of sources) {
    const name = path.basename(src);
    const dest = path.join(destDir, name);

    if (fs.existsSync(dest)) {
      skipped.push(name);
      continue;
    }

    await fs.promises.cp(src, dest, { recursive: true });
    copied.push(name);
  }

  return { copied, skipped };
}
