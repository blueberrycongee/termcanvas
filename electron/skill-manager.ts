import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function getSkillLinkType(platform = process.platform): "junction" | "dir" {
  return platform === "win32" ? "junction" : "dir";
}

/** Resolve the bundled skills/ directory (plugin root). */
export function getSkillsSourceDir(
  resourcesPath: string,
  currentDir: string,
): string {
  const prodDir = path.join(resourcesPath, "skills");
  if (fs.existsSync(prodDir)) return prodDir;
  return path.resolve(currentDir, "..", "skills");
}

// Path helpers

function getCodexSkillsDir(home: string): string {
  return path.join(home, ".codex", "skills");
}

function getClaudePluginsFile(home: string): string {
  return path.join(home, ".claude", "plugins", "installed_plugins.json");
}

// installed_plugins.json helpers (safe read / atomic write)

const PLUGIN_KEY = "termcanvas@termcanvas";

interface PluginEntry {
  scope: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
}

interface InstalledPlugins {
  version: number;
  plugins: Record<string, PluginEntry[]>;
}

/**
 * Read installed_plugins.json safely.
 * Returns null on any failure — caller must decide whether to proceed.
 */
function readInstalledPlugins(filePath: string): InstalledPlugins | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || !raw || typeof raw.plugins !== "object") {
      return null;
    }
    return raw as InstalledPlugins;
  } catch {
    return null;
  }
}

/** Atomic write: write to temp file then rename. */
function writeInstalledPlugins(filePath: string, data: InstalledPlugins): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

// Claude Code plugin registration

/** Check if the Claude plugin entry already points to sourceDir. */
function isClaudePluginCurrent(filePath: string, sourceDir: string): boolean {
  const data = readInstalledPlugins(filePath);
  if (!data) return false;
  const entries = data.plugins[PLUGIN_KEY];
  if (!Array.isArray(entries) || entries.length === 0) return false;
  return entries.some((e) => e.scope === "user" && e.installPath === sourceDir);
}

/**
 * Register the termcanvas plugin in installed_plugins.json.
 * Preserves all other plugin entries. Only mutates the termcanvas entry.
 */
function registerClaudePlugin(
  filePath: string,
  sourceDir: string,
  appVersion: string,
): boolean {
  let data = readInstalledPlugins(filePath);
  if (!data) {
    // File missing or empty — create fresh; file corrupt — skip and warn
    try {
      fs.accessSync(filePath);
      // File exists but corrupt — do not overwrite
      console.warn(
        "[SkillManager] installed_plugins.json is corrupt, skipping Claude plugin registration",
      );
      return false;
    } catch {
      // File does not exist — safe to create
      data = { version: 2, plugins: {} };
    }
  }

  // Merge: only touch our entry, preserve everything else
  const existing = data.plugins[PLUGIN_KEY];
  const userEntries = Array.isArray(existing)
    ? existing.filter((e) => e.scope !== "user")
    : [];

  userEntries.push({
    scope: "user",
    installPath: sourceDir,
    version: appVersion,
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  });

  data.plugins[PLUGIN_KEY] = userEntries;
  writeInstalledPlugins(filePath, data);
  return true;
}

/** Remove the termcanvas plugin entry (user scope only). */
function unregisterClaudePlugin(filePath: string): boolean {
  const data = readInstalledPlugins(filePath);
  if (!data) return true;

  const existing = data.plugins[PLUGIN_KEY];
  if (!existing) return true;

  const remaining = Array.isArray(existing)
    ? existing.filter((e) => e.scope !== "user")
    : [];

  if (remaining.length > 0) {
    data.plugins[PLUGIN_KEY] = remaining;
  } else {
    delete data.plugins[PLUGIN_KEY];
  }

  writeInstalledPlugins(filePath, data);
  return true;
}

// Codex symlinks

/** Check if a symlink already points to the expected target. */
function isSymlinkCurrent(linkPath: string, expectedTarget: string): boolean {
  try {
    return fs.readlinkSync(linkPath) === expectedTarget;
  } catch {
    return false;
  }
}

/** Install Codex skill symlinks by scanning the skills/ subdirectory. */
function installCodexSkillLinks(sourceDir: string, home: string): void {
  const linkType = getSkillLinkType();
  const codexDir = getCodexSkillsDir(home);
  const skillsRoot = path.join(sourceDir, "skills");
  if (!fs.existsSync(skillsRoot)) return;

  fs.mkdirSync(codexDir, { recursive: true });

  for (const name of fs.readdirSync(skillsRoot)) {
    const skillDir = path.join(skillsRoot, name);
    try {
      if (!fs.statSync(skillDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const link = path.join(codexDir, name);

    if (isSymlinkCurrent(link, skillDir)) continue;

    try {
      const stat = fs.lstatSync(link);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(link);
      } else {
        console.warn(
          `[SkillManager] skipping ${link}: not a symlink, may be user-managed`,
        );
        continue;
      }
    } catch {}

    fs.symlinkSync(skillDir, link, linkType);
  }
}

/** Remove Codex skill symlinks by scanning the skills/ subdirectory. */
function removeCodexSkillLinks(sourceDir: string, home: string): void {
  const codexDir = getCodexSkillsDir(home);
  const skillsRoot = path.join(sourceDir, "skills");
  if (!fs.existsSync(skillsRoot)) return;

  for (const name of fs.readdirSync(skillsRoot)) {
    const link = path.join(codexDir, name);
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {}
  }
}

// Old hydra symlink cleanup

function cleanupOldHydraSymlinks(home: string): void {
  const oldPaths = [
    path.join(home, ".claude", "skills", "hydra"),
    path.join(home, ".codex", "skills", "hydra"),
  ];
  for (const p of oldPaths) {
    try {
      const stat = fs.lstatSync(p);
      if (!stat.isSymbolicLink()) continue;
      const target = fs.readlinkSync(p);
      if (target.includes("Resources/skill") || target.includes("Resources\\skill")) {
        fs.unlinkSync(p);
      }
    } catch {}
  }
}

// Public API

/**
 * Full install: register Claude plugin + create Codex symlinks + clean old links.
 * Called when user registers the CLI.
 */
export function installSkillLinks({
  home = os.homedir(),
  sourceDir,
  appVersion = "1.0.0",
}: {
  home?: string;
  sourceDir: string;
  appVersion?: string;
}): boolean {
  try {
    registerClaudePlugin(getClaudePluginsFile(home), sourceDir, appVersion);
    installCodexSkillLinks(sourceDir, home);
    cleanupOldHydraSymlinks(home);
    return true;
  } catch (err) {
    console.error("[SkillManager] install failed:", err);
    return false;
  }
}

/**
 * Ensure skills are current. Called on every app startup.
 * Has fast paths — skips work when state is already correct.
 */
export function ensureSkillLinks({
  home = os.homedir(),
  sourceDir,
  appVersion = "1.0.0",
}: {
  home?: string;
  sourceDir: string;
  appVersion?: string;
}): boolean {
  try {
    const pluginsFile = getClaudePluginsFile(home);

    if (!isClaudePluginCurrent(pluginsFile, sourceDir)) {
      registerClaudePlugin(pluginsFile, sourceDir, appVersion);
    }

    installCodexSkillLinks(sourceDir, home);
    cleanupOldHydraSymlinks(home);

    return true;
  } catch (err) {
    console.error("[SkillManager] ensure failed:", err);
    return false;
  }
}

/**
 * Uninstall: remove Claude plugin entry + Codex symlinks + old hydra links.
 * Called when user unregisters the CLI.
 */
export function uninstallSkillLinks({
  home = os.homedir(),
  sourceDir,
}: {
  home?: string;
  sourceDir: string;
}): boolean {
  try {
    unregisterClaudePlugin(getClaudePluginsFile(home));
    removeCodexSkillLinks(sourceDir, home);
    cleanupOldHydraSymlinks(home);
    return true;
  } catch (err) {
    console.error("[SkillManager] uninstall failed:", err);
    return false;
  }
}
