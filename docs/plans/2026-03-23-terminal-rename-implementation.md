# Terminal Rename via AI Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Claude Code / Codex users rename their TermCanvas terminal tab via a `/rename` skill that generates a title from conversation context.

**Architecture:** Three layers — (1) migrate skill distribution from per-skill symlinks to a Claude Code plugin, (2) add CLI `set-title` command backed by HTTP API + renderer bridge, (3) add rename SKILL.md to the plugin.

**Tech Stack:** TypeScript (Electron main + renderer + CLI), SKILL.md (Markdown with YAML frontmatter)

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

export function getSkillLinkType(platform = process.platform): "junction" | "dir" {
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

/**
 * Target paths for skill installation.
 * Claude Code: register as plugin via installed_plugins.json
 * Codex: symlink individual skills to ~/.codex/skills/<name>
 */

function getCodexSkillsDir(home: string): string {
  return path.join(home, ".codex", "skills");
}

function getClaudePluginsFile(home: string): string {
  return path.join(home, ".claude", "plugins", "installed_plugins.json");
}

/** Read installed_plugins.json, returning the parsed object. */
function readInstalledPlugins(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return { version: 2, plugins: {} };
  }
}

/** Write installed_plugins.json. */
function writeInstalledPlugins(filePath: string, data: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

const PLUGIN_KEY = "termcanvas@termcanvas";

/** Install skills: register Claude Code plugin + symlink Codex skills. */
export function installSkillLinks({
  home = os.homedir(),
  sourceDir,
}: {
  home?: string;
  sourceDir: string;
}): boolean {
  try {
    // Claude Code: register plugin in installed_plugins.json
    const pluginsFile = getClaudePluginsFile(home);
    const data = readInstalledPlugins(pluginsFile);
    data.plugins[PLUGIN_KEY] = [
      {
        scope: "user",
        installPath: sourceDir,
        version: "1.0.0",
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    ];
    writeInstalledPlugins(pluginsFile, data);

    // Codex: symlink individual skills
    const linkType = getSkillLinkType();
    const codexDir = getCodexSkillsDir(home);
    const skillsRoot = path.join(sourceDir, "skills");
    if (fs.existsSync(skillsRoot)) {
      for (const name of fs.readdirSync(skillsRoot)) {
        const skillDir = path.join(skillsRoot, name);
        if (!fs.statSync(skillDir).isDirectory()) continue;
        const link = path.join(codexDir, name);
        fs.mkdirSync(codexDir, { recursive: true });
        try { fs.unlinkSync(link); } catch { /* ignore */ }
        fs.symlinkSync(skillDir, link, linkType);
      }
    }

    // Clean up old hydra-only symlinks
    const oldClaudeHydra = path.join(home, ".claude", "skills", "hydra");
    try {
      const target = fs.readlinkSync(oldClaudeHydra);
      if (target.includes("Resources/skill")) fs.unlinkSync(oldClaudeHydra);
    } catch { /* ignore */ }

    return true;
  } catch {
    return false;
  }
}

/** Ensure skill links are current (idempotent, called on startup). */
export function ensureSkillLinks({
  home = os.homedir(),
  sourceDir,
}: {
  home?: string;
  sourceDir: string;
}): boolean {
  // Just re-run install — it's idempotent
  return installSkillLinks({ home, sourceDir });
}

/** Uninstall skills: remove plugin registration + Codex symlinks. */
export function uninstallSkillLinks(home = os.homedir()): boolean {
  try {
    // Remove Claude Code plugin entry
    const pluginsFile = getClaudePluginsFile(home);
    const data = readInstalledPlugins(pluginsFile);
    delete data.plugins[PLUGIN_KEY];
    writeInstalledPlugins(pluginsFile, data);

    // Remove Codex skill symlinks
    const codexDir = getCodexSkillsDir(home);
    for (const name of ["hydra", "rename"]) {
      try { fs.unlinkSync(path.join(codexDir, name)); } catch { /* ignore */ }
    }

    // Clean up old hydra symlink
    try { fs.unlinkSync(path.join(home, ".claude", "skills", "hydra")); } catch { /* ignore */ }

    return true;
  } catch {
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

Update the three functions in main.ts:

```typescript
function getSkillSourceDir(): string {
  return getSkillsSourceDir(process.resourcesPath, __dirname);
}

function installSkill(): boolean {
  return installSkillLinks({ sourceDir: getSkillSourceDir() });
}

function ensureSkillInstalled(): boolean {
  return ensureSkillLinks({ sourceDir: getSkillSourceDir() });
}

function uninstallSkill(): boolean {
  return uninstallSkillLinks();
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

```markdown
---
name: rename
description: This skill should be used when the user asks to "rename this terminal", "set terminal title", "give this tab a name", or invokes "/rename". Generates a concise title from recent conversation context and sets it on the TermCanvas terminal tab via the termcanvas CLI.
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
```

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
