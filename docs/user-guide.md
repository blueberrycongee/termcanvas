# TermCanvas User Guide

**A hands-on walkthrough of the app, the interactions that aren't obvious, and every keyboard shortcut worth memorising.**

This guide assumes TermCanvas is already installed. For download links and `termcanvas` / `hydra` CLI registration, see the [README](../README.md) Quick Start.

- 中文版 → [`user-guide.zh.md`](./user-guide.zh.md)

---

## Table of contents

1. [What TermCanvas is](#what-termcanvas-is)
2. [Your first five minutes](#your-first-five-minutes)
3. [The three-column layout](#the-three-column-layout)
4. [Moving around the canvas](#moving-around-the-canvas)
5. [Working with terminals](#working-with-terminals)
6. [Reading & editing code](#reading--editing-code)
7. [Browsing session history](#browsing-session-history)
8. [Watching your spend (Usage)](#watching-your-spend-usage)
9. [Finding things — search, palette, hub](#finding-things--search-palette-hub)
10. [Composer & quick actions](#composer--quick-actions)
11. [Stashing & unstashing terminals](#stashing--unstashing-terminals)
12. [Multi-canvas, waypoints, and snapshot history](#multi-canvas-waypoints-and-snapshot-history)
13. [Pins — capturing deferred work](#pins--capturing-deferred-work)
14. [Logging in for cross-device sync](#logging-in-for-cross-device-sync)
15. [Settings — what each toggle does](#settings--what-each-toggle-does)
16. [Power features](#power-features)
17. [Keyboard shortcuts cheatsheet](#keyboard-shortcuts-cheatsheet)
18. [Troubleshooting](#troubleshooting)

On macOS this guide uses `⌘`. On Linux / Windows, substitute `Ctrl` — TermCanvas binds every shortcut against the platform modifier.

---

## What TermCanvas is

TermCanvas is an **infinite canvas for AI agents**. Each tile on the canvas is a real PTY — typically `claude`, `codex`, `gemini`, `lazygit`, or a plain shell — and you arrange them the way you'd arrange sticky notes on a whiteboard. You can run a dozen Claude sessions in parallel across a dozen worktrees, glance across all of them at once by zooming out, zoom into the one you're actively driving, and replay any past session as easily as you'd scroll back through a chat thread.

The surrounding UI is there so you don't have to leave the canvas for the usual side quests:

- **Left panel** — project management + session history
- **Right panel** — Files / Diff / Git / Memory for the focused worktree
- **Monaco editor drawer** — full-width code editor, slides over the canvas when you click a file
- **Usage dashboard** — real cost + quota tracking across Claude and Codex
- **Sessions replay drawer** — watch any past conversation unfold step-by-step, and resume it with one click

---

## Your first five minutes

1. **Add your first project.** The left panel starts collapsed as a thin strip. Click the **`+`** at its top (or press `⌘O`) and pick a git repository in the folder picker. The panel expands and shows the project with its `main` worktree.

2. **Spawn your first agent.** Hover the worktree row — a small `+` appears on the right. Click it to open the "New terminal" picker, or right-click on empty canvas and choose `Claude` / `Codex` / `Shell`. The new tile appears at the spot you clicked (or next to the focused terminal). The underlying PTY launches the right CLI automatically.

3. **Resume a past session (optional).** If you've used `claude` or `codex` in this directory before, the left panel's **History** section already lists those conversations. Click any row — a replay drawer slides out. Inside the replay, the top-right **Continue** button spawns a fresh terminal that picks up exactly where the conversation left off.

4. **Zoom out to see everything.** Press **`⌘E`**. The canvas fits all terminals on screen. Press `⌘E` again to zoom back to your last focused one.

5. **Open this guide or adjust something.** `⌘,` opens Settings. `⌘K` opens global search across files, terminals, sessions, git history, and actions.

---

## The three-column layout

TermCanvas always has the same shape:

```
┌───────────┬────────────────────────────┬───────────┐
│  LEFT     │                            │  RIGHT    │
│  PANEL    │      CANVAS                │  PANEL    │
│           │                            │           │
│  projects │      terminal tiles        │  Files    │
│  +        │      pan / zoom / focus    │  Diff     │
│  history  │                            │  Git      │
│           │                            │  Memory   │
└───────────┴────────────────────────────┴───────────┘
```

Both panels collapse independently:

- **Left panel** — click the chevron at its inner edge to collapse / expand. Collapsed, only the **`+`** button stays visible, so adding a project is still one click away.
- **Right panel** — `⌘/` collapses / expands. Collapsed, it shows the four tab icons; clicking any icon expands the panel to that tab.

**Drag either panel's inside edge to resize it.** The canvas redraws into whatever space remains, and the focused terminal re-centres automatically.

---

## Moving around the canvas

### Pan & zoom

- **Two-finger scroll** (trackpad) or mouse wheel: **pans** in all four directions. No modifier needed.
- **`⌘`-scroll** (or `Ctrl`-scroll on non-Mac): **zooms** toward the cursor.
- **Pinch**: disabled on purpose — it conflicted with macOS back-gestures in testing. Use `⌘`-scroll instead.

### Focus mode (⌘E chain)

Press `⌘E` with different state and you get different behaviour — this is the most important trick in the app:

| State when you press `⌘E`           | What happens                                                 |
| ----------------------------------- | ------------------------------------------------------------ |
| Nothing focused                     | Focuses the first terminal and zooms in close on it.          |
| One terminal focused                | Zooms out to fit all terminals; remembers the focused one.  |
| Zoomed out with a focus remembered  | Zooms back to that focused terminal.                         |

While zoomed out (aka **overview mode**):

- **Single click** on a terminal → focus it, stay zoomed out. You can type into it immediately.
- **Double click** on a terminal → zoom in on it. This is the shortcut the welcome demo teaches.
- **Click empty canvas** → clear focus + selection.

In normal (zoomed-in) mode:

- **Double-click a terminal's header** → pan the canvas to centre that tile.
- **Drag a terminal** → move it. Tiles snap to a `10 × 10` grid and push their neighbours aside instead of overlapping.

### Cycling through terminals

`⌘]` / `⌘[` walks through terminals in **spatial order** (left-to-right, top-to-bottom). If any terminal is starred, it cycles just through starred ones — handy when you want to hop between the three agents you care about while ignoring a dozen others.

`⌘G` cycles the focus *level* — terminal → worktree → starred. In worktree mode, `⌘]` jumps between worktrees instead of terminals.

### Box-selecting multiple terminals

Hold `Shift` and drag across empty canvas to draw a selection rectangle. Everything the rectangle touches becomes selected. `Backspace` / `Delete` then closes all selected tiles.

---

## Working with terminals

### Creating a new terminal

Four ways, any of which you'll keep reaching for:

- **`⌘T`** — new shell terminal in the currently focused worktree.
- **`+` on a worktree row** (left panel) — same, but lets you pick Claude / Codex / Shell from a dropdown.
- **Right-click empty canvas** — opens a menu of every provider you have configured; the tile appears at the click position.
- **Drag a file into a terminal** — pastes the quoted file path as input. Useful for handing a file to a running Claude session.

### The terminal tile

Each tile has:

- **Status dot** — red (attention), amber (running), green (thinking), grey (idle), blue (done / unseen).
- **Title bar** — provider + title. Double-click to rename inline; press Enter to save, Esc to cancel.
- **Star (☆)** — `⌘F` or click. Starred terminals form a curated cycle; see `⌘G`.
- **Minimize (–)** — collapses the tile to just its header. The underlying PTY keeps running.
- **Close (✕)** — closes the tile. Focus automatically lands on the spatially-left neighbour in the same worktree.

### Right-click menu

On a terminal's **header**, right-click gives you:

- **Stash** — move the tile into the stash box (see [below](#stashing--unstashing-terminals)).
- **Tags…** — label the terminal.
- **Summarize** (Claude / Codex only) — runs a summary pass via the live agent.

On a **worktree row** in the left panel, right-click activates that worktree (focuses its most recent terminal) without toggling the expand/collapse state.

On **empty canvas**, right-click shows "New …" for every configured agent, positioned at the click point.

---

## Reading & editing code

The right panel holds four tabs. Collapsed, the tab bar is a thin column of icons; click any icon to expand to that tab.

- **Files** — a tree of the focused worktree. Click a file → a **full-canvas Monaco editor drawer** slides in from the right. It covers the canvas and the right panel but leaves the left panel visible, so you can still navigate sessions while reading.
- **Diff** — unified diff of the focused worktree's uncommitted changes. Click any hunk to open it in Monaco at the right line. Hunks show in green / red / amber for added / removed / modified.
- **Git** — branch switcher, stash list, commit graph, and an actions row (`stage all`, `commit`, `amend`, `push`, etc.).
- **Memory** — files like `CLAUDE.md` / `AGENTS.md` that are auto-injected into agent context. Editing these here edits the real file; Claude / Codex will pick up the change on the next turn.

### Monaco editor drawer

- **Click any file** (Files tab, global search result, diff hunk) — drawer slides in at default width.
- **Maximise** (header button, or the right panel's `⌘/` toggle) — drawer fills the area between the two side panels. The left panel stays visible so file switching never needs a close.
- **`⌘S`** — saves the file.
- **Unsaved indicator** — a coloured dot next to the filename. Closing the drawer with unsaved changes asks first.
- **`Esc`** — closes the drawer; if there are unsaved changes, asks first.

---

## Browsing session history

The left panel's **History** section lists every past Claude + Codex session in the current canvas's scope (any project you've added). Each row has a short preview of the first prompt, the provider, and how long ago it last changed.

- **Click a row** → a **session replay drawer** slides in from the left-panel edge. The drawer mirrors the editor drawer, but with chat transcripts instead of code.
- **Spacebar** or the play button → plays the replay at real speed. The drawer's speed selector lets you fast-forward.
- **`←` / `→`** — step one event at a time.
- **Click any prompt / reply / tool pill** in the replay → jumps to that event.
- **Tool pill** (the small collapsed boxes for tool calls) → click to expand inputs + outputs.
- **Continue button** (top-right of the replay) → spawns a new terminal that resumes the conversation via `claude --resume <id>` or `codex resume <id>`. The replay drawer closes immediately so the newly-spawned terminal is visible on canvas.

Two things to know:

- If the CLI's own session store has evicted the conversation (Claude's session cache has a TTL), the resume terminal will print `[Session expired, starting fresh...]` and start a fresh session automatically. You didn't do anything wrong; the original session is just too old.
- Claude and Codex store sessions in different formats under `~/.claude/projects/…` and `~/.codex/sessions/…` respectively. TermCanvas reads both and merges them into one unified timeline.

---

## Watching your spend (Usage)

`⌘⇧U` opens the Usage dashboard. It's **not** a modal — it renders in the canvas gap between the two side panels, so both panels stay visible underneath it. Press `⌘⇧U` again or hit `Esc` to dismiss.

The dashboard has five rows, all real data (read from `~/.claude/projects/*/usage-*.json` and Codex's telemetry feed):

1. **Stat strip** — Today / MTD / Daily average / Projected end-of-month. The projection uses your current daily average for the remaining days of the month.
2. **Two charts** — 24-hour sparkline (today) + 30-day daily trend.
3. **Three bar lists** — Cache rate (Overall / Claude / Codex), Projects (your most-used), Models (opus / sonnet / haiku / codex with the canonical colours).
4. **Quotas** — Claude 5-hour + 7-day + Codex 5-hour meters. Green below 50%, amber between 50-80%, red above 80%. The countdown to the next reset is on the right.
5. **Heatmap** — year-at-a-glance calendar grid. Each square is one day; colour intensity follows token count that day.

If you've dragged both side panels very wide and there isn't enough room left for Usage to render, the dashboard yields the space silently. Narrow a panel and it comes back.

---

## Finding things — search, palette, hub

Three surfaces. They overlap on purpose so the right one is always one chord away.

### Global search — `⌘K`

Opens the search modal. It indexes seven categories:

- **Actions** — app commands (toggle panel, open settings, add project, etc.).
- **Terminals** — every live tile by title / provider.
- **Files** — full-text search across the focused worktree (powered by ripgrep). Kicks in after 3 characters.
- **Git branches** — switcher to any local branch.
- **Git commits** — commit message + hash fuzzy search.
- **Sessions** — the same history from the left panel, but searchable by prompt content.
- **Memory** — `CLAUDE.md` / `AGENTS.md` symbols + contents.

Keyboard-only interaction:

- `↑` / `↓` — move through results.
- `Enter` — execute / open. For files, the Monaco drawer opens to that line. For sessions, the replay drawer opens and seeks to the matched event.
- `Esc` — close. Focus returns to wherever it was before search opened.
- **Scope toggle** — at the top of the modal, a segmented control between "All canvas" and "Current project" narrows the search to the focused worktree.

### Command Palette — `⌘P`

Different shape from search: instead of "find a thing", it's "run a thing". The palette lists every action TermCanvas can take — toggling panels, switching theme, dispatching a Hydra workflow, opening this guide, registering CLIs, etc. Type to filter, `Enter` to run, `Esc` to close. If you don't remember the shortcut for an action, the palette is the fastest way to find and trigger it.

### Hub — `⌘⇧J`

A drawer that slides in from the right edge and stays anchored. It's the canvas's command center — four lanes, all live:

- **Active terminals** — the ones currently running an agent, with output sparklines.
- **Recent activity** — chronological feed of the last things that happened (status changes, tool calls, completions). Same data the heatmap visualises spatially.
- **Waypoints** — the 9 named viewport slots for the active project; click to recall.
- **Pinned items** — anything you've pinned (sessions, terminals, files).

Use Hub when you want a vertical-list view of activity instead of pan-zooming the canvas. Useful while a long-running agent works and you want to glance over without losing your spot.

### Status Digest — `⌘⇧/`

A quiet floating chip — not a drawer, not a modal. Lists the 3–5 most relevant signals across the canvas right now: just-completed runs, stuck agents, busy ones, the focus, pinned terminals. Tap and dismiss. Designed to answer "what should I look at?" in one glance.

---

## Composer & quick actions

**`⌘;`** opens the composer — a floating input box that can dispatch a prompt to the focused agent terminal. It's useful when you want to type a long prompt without fighting with the terminal's own input focus, or when you want to send the same prompt to multiple agents (select them, then type once).

Composer features:

- **Multi-line input** — `Enter` sends, `Shift+Enter` adds a newline.
- **Slash commands** — `/clear`, `/compact`, `/tokens`, etc. are routed to the right agent's CLI equivalent.
- **File drops** — drag files in from the file system or from the Files tab; their paths are inserted as escaped strings.
- **Targeting** — if you've selected multiple terminals, the prompt is sent to all of them simultaneously.

If the composer is off (Settings → General → Composer), `⌘;` falls back to inline rename on the focused terminal's title.

---

## Stashing & unstashing terminals

Sometimes you want a terminal out of the way without killing it. Enter stash:

- **Right-click a terminal header → Stash** — moves it to the stash box. The tile disappears from canvas but the PTY keeps running.
- **Drag a tile onto the stash box** (bottom-right corner) — same effect. The box scales up while you drag over it to show it's an eligible target.
- **Click the stash box** — opens the stash list. Each card has:
  - **Restore** — the tile comes back to canvas at its last known position.
  - **Destroy** — closes the PTY and removes the entry.
- **Clear All** — in the stash box header, closes every stashed terminal.

Stash state **persists** across workspace saves, so stashed terminals survive restarts.

---

## Multi-canvas, waypoints, and snapshot history

Three things you reach for when one screen of canvas isn't enough.

### Multiple named canvases

A canvas in TermCanvas is more than just a viewport — each canvas owns its own projects, viewport, and waypoints. Switch canvases the way you'd switch desktops:

- `⌘⇧]` / `⌘⇧[` — cycle to next / previous canvas.
- `⌘⇧N` — open the Canvas Manager: rename, reorder, create, delete.

Use canvases to separate concerns: one for "auth refactor", one for "exploration", one for "infra spelunking". Switching is instant; nothing reloads.

### Spatial waypoints

Up to 9 viewport snapshots per project. Save the current pan + zoom into a slot, recall it later with one chord:

- `⌘⇧1` … `⌘⇧9` — save the current viewport into slot 1–9.
- `⌥1` … `⌥9` — fly the camera to a saved waypoint (smooth animation).

A small dot strip at the bottom-centre of the canvas shows which slots are filled. Use waypoints when you have a sprawling layout and keep returning to the same three regions — the agent cluster, the diff drawer area, the Hydra workbench tiles.

### Snapshot history — `⌘⇧T`

`⌘S` saves the current canvas state. The Snapshot History modal goes the other direction: it shows the last 20 snapshots TermCanvas auto-captured (every layout change of consequence), lets you preview each one, and rolls the canvas back to that exact state. Diff mode highlights what would change if you restore. Useful after a heavy reorg you wish you hadn't done.

---

## Pins — capturing deferred work

Pins are the persistent "I'll handle this later" store. Each pin has a title, a description, and an optional link (e.g. a GitHub issue). Pins survive restarts and are scoped per repo.

The CLI is `termcanvas pin` (registered alongside `termcanvas` in Settings → CLI):

```bash
termcanvas pin add --title "Fix the OAuth refresh edge case" --body "Token expires mid-request..."
termcanvas pin add --title "Look at this issue" --link https://github.com/.../issues/42 --link-type github_issue
termcanvas pin list
termcanvas pin update <id> --status done
```

Inside the app, the Pin drawer surfaces the same store with one-click status toggles. Drop pins whenever you notice something but don't want to derail what you're doing right now.

---

## Logging in for cross-device sync

Click the avatar / login button in the top-right of the toolbar. This kicks off GitHub OAuth in your browser. Once signed in:

- **Usage** data syncs across devices (same dashboard on laptop + desktop).
- **Session history** from other logged-in devices shows up in the Left panel's History.
- **Device breakdown** appears at the bottom of the Usage dashboard — how much cost each machine contributed.

Login is entirely optional; the app works fully offline without it.

---

## Settings — what each toggle does

Open with `⌘,`. Three tabs:

### General

- **Font** — six downloadable Geist variants + system fallback. Changes apply live.
- **Font size** — affects terminal text only (not chrome).
- **Blur / Contrast** — backdrop styling for overlays.
- **Language** — English / Simplified Chinese (some labels mixed — we're still completing coverage).
- **Theme** — Dark / Light. Toggling also retints the Monaco editor.
- **Animation** — toggles canvas + overlay motion. Respects `prefers-reduced-motion` by default.
- **Composer** — enables `⌘;` composer bar. Off by default.
- **Drawing** — enables a sketch layer over the canvas. Hold `D` to enter drawing mode; `E` for erase; `C` to clear.
- **Browser** — enables in-canvas browser cards (embedded web views).
- **Summary** — if on, live terminals auto-summarise on idle.
- **Pet** — enables the capybara mascot. It reacts to telemetry events (working, waiting, completed, stuck). Off by default.
- **CLI registration** — installs `termcanvas` and `hydra` shims into your `$PATH`. One-click re-register if you moved the app.
- **Check for Updates** — triggers a manual auto-update check.

### Shortcuts

Every shortcut is rebindable. Click the current binding, press a new key combination, `Enter` to save. TermCanvas flags conflicts (e.g. two actions on the same key) and refuses to save until resolved.

### Agents

- **Provider selection** — pick your default agent (Claude, Codex, Kimi, Gemini, OpenCode).
- **API key** — for providers that need one.
- **Per-agent CLI override** — if you want TermCanvas to use `claude-beta` instead of `claude`, or a custom wrapper script, set it here. The command + args are validated by attempting a `--version` probe.

---

## Power features

These are aimed at heavier users; skip until you're comfortable with the basics.

- **Hydra orchestration** — a Lead agent that dispatches sub-tasks to worker agents across parallel worktrees. Enable per-project from the worktree header's "Enable Hydra" button: this writes orchestration instructions into `CLAUDE.md` / `AGENTS.md` so your agents know to use `hydra dispatch / watch / merge`. The `hydra` CLI is separate from the app — you use it from inside an agent terminal, not from the UI. Full design: [`docs/hydra-orchestration.md`](./hydra-orchestration.md).
- **Activity heatmap (`⌘⇧A`)** — paints each tile with a 5-minute output-volume sparkline so a glance at the canvas tells you which agents are doing work right now. Toggle on / off.
- **Pan-to-recent-activity (`⌥` + `` ` ``)** — fly the camera to whichever terminal had PTY output most recently. Repeat the chord to LRU-cycle through the recently-active set, Alt-Tab style.
- **Computer Use (Claude only)** — TermCanvas can dynamically inject a Computer Use MCP server into Claude / Codex terminals so an agent can drive macOS apps. Granting the right macOS permissions is automated; the agent runs `status` → `setup` → `get_instructions` itself. See the README's CLI section for the related `termcanvas computer-use` commands.
- **Telemetry** — every terminal emits lifecycle events (awaiting-input, tool-running, stall, completion). These drive the pet, status dots, attention queue, Hub, and `⌘K` session search. Disable from Settings → General if you want the app dead-quiet.
- **Headless mode** — `termcanvas headless` runs the whole stack as an HTTP/SSE service, no Electron window. Useful for CI or for driving TermCanvas from another app. See [`docs/headless-cloud-deployment.md`](./headless-cloud-deployment.md).
- **Workspace files** — `⌘S` / `⌘⇧S` save the canvas to a `.termcanvas` JSON file. Re-opening restores every project, worktree, terminal, drawing, stashed tile, and viewport. (For automatic state-history with rollback, see Snapshot History above.)

---

## Keyboard shortcuts cheatsheet

All shortcuts use **`⌘` on macOS** and **`Ctrl` on Linux / Windows**. Every one is rebindable (Settings → Shortcuts).

### Canvas navigation

| Key          | Action                                         |
| ------------ | ---------------------------------------------- |
| `⌘E`         | Toggle focus — zoom into focused / out to fit  |
| `⌘0` · `⌘1` · `⌘=` · `⌘-` | Zoom: fit · 100% · in · out       |
| `⌘]` / `⌘[`  | Next / previous terminal (spatial)             |
| `⌘G`         | Cycle focus level (terminal → worktree → starred) |
| `⌘F`         | Star / unstar focused terminal                 |
| `⌘⇧1`–`9`    | Save spatial waypoint to slot 1–9              |
| `⌥1`–`9`     | Recall spatial waypoint                        |
| `` ⌥` ``     | Pan to most-recently-active terminal           |
| `V` · `H` · `Space` (hold) | Select tool · Hand tool · Temporary pan |
| Scroll       | Pan canvas                                     |
| `⌘`-scroll   | Zoom toward cursor                             |
| Double-click (overview) | Zoom in on that terminal            |
| Shift+drag   | Box-select multiple terminals                  |
| Backspace    | Close selected terminals                       |

### Multi-canvas

| Key            | Action                              |
| -------------- | ----------------------------------- |
| `⌘⇧]` / `⌘⇧[`  | Next / previous canvas              |
| `⌘⇧N`          | Open Canvas Manager                 |

### Terminals

| Key    | Action                                     |
| ------ | ------------------------------------------ |
| `⌘T`   | New terminal in focused worktree           |
| `⌘D`   | Close focused terminal                     |
| `⌘;`   | Open composer (or inline rename)           |

### Discovery, panels, overlays

| Key       | Action                                            |
| --------- | ------------------------------------------------- |
| `⌘K`      | Global search                                     |
| `⌘P`      | Command Palette                                   |
| `⌘⇧J`     | Hub                                               |
| `⌘⇧/`     | Status digest                                     |
| `⌘/`      | Toggle right panel (Files / Diff / Git / Memory)  |
| `⌘⇧U`     | Usage dashboard                                   |
| `⌘⇧H`     | Sessions overlay                                  |
| `⌘⇧T`     | Snapshot history                                  |
| `⌘⇧A`     | Activity heatmap                                  |
| `Esc`     | Dismiss topmost overlay                           |

### Workspace

| Key     | Action                          |
| ------- | ------------------------------- |
| `⌘O`    | Add project                     |
| `⌘S` · `⌘⇧S` | Save / save-as workspace   |
| `⌘,`    | Settings                        |

### Menu-bar (macOS-style, cross-platform)

`File` → Open folder · Close window · Quit
`Edit` → Undo / Redo / Cut / Copy / Paste / Select All
`View` → Reset zoom · Zoom in · Zoom out · Toggle fullscreen

---

## Troubleshooting

**Resume printed `[Session expired, starting fresh...]`.** The CLI's own session store has evicted the conversation (Claude's has a TTL; Codex's drops after enough time). The terminal still works — it just started a fresh session instead of resuming.

**"Continue" button on a Claude replay is grayed out.** The session's recorded `cwd` doesn't match any worktree currently on the canvas. Either add that project to the canvas, or use `claude --resume <id>` from a terminal directly.

**The Usage dashboard is blank.** Make sure `~/.claude/projects/*/usage-*.json` files exist (they're created once you've used Claude). For Codex, telemetry needs to be flowing — check `Settings → Agents` that your Codex CLI override (if any) is working.

**New terminal spawns offscreen.** You're probably deeply zoomed + panned. Press `⌘E` to zoom out, then click the terminal to focus.

**Pet doesn't show up.** It's off by default. Enable in `Settings → General → Pet`.

**`⌘K` file results don't show up.** File search needs ripgrep on your `$PATH`. Install with `brew install ripgrep` or `apt install ripgrep`. Other result categories work without it.

---

Feedback and bug reports welcome at [github.com/blueberrycongee/termcanvas/issues](https://github.com/blueberrycongee/termcanvas/issues).
