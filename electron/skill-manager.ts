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

function getClaudeSkillsDir(home: string): string {
  return path.join(home, ".claude", "skills");
}

function getClaudePluginsFile(home: string): string {
  return path.join(home, ".claude", "plugins", "installed_plugins.json");
}

function getClaudeSettingsFile(home: string): string {
  return path.join(home, ".claude", "settings.json");
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

// Claude Code settings.json — enable plugin for hooks

/** Ensure termcanvas plugin is enabled and hooks are registered in settings.json. */
function ensurePluginEnabled(settingsFile: string, sourceDir: string): void {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
  } catch {}

  let changed = false;

  // Enable plugin
  const enabled = (data.enabledPlugins ?? {}) as Record<string, boolean>;
  if (enabled[PLUGIN_KEY] !== true) {
    enabled[PLUGIN_KEY] = true;
    data.enabledPlugins = enabled;
    changed = true;
  }

  // Register SessionStart hook with absolute path (Claude Code reads hooks from settings.json)
  const scriptPath = path.join(sourceDir, "scripts", "memory-session-start.sh");
  const hooks = (data.hooks ?? {}) as Record<string, unknown[]>;
  const sessionStart = (hooks.SessionStart ?? []) as Array<{
    matcher?: string;
    hooks?: Array<{ type: string; command: string; timeout?: number }>;
  }>;

  const hookCommand = `bash '${scriptPath}'`;
  const scriptName = "memory-session-start.sh";

  // Remove any existing termcanvas memory hooks (may have stale dev/prod paths)
  const filtered = sessionStart.filter(
    (entry) => !entry.hooks?.some((h) => h.command.includes(scriptName)),
  );
  const needsUpdate = filtered.length !== sessionStart.length;

  // Add with current path
  filtered.push({
    matcher: "startup|clear|compact",
    hooks: [
      {
        type: "command",
        command: hookCommand,
        timeout: 10,
      },
    ],
  });
  hooks.SessionStart = filtered;
  data.hooks = hooks;
  changed = true;

  if (!changed) return;

  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const tmp = settingsFile + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, settingsFile);
}

// Skill manifest — tracks which skills we installed and at which version

const MANIFEST_FILE = ".termcanvas-skills.json";

interface SkillManifest {
  version: string;
  skills: string[];
}

function readManifest(targetDir: string): SkillManifest | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(targetDir, MANIFEST_FILE), "utf-8"),
    ) as SkillManifest;
  } catch {
    return null;
  }
}

function writeManifest(targetDir: string, manifest: SkillManifest): void {
  const filePath = path.join(targetDir, MANIFEST_FILE);
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function removeManifest(targetDir: string): void {
  try {
    fs.unlinkSync(path.join(targetDir, MANIFEST_FILE));
  } catch {}
}

// Symlink helpers

function isSymlinkCurrent(linkPath: string, expectedTarget: string): boolean {
  try {
    return fs.readlinkSync(linkPath) === expectedTarget;
  } catch {
    return false;
  }
}

/** Scan bundled skill directories and return their names. */
function listBundledSkills(sourceDir: string): string[] {
  const skillsRoot = path.join(sourceDir, "skills");
  if (!fs.existsSync(skillsRoot)) return [];

  const names: string[] = [];
  for (const name of fs.readdirSync(skillsRoot)) {
    try {
      if (fs.statSync(path.join(skillsRoot, name)).isDirectory()) {
        names.push(name);
      }
    } catch {}
  }
  return names;
}

/**
 * Install skill symlinks into a target directory.
 * Compares manifest version to decide between fast-path verification and
 * full reconciliation (create/update symlinks + remove stale ones).
 */
function installSkillLinksTo(
  targetDir: string,
  sourceDir: string,
  appVersion: string,
): void {
  const skillsRoot = path.join(sourceDir, "skills");
  const currentSkills = listBundledSkills(sourceDir);
  if (currentSkills.length === 0) return;

  fs.mkdirSync(targetDir, { recursive: true });

  const oldManifest = readManifest(targetDir);

  // Fast path: version matches → verify symlinks, skip manifest write
  if (oldManifest?.version === appVersion) {
    let allCurrent = true;
    for (const name of currentSkills) {
      if (
        !isSymlinkCurrent(
          path.join(targetDir, name),
          path.join(skillsRoot, name),
        )
      ) {
        allCurrent = false;
        break;
      }
    }
    if (allCurrent) return;
  }

  // Full reconciliation
  const linkType = getSkillLinkType();

  for (const name of currentSkills) {
    const skillDir = path.join(skillsRoot, name);
    const link = path.join(targetDir, name);

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

  // Remove skills that existed in previous version but were dropped
  if (oldManifest) {
    const currentSet = new Set(currentSkills);
    for (const name of oldManifest.skills) {
      if (currentSet.has(name)) continue;
      const link = path.join(targetDir, name);
      try {
        if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
      } catch {}
    }
  }

  writeManifest(targetDir, { version: appVersion, skills: currentSkills });
}

/** Remove skill symlinks from a target directory. */
function removeSkillLinksFrom(targetDir: string, sourceDir: string): void {
  const skillsRoot = path.join(sourceDir, "skills");

  // Remove current bundle skills
  if (fs.existsSync(skillsRoot)) {
    for (const name of fs.readdirSync(skillsRoot)) {
      const link = path.join(targetDir, name);
      try {
        if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
      } catch {}
    }
  }

  // Also remove any skills tracked by manifest (covers skills removed between versions)
  const manifest = readManifest(targetDir);
  if (manifest) {
    for (const name of manifest.skills) {
      const link = path.join(targetDir, name);
      try {
        if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
      } catch {}
    }
  }

  removeManifest(targetDir);
}

function installAllSkillLinks(
  sourceDir: string,
  home: string,
  appVersion: string,
): void {
  installSkillLinksTo(getClaudeSkillsDir(home), sourceDir, appVersion);
  installSkillLinksTo(getCodexSkillsDir(home), sourceDir, appVersion);
}

function removeAllSkillLinks(sourceDir: string, home: string): void {
  removeSkillLinksFrom(getClaudeSkillsDir(home), sourceDir);
  removeSkillLinksFrom(getCodexSkillsDir(home), sourceDir);
}

// Lifecycle hook registration (CC hook-based monitoring)

const LIFECYCLE_HOOK_EVENTS = [
  "SessionStart",
  "Stop",
  "StopFailure",
  "SessionEnd",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
] as const;

const LIFECYCLE_MARKER = "termcanvas-hook.mjs";

function ensureLifecycleHooks(settingsFile: string, scriptPath: string): void {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
  } catch {}

  const hooks = (data.hooks ?? {}) as Record<string, unknown[]>;
  const hookCommand = `node '${scriptPath}'`;

  for (const eventName of LIFECYCLE_HOOK_EVENTS) {
    const existing = (hooks[eventName] ?? []) as Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string; timeout?: number; async?: boolean }>;
    }>;

    // Remove any existing lifecycle hooks (by marker)
    const filtered = existing.filter(
      (entry) => !entry.hooks?.some((h) => h.command.includes(LIFECYCLE_MARKER)),
    );

    // SessionStart blocks briefly to capture session_id; all others are async
    const isAsync = eventName !== "SessionStart";

    filtered.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command: hookCommand,
          timeout: 5,
          ...(isAsync ? { async: true } : {}),
        },
      ],
    });

    hooks[eventName] = filtered;
  }

  data.hooks = hooks;

  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const tmp = settingsFile + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, settingsFile);
}

function removeLifecycleHooks(settingsFile: string): void {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
  } catch {
    return;
  }

  const hooks = (data.hooks ?? {}) as Record<string, unknown[]>;
  let changed = false;

  for (const eventName of LIFECYCLE_HOOK_EVENTS) {
    const existing = (hooks[eventName] ?? []) as Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string }>;
    }>;

    const filtered = existing.filter(
      (entry) => !entry.hooks?.some((h) => h.command.includes(LIFECYCLE_MARKER)),
    );

    if (filtered.length !== existing.length) {
      changed = true;
      if (filtered.length === 0) {
        delete hooks[eventName];
      } else {
        hooks[eventName] = filtered;
      }
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete data.hooks;
  } else {
    data.hooks = hooks;
  }

  if (!changed) return;

  const tmp = settingsFile + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, settingsFile);
}

// Public API

/**
 * Full install: register Claude plugin + create skill symlinks.
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
    ensurePluginEnabled(getClaudeSettingsFile(home), sourceDir);
    ensureLifecycleHooks(
      getClaudeSettingsFile(home),
      path.join(sourceDir, "scripts", "termcanvas-hook.mjs"),
    );
    installAllSkillLinks(sourceDir, home, appVersion);
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

    ensurePluginEnabled(getClaudeSettingsFile(home), sourceDir);
    ensureLifecycleHooks(
      getClaudeSettingsFile(home),
      path.join(sourceDir, "scripts", "termcanvas-hook.mjs"),
    );
    installAllSkillLinks(sourceDir, home, appVersion);

    return true;
  } catch (err) {
    console.error("[SkillManager] ensure failed:", err);
    return false;
  }
}

/**
 * Uninstall: remove Claude plugin entry + skill symlinks.
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
    removeLifecycleHooks(getClaudeSettingsFile(home));
    removeAllSkillLinks(sourceDir, home);
    return true;
  } catch (err) {
    console.error("[SkillManager] uninstall failed:", err);
    return false;
  }
}
