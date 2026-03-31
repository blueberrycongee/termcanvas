# Browse Tool & QA Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bundle a browser automation tool (`browse`) into the termcanvas project and build a QA skill on top of it, giving Hydra sub-agents the ability to visually test web applications out of the box.

**Architecture:** The `browse` tool lives in `browse/` as an independent sub-package (same pattern as `hydra/`). It compiles into a standalone binary via esbuild. The QA skill at `skills/skills/qa/SKILL.md` references the browse binary and defines a phased testing workflow. Users who install termcanvas get both automatically — no extra downloads.

**Tech Stack:** TypeScript, Playwright (Chromium), esbuild, Node.js.

---

## Background

### Why we're doing this

We evaluated [gstack](https://github.com/garrytan/gstack) (MIT license, by Garry Tan) — a Claude Code skill toolkit with 30+ skills. Three pure-workflow skills (investigate, security-audit, code-review) were already integrated in an earlier round. The QA skill was deferred because it depends on a browser automation binary.

### Decision record

- **Approach**: Maintain our own browse tool, borrowing from gstack's architecture (MIT). Credit in README.
- **Why not depend on gstack directly**: External dependency — if they change APIs, rename paths, or go offline, we break. Own the code, control the destiny.
- **Why not reuse Electron's Chromium**: Fatal flaw — headless/server Hydra workflows have no Electron process. Browse must work independently.
- **Why independent binary over Electron integration**: Crash isolation (browse crash doesn't take down termcanvas), works in all environments (desktop, headless, CI, cloud Hydra daemon).
- **Chromium download cost (~200-400MB)**: Accepted. Not a real concern for developer machines in 2026.

### What gstack browse is

- 21 TypeScript files, ~8500 LOC
- Persistent headless Chromium daemon with HTTP command interface
- ~55 commands: navigation, DOM inspection, interaction, screenshots, accessibility tree, cookie management
- Ref system (@e1, @e2) built from accessibility tree — no DOM injection, CSP-safe
- Server auto-starts on first command, auto-stops after 30min idle
- Uses Playwright + Chrome DevTools Protocol

### What we need (Phase 1 — MVP)

Not all 55 commands. The QA skill needs a core subset:

**Navigation:** goto, back, reload, wait
**Inspection:** snapshot (accessibility tree + refs), text, links, console, screenshot
**Interaction:** click, fill, select, scroll, press, hover
**State:** cookies, url, tabs, tab

That's ~20 commands — roughly 40% of gstack's surface. Cookie import, PDF export, CDP CSS inspection, Chrome extension sidebar, responsive multi-screenshot can come later.

---

## Context for the Implementer

### Project structure conventions

The project has sub-packages with independent build chains:

```
termcanvas/
├── hydra/           # sub-agent orchestrator
│   ├── src/
│   ├── build.ts     # esbuild → dist/hydra.js
│   └── package.json
├── browse/          # ← NEW: browser automation tool
│   ├── src/
│   ├── build.ts     # esbuild → dist/browse.js
│   └── package.json
├── skills/
│   └── skills/
│       └── qa/      # ← NEW: QA skill referencing browse
└── package.json     # root — "bin": { "browse": "./dist-cli/browse.js" }
```

Follow the hydra sub-package pattern exactly:
- `package.json` with `type: "module"`, esbuild devDependency
- `build.ts` using esbuild with `platform: "node"`, `format: "esm"`, `banner: { js: "#!/usr/bin/env node" }`
- `tsconfig.json` extending root or standalone
- Tests in `tests/` using `node --test`

### How browse will be invoked

The browse binary is a CLI tool. Claude agents invoke it via Bash:

```bash
browse goto https://example.com
browse snapshot -i          # interactive elements with refs
browse click @e3            # click element ref 3
browse fill @e5 "hello"     # fill input ref 5
browse screenshot page.png  # capture viewport
browse console              # show console logs
browse stop                 # shut down daemon
```

The QA skill's SKILL.md documents these commands and the workflow phases.

### Integration with Hydra

When Hydra dispatches a QA task to a sub-agent:
1. Handoff contract includes `task.skills: ["qa"]`
2. `task-package.ts` renders the skill name into `task.md`
3. Sub-agent reads `task.md`, sees "qa" skill, follows the QA workflow
4. Sub-agent calls `browse` commands via Bash to test the target site
5. Results go into `result.json` with screenshots as evidence

### What NOT to do

- Do not integrate browse into Electron's main process
- Do not use Bun — we use Node.js + esbuild
- Do not implement all 55 gstack commands — MVP is ~20 core commands
- Do not modify Hydra source code
- Do not add browse as a dependency to the root package.json — it's an independent sub-package
- Do not write cookie decryption or Chrome extension integration in Phase 1

---

### Task 1: Scaffold the browse sub-package

**Files:**
- Create: `browse/package.json`
- Create: `browse/tsconfig.json`
- Create: `browse/build.ts`

**Step 1: Create package.json**

```json
{
  "name": "@termcanvas/browse",
  "version": "0.1.0",
  "description": "Headless browser automation CLI for QA testing",
  "type": "module",
  "bin": {
    "browse": "./dist/browse.js"
  },
  "scripts": {
    "build": "node --experimental-strip-types build.ts",
    "test": "node --experimental-strip-types --test tests/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "playwright": "^1.52.0"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "typescript": "^5.9.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["dist", "tests", "node_modules"]
}
```

**Step 3: Create build.ts**

```typescript
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/browse.js",
  banner: { js: "#!/usr/bin/env node" },
  external: ["playwright"],
});
```

**Step 4: Verify scaffold**

Run: `cd browse && cat package.json | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('valid')"`
Expected: `valid`

**Step 5: Commit**

```bash
git add browse/package.json browse/tsconfig.json browse/build.ts
git commit -m "feat(browse): scaffold sub-package with esbuild build chain"
```

---

### Task 2: Implement the server daemon

The browse tool runs as a persistent HTTP server. First command auto-starts it, subsequent commands send HTTP requests.

**Files:**
- Create: `browse/src/server.ts`
- Create: `browse/src/config.ts`

**Step 1: Create config.ts**

Defines paths and constants:

```typescript
import path from "node:path";
import os from "node:os";

export const BROWSE_DIR = path.join(os.homedir(), ".termcanvas", "browse");
export const STATE_FILE = path.join(BROWSE_DIR, "browse.json");
export const DEFAULT_PORT = 0; // auto-assign
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface ServerState {
  port: number;
  token: string;
  pid: number;
}
```

**Step 2: Create server.ts**

HTTP server that:
- Listens on localhost with random port
- Generates a bearer token for auth
- Writes `{ port, token, pid }` to `STATE_FILE`
- Accepts POST `/command` with `{ command, args }` body
- Routes to command handlers (implemented in later tasks)
- Shuts down after `IDLE_TIMEOUT_MS` of no requests
- Handles SIGTERM/SIGINT for clean shutdown

Key interface:

```typescript
export interface CommandRequest {
  command: string;
  args: string[];
}

export interface CommandResult {
  ok: boolean;
  output: string;
  error?: string;
}

export type CommandHandler = (
  page: Page,
  args: string[],
  context: BrowseContext,
) => Promise<CommandResult>;
```

The server holds a Playwright `Browser` instance and manages the active `Page`. It creates the browser lazily on first command.

**Step 3: Write test**

Create `browse/tests/server.test.ts` — test that the server starts, returns health on GET `/health`, and shuts down cleanly.

**Step 4: Run test**

Run: `cd browse && npm install && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add browse/src/server.ts browse/src/config.ts browse/tests/server.test.ts
git commit -m "feat(browse): implement HTTP server daemon with auto-shutdown"
```

---

### Task 3: Implement the CLI client

The CLI parses commands, ensures the server is running, and sends HTTP requests.

**Files:**
- Create: `browse/src/cli.ts`

**Step 1: Create cli.ts**

CLI that:
- Parses `browse <command> [args...]` from `process.argv`
- Reads `STATE_FILE` to find the running server
- If no server running (or health check fails), spawns a new server as a detached child process
- Sends POST `/command` to the server with `{ command, args }`
- Prints the response to stdout
- Special commands: `stop` (sends shutdown), `status` (prints server info)

**Step 2: Write test**

Create `browse/tests/cli.test.ts` — test that CLI can start server, send a command, and stop server.

**Step 3: Build and verify**

Run: `cd browse && npm run build && node dist/browse.js status`
Expected: prints server status or "not running"

**Step 4: Commit**

```bash
git add browse/src/cli.ts browse/tests/cli.test.ts
git commit -m "feat(browse): implement CLI client with auto-start daemon"
```

---

### Task 4: Implement navigation commands

**Files:**
- Create: `browse/src/commands/navigation.ts`

**Commands:**
- `goto <url>` — navigate to URL, wait for load
- `back` — go back in history
- `reload` — reload current page
- `wait <selector|--idle|--load>` — wait for element, network idle, or load event
- `url` — print current URL

**Step 1: Implement navigation.ts**

Each command is a `CommandHandler` function. Register them in a command map exported by the module.

`goto` should:
- Validate URL (reject non-http(s) unless it's localhost or file://)
- Navigate with `page.goto(url, { waitUntil: "domcontentloaded" })`
- Return the page title and URL

`wait` should:
- `wait <selector>` → `page.waitForSelector(selector)`
- `wait --idle` → `page.waitForLoadState("networkidle")`
- `wait --load` → `page.waitForLoadState("load")`

**Step 2: Write tests**

Create `browse/tests/navigation.test.ts` — test goto with a local HTML file, back, url.

**Step 3: Run tests**

Run: `cd browse && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add browse/src/commands/navigation.ts browse/tests/navigation.test.ts
git commit -m "feat(browse): add navigation commands (goto, back, reload, wait, url)"
```

---

### Task 5: Implement snapshot and inspection commands

**Files:**
- Create: `browse/src/commands/inspect.ts`
- Create: `browse/src/snapshot.ts`

**Commands:**
- `snapshot` — accessibility tree dump
- `snapshot -i` — interactive elements only, with refs (@e1, @e2)
- `text` — extract visible text
- `links` — extract all links with text and href
- `console` — buffered console log messages

**Step 1: Implement snapshot.ts**

The ref system is the core of browse's usability. It:
- Gets the accessibility tree via `page.accessibility.snapshot()`
- Assigns sequential refs (@e1, @e2, ...) to interactive elements
- Maps each ref to a Playwright Locator using `page.getByRole()` with name matching
- Stores the ref→locator map for use by interaction commands
- Returns formatted text: `@e1 [button] "Submit"`, `@e2 [textbox] "Email"`

Flags:
- `-i` — only show interactive elements (buttons, links, inputs, selects)
- Default — full tree

**Step 2: Implement inspect.ts**

Register snapshot, text, links, console commands.

`text` — `page.innerText("body")` with script/style elements stripped
`links` — `page.$$eval("a[href]", ...)` extracting text + href
`console` — buffer `page.on("console", ...)` events, return last 50

**Step 3: Write tests**

Create `browse/tests/inspect.test.ts` — test snapshot output format, ref assignment, text extraction.

**Step 4: Run tests**

Run: `cd browse && npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add browse/src/snapshot.ts browse/src/commands/inspect.ts browse/tests/inspect.test.ts
git commit -m "feat(browse): add snapshot with ref system and inspection commands"
```

---

### Task 6: Implement interaction commands

**Files:**
- Create: `browse/src/commands/interact.ts`

**Commands:**
- `click <selector|@ref>` — click element
- `fill <selector|@ref> <value>` — clear + fill input
- `select <selector|@ref> <value>` — choose dropdown option
- `scroll [<selector|bottom>]` — scroll to element or bottom
- `press <key>` — press keyboard key (Enter, Tab, Escape, etc.)
- `hover <selector|@ref>` — hover over element

**Step 1: Implement interact.ts**

Each command resolves the target:
- If starts with `@e` → look up ref in the snapshot ref map
- Otherwise → treat as CSS selector, use `page.locator(selector)`

`fill` should `locator.fill(value)` (clears first).
`click` should `locator.click()`.
`select` should `locator.selectOption(value)`.

**Step 2: Write tests**

Create `browse/tests/interact.test.ts` — test click, fill with both selector and ref, test ref resolution.

**Step 3: Run tests**

Run: `cd browse && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add browse/src/commands/interact.ts browse/tests/interact.test.ts
git commit -m "feat(browse): add interaction commands (click, fill, select, scroll, press, hover)"
```

---

### Task 7: Implement screenshot and meta commands

**Files:**
- Create: `browse/src/commands/meta.ts`

**Commands:**
- `screenshot [path]` — capture viewport to file, default `screenshot.png`
- `tabs` — list open tabs with index and title
- `tab <index>` — switch to tab by index
- `cookies` — dump all cookies as JSON
- `stop` — shut down server
- `status` — print server health info

**Step 1: Implement meta.ts**

`screenshot` — `page.screenshot({ path, fullPage: false })`, return the file path.
`tabs` — iterate browser contexts/pages, list index + url + title.
`tab` — switch active page by index.

**Step 2: Write tests**

Create `browse/tests/meta.test.ts` — test screenshot creates file, tabs lists pages.

**Step 3: Run tests**

Run: `cd browse && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add browse/src/commands/meta.ts browse/tests/meta.test.ts
git commit -m "feat(browse): add screenshot, tabs, cookies, and meta commands"
```

---

### Task 8: Wire up command registry and end-to-end test

**Files:**
- Create: `browse/src/commands/index.ts`
- Modify: `browse/src/server.ts`

**Step 1: Create command registry**

`commands/index.ts` exports a `Map<string, CommandHandler>` that merges all command modules (navigation, inspect, interact, meta).

**Step 2: Wire registry into server**

Server's POST `/command` handler looks up the command in the registry and calls the handler.

**Step 3: End-to-end test**

Create `browse/tests/e2e.test.ts`:
1. Start server programmatically
2. Send `goto` with a local HTML test fixture
3. Send `snapshot -i` — verify refs are assigned
4. Send `click @e1` — verify click works
5. Send `screenshot` — verify file exists
6. Send `stop` — verify server shuts down

**Step 4: Build and run**

Run: `cd browse && npm run build && npm test`
Expected: all tests PASS, `dist/browse.js` exists

**Step 5: Commit**

```bash
git add browse/src/commands/index.ts browse/tests/e2e.test.ts
git commit -m "feat(browse): wire command registry and add e2e tests"
```

---

### Task 9: Install Playwright Chromium in postinstall

**Files:**
- Modify: `browse/package.json`

**Step 1: Add postinstall script**

```json
"scripts": {
  "postinstall": "npx playwright install chromium",
  ...
}
```

This ensures Chromium is downloaded when `npm install` is run in the browse directory. For the root project, add a build step that includes `cd browse && npm install && npm run build`.

**Step 2: Verify**

Run: `cd browse && npm install`
Expected: Chromium downloads automatically

**Step 3: Commit**

```bash
git add browse/package.json
git commit -m "feat(browse): auto-install Chromium via postinstall"
```

---

### Task 10: Register browse binary in root package.json

**Files:**
- Modify: `package.json` (root)

**Step 1: Add browse to bin**

Add to root `package.json` `"bin"` section:

```json
"browse": "./browse/dist/browse.js"
```

**Step 2: Add browse build to root scripts**

If a root build script exists, ensure it includes building browse. Or document that `cd browse && npm run build` is needed.

**Step 3: Verify binary works**

Run: `node browse/dist/browse.js status`
Expected: prints status or "not running"

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat(browse): register browse binary in root package.json"
```

---

### Task 11: Create the QA skill

**Files:**
- Create: `skills/skills/qa/SKILL.md`

**Step 1: Write the skill file**

```markdown
---
name: qa
description: >-
  QA testing skill with real browser automation. Use when asked to "test this
  site", "QA this page", "check for visual bugs", "verify the deploy", or
  when a Hydra evaluator needs to validate UI changes. Requires the browse
  binary.
---

# QA

Browser-based QA testing with the `browse` CLI. Test real user flows, capture
visual evidence, and fix issues with atomic commits.

## Phase 0: Setup

1. Verify browse is available: `browse status`
2. If not found, report error — browse binary must be installed
3. Get the target URL from the task description or ask the user

## Phase 1: Orient

1. Navigate to the target: `browse goto <url>`
2. Take a baseline snapshot: `browse snapshot -i`
3. Check console for errors: `browse console`
4. Extract navigation links: `browse links`
5. Build a site map of pages to test (limit to 10 most important pages)

## Phase 2: Page-by-Page Audit

For each page in the site map:

1. Navigate: `browse goto <page-url>`
2. Snapshot interactive elements: `browse snapshot -i`
3. Check console for errors: `browse console`
4. Screenshot for evidence: `browse screenshot <page-name>.png`
5. Note issues found: broken links, console errors, missing elements,
   layout problems visible in snapshot

## Phase 3: User Flow Testing

Test the primary user flows (signup, login, checkout, etc.):

1. Identify the flow steps from the snapshot
2. Execute each step using refs:
   - `browse click @e3` — click buttons/links
   - `browse fill @e5 "test@example.com"` — fill inputs
   - `browse select @e7 "option-value"` — select dropdowns
   - `browse press Enter` — submit forms
3. After each step, snapshot and verify the expected outcome
4. Screenshot at each step for evidence

## Phase 4: Health Score

Rate the site on a 0-10 scale across these dimensions:

- **Console health**: errors / warnings count
- **Link health**: broken links / total links
- **Interactivity**: do buttons and forms work?
- **Visual completeness**: are there missing images, broken layouts?

Report format:
```
Health Score: 7/10
- Console: 9/10 (2 warnings, 0 errors)
- Links: 8/10 (1 broken link out of 45)
- Interactivity: 6/10 (signup form submit fails silently)
- Visual: 5/10 (hero image 404, footer misaligned on mobile)
```

## Phase 5: Fix Loop

For each issue found (in severity order):

1. Locate the root cause in the source code
2. Write the minimal fix
3. Run the test suite
4. Commit atomically: one fix per commit
5. Re-test in the browser to confirm the fix: `browse goto <url>` + `browse screenshot`
6. Move to the next issue

Stop conditions:
- All Critical/High issues fixed
- 20-fix cap reached (report remaining as known issues)
- Test suite regression detected — stop and report

## Phase 6: Report

Summarize all findings:

1. Pages tested (count and list)
2. Issues found (by severity)
3. Issues fixed (with commit hashes)
4. Issues remaining (if any)
5. Health score before and after
6. Screenshot evidence (file paths)

## Rules

- Always take screenshots as evidence — never claim "it looks fine" without proof
- One fix per commit, atomic and revertable
- Do not fix style preferences — only fix real bugs and broken functionality
- If you cannot reproduce an issue in the browser, note it as "not reproduced"
- Stop after 20 fixes to avoid scope creep
```

**Step 2: Verify file structure**

Run: `ls skills/skills/qa/SKILL.md`
Expected: file exists

**Step 3: Commit**

```bash
git add skills/skills/qa/SKILL.md
git commit -m "feat(skills): add QA skill with browser-based testing workflow"
```

---

### Task 12: Update router and plugin for QA skill

**Files:**
- Modify: `skills/skills/using-termcanvas/SKILL.md`
- Modify: `skills/.claude-plugin/plugin.json`

**Step 1: Add QA routing entry**

In the routing section of `using-termcanvas/SKILL.md`, add after the code-review entry:

```markdown
- If the user asks to test a site, QA a page, or verify a deploy, use `qa`.
```

**Step 2: Update plugin description**

Update the description in `plugin.json` to include QA:

```json
"description": "TermCanvas skills: Hydra sub-agent orchestration, systematic debugging, security auditing, code review, browser-based QA testing, and terminal management."
```

**Step 3: Commit**

```bash
git add skills/skills/using-termcanvas/SKILL.md skills/.claude-plugin/plugin.json
git commit -m "feat(skills): add QA skill to router and plugin description"
```

---

### Task 13: Add attribution and verify end-to-end

**Files:**
- Modify: `browse/package.json` (add credits field or README reference)

**Step 1: Add attribution**

Add to `browse/package.json`:

```json
"credits": "Browser automation architecture inspired by gstack (https://github.com/garrytan/gstack, MIT license)"
```

**Step 2: Final verification**

Run:
```bash
cd browse && npm install && npm run build && npm test
```
Expected: build succeeds, all tests pass, `dist/browse.js` exists

Run:
```bash
node browse/dist/browse.js goto https://example.com && node browse/dist/browse.js snapshot && node browse/dist/browse.js stop
```
Expected: navigates, prints accessibility tree, shuts down

**Step 3: Run root typecheck**

Run: `npx tsc --noEmit`
Expected: clean

**Step 4: Commit**

```bash
git add browse/package.json
git commit -m "chore(browse): add gstack attribution"
```
