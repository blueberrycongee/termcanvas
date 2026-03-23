# Terminal Rename via AI Skill

## Overview

Allow Claude Code / Codex users to rename their TermCanvas terminal tab by invoking a `/rename` skill. The AI reads recent conversation context, generates a concise title, and sets it via the `termcanvas` CLI.

## Motivation

- Current custom title can only be set via UI (double-click or Cmd+R)
- Users working with many terminals need quick, context-aware naming
- AI agents already have `$TERMCANVAS_TERMINAL_ID` in their environment — the plumbing is there, just no endpoint to call

## Design

### Layer 1: TermCanvas Plugin Infrastructure

Migrate from per-skill symlinks to a proper Claude Code plugin structure.

**Source layout:**

```
skills/
├── .claude-plugin/
│   └── plugin.json            # { "name": "termcanvas", "version": "..." }
└── skills/
    ├── hydra/
    │   └── SKILL.md            # moved from hydra/skill/SKILL.md
    └── rename/
        └── SKILL.md            # new
```

**Build & distribution:**

- `electron-builder.yml`: change extraResources from `hydra/skill` to `skills/` directory
- Bundled into app resources at `skills/`

**Installation:**

- `hydra-skill.ts` → `skill-manager.ts`: refactored to install the entire plugin directory
- Claude Code: register as plugin (symlink to `~/.claude/plugins/termcanvas/` or equivalent)
- Codex: if plugin mechanism not supported, fall back to individual skill symlinks under `~/.codex/skills/`

**Migration:**

- Remove old `hydra` symlink at `~/.claude/skills/hydra` and `~/.codex/skills/hydra`
- Old `hydra/skill/` directory becomes empty (or removed), source of truth moves to `skills/skills/hydra/`

### Layer 2: CLI `set-title` Command

**CLI** (`cli/termcanvas.ts`):

```
termcanvas terminal set-title <terminal-id> <title>
```

Calls `PUT /terminal/{id}/custom-title` with body `{ "customTitle": "..." }`.

**API Server** (`electron/api-server.ts`):

New route: `PUT /terminal/{id}/custom-title`
- Reads `customTitle` from request body
- Calls `execRenderer('window.__tcApi.setCustomTitle(terminalId, customTitle)')`

**Renderer bridge** (`src/App.tsx` `__tcApi`):

New method `setCustomTitle(terminalId, customTitle)`:
- Finds terminal's projectId and worktreeId
- Calls existing `updateTerminalCustomTitle(projectId, worktreeId, terminalId, customTitle)`

### Layer 3: Rename Skill

**`skills/skills/rename/SKILL.md`:**

```yaml
---
name: rename
description: This skill should be used when the user asks to "rename this terminal",
  "set terminal title", "give this tab a name", or invokes "/rename". Generates a
  concise title from recent conversation context and sets it on the TermCanvas terminal tab.
---
```

**Behavior:**

1. Read recent conversation context (last few exchanges)
2. Generate a concise title (3-8 words, matching conversation language)
3. Read `$TERMCANVAS_TERMINAL_ID` from environment
4. Execute: `termcanvas terminal set-title $TERMCANVAS_TERMINAL_ID "<title>"`

**Constraints:**

- If `$TERMCANVAS_TERMINAL_ID` is not set, inform the user this only works inside TermCanvas
- Title should be descriptive of the work being done, not generic
- Respect existing custom title — this overwrites it

## Files Changed

| File | Change |
|------|--------|
| `skills/` (new dir) | Plugin structure with `.claude-plugin/plugin.json` |
| `skills/skills/hydra/SKILL.md` | Moved from `hydra/skill/SKILL.md` |
| `skills/skills/rename/SKILL.md` | New skill |
| `electron/hydra-skill.ts` → `electron/skill-manager.ts` | Refactored for plugin installation |
| `electron/main.ts` | Update imports from hydra-skill to skill-manager |
| `electron-builder.yml` | Update extraResources path |
| `cli/termcanvas.ts` | Add `terminal set-title` subcommand |
| `electron/api-server.ts` | Add `PUT /terminal/{id}/custom-title` route |
| `src/App.tsx` | Add `setCustomTitle` to `__tcApi` |
