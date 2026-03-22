import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getHydraSkillLinks(home = os.homedir()): string[] {
  return [
    path.join(home, ".claude", "skills", "hydra"),
    path.join(home, ".codex", "skills", "hydra"),
  ];
}

export function getHydraSkillSourceDir(
  resourcesPath: string,
  currentDir: string,
): string {
  const prodDir = path.join(resourcesPath, "skill");
  if (fs.existsSync(prodDir)) return prodDir;
  return path.resolve(currentDir, "..", "hydra", "skill");
}

export function installHydraSkillLinks({
  home = os.homedir(),
  sourceDir,
}: {
  home?: string;
  sourceDir: string;
}): boolean {
  try {
    for (const link of getHydraSkillLinks(home)) {
      fs.mkdirSync(path.dirname(link), { recursive: true });
      try {
        fs.unlinkSync(link);
      } catch {
        // ignore missing stale links
      }
      fs.symlinkSync(sourceDir, link, process.platform === 'win32' ? 'junction' : undefined);
    }
    return true;
  } catch {
    return false;
  }
}

export function ensureHydraSkillLinks({
  home = os.homedir(),
  sourceDir,
}: {
  home?: string;
  sourceDir: string;
}): boolean {
  try {
    for (const link of getHydraSkillLinks(home)) {
      fs.mkdirSync(path.dirname(link), { recursive: true });

      let alreadyCurrent = false;
      try {
        alreadyCurrent = fs.readlinkSync(link) === sourceDir;
      } catch {
        alreadyCurrent = false;
      }
      if (alreadyCurrent) continue;

      try {
        fs.unlinkSync(link);
      } catch {
        // ignore missing stale links
      }
      fs.symlinkSync(sourceDir, link, process.platform === 'win32' ? 'junction' : undefined);
    }
    return true;
  } catch {
    return false;
  }
}

export function uninstallHydraSkillLinks(home = os.homedir()): boolean {
  try {
    for (const link of getHydraSkillLinks(home)) {
      try {
        fs.unlinkSync(link);
      } catch {
        // ignore missing links
      }
    }
    return true;
  } catch {
    return false;
  }
}
