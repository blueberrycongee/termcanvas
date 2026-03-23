# Terminal Rename via AI Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Claude Code / Codex users rename their TermCanvas terminal tab via a `/termcanvas:rename` skill that generates a title from conversation context.

**Architecture:** Three layers — (1) migrate skill distribution from per-skill symlinks to a Claude Code plugin, (2) add CLI `set-title` command backed by HTTP API + renderer bridge, (3) add rename SKILL.md to the plugin.

**Tech Stack:** TypeScript (Electron main + renderer + CLI), SKILL.md (Markdown with YAML frontmatter)

**Review notes:** Codex reviewed the original plan and raised three high-priority issues. All three are addressed in this revision:
1. `installed_plugins.json` safety — parse failure now skips mutation; atomic write via temp file + rename
2. Skill naming — plugin skills are namespaced as `/termcanvas:rename`, not `/rename`
3. Idempotency — `ensureSkillLinks` now has a fast path that skips work when state is current

---

### Task 1: Create plugin directory structure

**Files:**
- Create: `skills/.claude-plugin/plugin.json`
- Move: `hydra/skill/SKILL.md` → `skills/skills/hydra/SKILL.md`

**Step 1: Create plugin manifest**

Create `skills/.claude-plugin/plugin.json`:
```json
{
  "name": "termcanvas",
  "description": "TermCanvas terminal management skills: Hydra sub-agent spawning, terminal renaming, and more.",
  "author": {
    "name": "blueberrycongee"
  }
}
```

**Step 2: Move Hydra skill**

```bash
mkdir -p skills/skills/hydra
cp hydra/skill/SKILL.md skills/skills/hydra/SKILL.md
```

Keep `hydra/skill/SKILL.md` in place for now (removed in Task 5 after migration is wired up).

**Step 3: Verify structure**

```
skills/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── hydra/
        └── SKILL.md
```

**Step 4: Commit**

```bash
git add skills/
git commit -m "feat: create termcanvas plugin structure with hydra skill"
```

---

### Task 2: Add `setCustomTitle` to renderer bridge

**Files:**
- Modify: `src/App.tsx` (the `__tcApi` object, around line 420-446)

**Step 1: Add setCustomTitle method**

In `src/App.tsx`, add to the `api` object (after `getTerminal`):

```typescript
setCustomTitle: (terminalId: string, customTitle: string) => {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      const t = w.terminals.find((t) => t.id === terminalId);
      if (t) {
        useProjectStore.getState().updateTerminalCustomTitle(
          p.id, w.id, terminalId, customTitle,
        );
        return true;
      }
    }
  }
  throw new Error("Terminal not found");
},
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add setCustomTitle to renderer bridge API"
```

---

### Task 3: Add HTTP API route for custom title

**Files:**
- Modify: `electron/api-server.ts` (route method around line 66-127, and add handler)

**Step 1: Add route match**

In `api-server.ts`, add to the `route()` method after the `DELETE /terminal/` block (around line 112):

```typescript
if (method === "PUT" && pathname.match(/^\/terminal\/[^/]+\/custom-title$/)) {
  const id = pathname.split("/")[2];
  return this.terminalSetCustomTitle(id, body);
}
```

**Step 2: Add handler method**

Add after `terminalDestroy` method:

```typescript
private async terminalSetCustomTitle(terminalId: string, body: any) {
  const customTitle = body?.customTitle;
  if (typeof customTitle !== "string")
    throw Object.assign(new Error("customTitle is required"), { status: 400 });

  await this.execRenderer(
    `window.__tcApi.setCustomTitle(${JSON.stringify(terminalId)}, ${JSON.stringify(customTitle)})`,
  );
  return { ok: true };
}
```

Note: `readBody` currently only parses for POST and DELETE. Add PUT:

In `handleRequest`, change:
```typescript
const body =
  method === "POST" || method === "DELETE"
    ? await this.readBody(req)
    : null;
```
to:
```typescript
const body =
  method === "POST" || method === "PUT" || method === "DELETE"
    ? await this.readBody(req)
    : null;
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add electron/api-server.ts
git commit -m "feat: add PUT /terminal/{id}/custom-title API route"
```

---

### Task 4: Add CLI `set-title` subcommand

**Files:**
- Modify: `cli/termcanvas.ts` (terminal command block around line 101-173)

**Step 1: Add set-title command**

In `cli/termcanvas.ts`, add after the `destroy` block (around line 169) and before the `else` usage block:

```typescript
} else if (command === "set-title" && rest[0] && rest[1]) {
  const title = rest.slice(1).join(" ");
  const result = await request("PUT", `/terminal/${rest[0]}/custom-title`, {
    customTitle: title,
  });
  if (jsonFlag) console.log(JSON.stringify(result, null, 2));
  else console.log("Title updated.");
```

**Step 2: Update usage help**

In the usage help block at the bottom, add:

```typescript
console.log(
  "  terminal set-title <id> <title>              Set custom title",
);
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Manual test (dev mode)**

```bash
# Start TermCanvas in dev mode, then:
termcanvas terminal list
# Pick a terminal ID, then:
termcanvas terminal set-title <id> "Test Title"
# Verify the title changes in the UI
```

**Step 5: Commit**

```bash
git add cli/termcanvas.ts
git commit -m "feat: add terminal set-title CLI subcommand"
```

---

### Task 5: Refactor skill-manager and update build config

**Files:**
- Rename: `electron/hydra-skill.ts` → `electron/skill-manager.ts`
- Modify: `electron/main.ts` (imports and function calls)
- Modify: `electron-builder.yml` (extraResources)
- Delete: `hydra/skill/SKILL.md` (moved to `skills/skills/hydra/` in Task 1)

**Step 1: Rewrite hydra-skill.ts as skill-manager.ts**

Create `electron/skill-manager.ts` replacing `hydra-skill.ts`:

```typescript
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

// ── Path helpers ──────────────────────────────────────────────────────

function getCodexSkillsDir(home: string): string {
  return path.join(home, ".codex", "skills");
}

function getClaudePluginsFile(home: string): string {
  return path.join(home, ".claude", "plugins", "installed_plugins.json");
}

// ── installed_plugins.json helpers (safe read / atomic write) ─────────

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

// ── Claude Code plugin registration ───────────────────────────────────

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
function registerClaudePlugin(filePath: string, sourceDir: string, appVersion: string): boolean {
  let data = readInstalledPlugins(filePath);
  if (!data) {
    // File missing or empty — create fresh; file corrupt — skip and warn
    try {
      fs.accessSync(filePath);
      // File exists but corrupt — do not overwrite
      console.warn("[SkillManager] installed_plugins.json is corrupt, skipping Claude plugin registration");
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
  if (!data) return true; // nothing to remove

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

// ── Codex symlinks ────────────────────────────────────────────────────

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
    } catch { continue; }

    const link = path.join(codexDir, name);

    // Skip if already correct
    if (isSymlinkCurrent(link, skillDir)) continue;

    // Only replace symlinks owned by us, not user-created directories
    try {
      const stat = fs.lstatSync(link);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(link);
      } else {
        // User-created file/dir — do not replace
        console.warn(`[SkillManager] skipping ${link}: not a symlink, may be user-managed`);
        continue;
      }
    } catch {
      // Does not exist — proceed to create
    }

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
    } catch { /* ignore */ }
  }
}

// ── Old hydra symlink cleanup ─────────────────────────────────────────

function cleanupOldHydraSymlinks(home: string): void {
  const oldPaths = [
    path.join(home, ".claude", "skills", "hydra"),
    path.join(home, ".codex", "skills", "hydra"),
  ];
  for (const p of oldPaths) {
    try {
      const stat = fs.lstatSync(p);
      if (!stat.isSymbolicLink()) continue; // user-managed — leave it
      const target = fs.readlinkSync(p);
      // Only remove links that TermCanvas created (point to app Resources)
      if (target.includes("Resources/skill") || target.includes("Resources\\skill")) {
        fs.unlinkSync(p);
      }
    } catch { /* ignore */ }
  }
}

// ── Public API ────────────────────────────────────────────────────────

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

    // Claude: only re-register if entry is stale or missing
    if (!isClaudePluginCurrent(pluginsFile, sourceDir)) {
      registerClaudePlugin(pluginsFile, sourceDir, appVersion);
    }

    // Codex: installCodexSkillLinks already has per-link fast path
    installCodexSkillLinks(sourceDir, home);

    // Clean up old hydra links (idempotent — no-op once cleaned)
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
```

**Step 2: Update main.ts imports**

Replace:
```typescript
import {
  getHydraSkillSourceDir,
  installHydraSkillLinks,
  uninstallHydraSkillLinks,
  ensureHydraSkillLinks,
} from "./hydra-skill";
```

With:
```typescript
import {
  getSkillsSourceDir,
  installSkillLinks,
  uninstallSkillLinks,
  ensureSkillLinks,
} from "./skill-manager";
```

Update the helper functions in main.ts:

```typescript
function getSkillSourceDir(): string {
  return getSkillsSourceDir(process.resourcesPath, __dirname);
}

function installSkill(): boolean {
  return installSkillLinks({
    sourceDir: getSkillSourceDir(),
    appVersion: app.getVersion(),
  });
}

function ensureSkillInstalled(): boolean {
  return ensureSkillLinks({
    sourceDir: getSkillSourceDir(),
    appVersion: app.getVersion(),
  });
}

function uninstallSkill(): boolean {
  return uninstallSkillLinks({ sourceDir: getSkillSourceDir() });
}
```

**Step 3: Update electron-builder.yml**

Replace:
```yaml
  - from: hydra/skill
    to: skill
    filter:
      - "**/*"
```

With:
```yaml
  - from: skills
    to: skills
    filter:
      - "**/*"
```

**Step 4: Delete old files**

```bash
rm hydra/skill/SKILL.md
rmdir hydra/skill
rm electron/hydra-skill.ts
```

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: migrate skill distribution to Claude Code plugin system"
```

---

### Task 6: Create rename SKILL.md

**Files:**
- Create: `skills/skills/rename/SKILL.md`

**Step 1: Write the skill**

Create `skills/skills/rename/SKILL.md`:

````markdown
---
name: rename
description: This skill should be used when the user asks to "rename this terminal", "set terminal title", "give this tab a name", or invokes "/termcanvas:rename". Generates a concise title from recent conversation context and sets it on the TermCanvas terminal tab via the termcanvas CLI.
---

# Rename Terminal Tab

Generate a concise title for the current TermCanvas terminal tab based on the
conversation so far, then apply it.

## Steps

1. Review the recent conversation context (last few exchanges)
2. Generate a short, descriptive title (3-8 words) that captures the main task
   or topic. Match the language of the conversation (e.g. Chinese if the user
   writes in Chinese).
3. Read the terminal ID from the environment variable `$TERMCANVAS_TERMINAL_ID`
4. Run:

```bash
termcanvas terminal set-title "$TERMCANVAS_TERMINAL_ID" "<generated title>"
```

## Rules

- If `$TERMCANVAS_TERMINAL_ID` is not set, inform the user that this command
  only works inside a TermCanvas terminal.
- The title should describe the work being done, not be generic
  (e.g. "fix auth token refresh" not "coding session").
- Do NOT ask the user what title they want — generate it yourself from context.
- Keep it concise: 3-8 words max.
````

**Step 2: Commit**

```bash
git add skills/skills/rename/SKILL.md
git commit -m "feat: add rename skill for AI-driven terminal tab naming"
```

---

### Task 7: Verify end-to-end

**Step 1: Build**

```bash
npx tsc --noEmit
npx vite build
```

**Step 2: Verify plugin structure**

```bash
ls skills/.claude-plugin/plugin.json
ls skills/skills/hydra/SKILL.md
ls skills/skills/rename/SKILL.md
```

**Step 3: Manual test in dev mode**

1. Start TermCanvas dev
2. Run `termcanvas terminal list` — pick a terminal ID
3. Run `termcanvas terminal set-title <id> "Test Rename"` — verify title updates in UI
4. Verify skill files are accessible from bundled app path

**Step 4: Clean up old hydra/skill directory if empty**

```bash
# If hydra/skill/ is now empty, remove it
rmdir hydra/skill 2>/dev/null
```
