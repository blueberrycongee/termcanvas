<div align="center">

<img src="docs/icon.png" width="128" alt="TermCanvas app icon" />

# TermCanvas

**Your terminals, on an infinite canvas.**

[![GitHub release](https://img.shields.io/github/v/release/blueberrycongee/termcanvas)](https://github.com/blueberrycongee/termcanvas/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)]()
[![Website](https://img.shields.io/badge/website-termcanvas-e8b840)](https://website-ten-mu-37.vercel.app)

[**termcanvas.dev →**](https://website-ten-mu-37.vercel.app)

</div>

<div align="center">
<img src="docs/image.png" alt="TermCanvas demo — multiple AI agents on an infinite canvas" />
</div>

[中文文档](./README.zh-CN.md)

## What is TermCanvas

TermCanvas spreads all your terminals across an infinite spatial canvas — no more tabs, no more split panes. Drag them around, zoom in to focus, zoom out to see the big picture, and annotate with freehand drawings.

It organizes everything in a **Project → Worktree → Terminal** hierarchy that mirrors how you actually use git. Add a project, and TermCanvas auto-detects its worktrees. Create a new worktree from the terminal, and it appears on the canvas instantly.

## Features

**Canvas**
- Infinite canvas — pan, zoom, and arrange terminals freely
- Three-layer hierarchy — projects contain worktrees, worktrees contain terminals
- Live worktree detection — new worktrees appear automatically
- Double-click a terminal title bar to zoom-to-fit
- Drag-to-reorder terminals within a worktree
- Box-select — drag to select multiple terminals at once
- Drawing tools — pen, text, rectangles, arrows for annotations (toggleable)
- Workspace save / save-as — persist your entire layout to a `.termcanvas` file, with dirty-state tracking

**AI coding agents**
- First-class support for Claude Code, Codex, Kimi, Gemini, and OpenCode
- Composer — a unified input bar that sends prompts to the focused agent, with image paste support
- Live session status — see at a glance whether an agent is working, waiting, or done
- Completion glow — visual pulse when an agent finishes its turn
- Session resume — close and reopen an agent terminal without losing context
- CLI auto-detection — TermCanvas finds installed agent CLIs automatically; override per-agent in settings
- Inline diff cards — review an agent's changes without leaving the canvas
- File and directory tree cards — browse files on the canvas alongside terminals

**General terminals**
- Shell, lazygit, and tmux terminals live alongside AI agents on the same canvas
- Star terminals — mark important terminals and cycle through them with `⌘ J` / `⌘ K`
- Rename terminal titles with `⌘ ;`
- Resize terminals: default, wide, tall, and large presets

**Usage tracking**
- Token usage and cost dashboard — total spend, per-project breakdown, per-model breakdown
- Hourly token heatmap and 24-hour cost sparkline
- Cache hit/miss stats
- Quota monitor — 5-hour and 7-day rate-limit utilization with adaptive polling
- Cloud sync — sign in to aggregate usage across devices via Supabase

**Settings**
- **Display** — choose from 6 monospace fonts (Geist Mono, Geist Pixel Square, JetBrains Mono, Fira Code, IBM Plex Mono, Hack) with one-click download; font size 6–24 px
- **Theme** — dark and light mode, with warm stone color palette and accessible ANSI colors
- **Agents** — auto-detect or manually override CLI path for each agent type
- **Shortcuts** — every keyboard shortcut is customizable and persisted
- **Composer** — toggle the experimental composer input bar
- **Drawing** — toggle the drawing toolbar
- **Advanced** — minimum contrast ratio slider (1–7) for terminal text accessibility
- **i18n** — English and Chinese (auto-detected from system locale)
- **Auto-update** — in-app update notifications with changelog

**CLI**
- `termcanvas` — control the canvas from your terminal: manage projects, create/destroy terminals, send input, read output, view diffs
- `hydra` — spawn AI sub-agents in isolated git worktrees, then review and merge their work

## Quick Start

**Website** — see features and screenshots at [termcanvas.dev](https://website-ten-mu-37.vercel.app).

**Download** — grab the latest build from [GitHub Releases](https://github.com/blueberrycongee/termcanvas/releases).

**Build from source:**

```bash
git clone https://github.com/blueberrycongee/termcanvas.git
cd termcanvas
npm install
npm run dev
```

**Install CLI tools** — after launching the app, go to Settings → General → Command line interface and click Register. This adds `termcanvas` and `hydra` to your PATH, and installs the Hydra skill into both Claude Code and Codex skill directories.

## CLI

Both CLIs are bundled with the app. Register them from Settings to use in any terminal.

### termcanvas

```
Usage: termcanvas <project|terminal|diff|state> <command> [args]

Project commands:
  project add <path>                          Add a project to the canvas
  project list                                List all projects
  project remove <id>                         Remove a project
  project rescan <id>                         Rescan worktrees for a project

Terminal commands:
  terminal create --worktree <path> --type <type>   Create a terminal
          [--prompt <text>] [--parent-terminal <id>] [--auto-approve]
  terminal list [--worktree <path>]            List terminals
  terminal status <id>                         Get terminal status
  terminal input <id> <text>                   Send text input to a terminal
  terminal output <id> [--lines N]             Read terminal output (default 50 lines)
  terminal destroy <id>                        Destroy a terminal

Other commands:
  diff <worktree-path> [--summary]             View git diff for a worktree
  state                                        Dump full canvas state as JSON

Flags:
  --json    Output in JSON format
```

<div align="center">

<img src="docs/hydra-icon.png" width="80" alt="Hydra icon" />

### hydra

</div>

Hydra lets you break a big task into smaller pieces and hand each piece to an AI agent — Claude, Codex, Kimi, Gemini, or OpenCode. Every agent gets its own git worktree and its own terminal on the canvas, so you can watch them all work in parallel and step in whenever you need to.

**Spawn an agent:**

```bash
hydra spawn --task "fix the login bug" --type claude --repo .
# → returns JSON: { agentId, terminalId, worktreePath, branch, resultFile }
```

This creates a new worktree + branch, opens a terminal on the canvas, and sends the task to the agent. The agent works in full isolation — it can only touch files inside its own worktree.

Pass `--auto-approve` to inherit the parent agent's permission level (maps to `--dangerously-skip-permissions` for Claude, `--dangerously-bypass-approvals-and-sandbox` for Codex).

**For read-only tasks** (code review, analysis), point to an existing worktree instead of creating one:

```bash
hydra spawn --task "audit auth for vulnerabilities" --type claude --repo . --worktree ./my-worktree
```

**Monitor, review, and merge:**

```bash
hydra list                              # see all agents and their status
termcanvas terminal status <id>         # check if an agent is done
termcanvas diff <worktree> --summary    # review what the agent changed
cat <resultFile>                        # read the agent's summary
git merge <branch>                      # adopt the changes
hydra cleanup <agent-id>                # remove the worktree and terminal
```

**Setup:**

```bash
hydra init    # add Hydra usage instructions to your project's CLAUDE.md and AGENTS.md
```

This teaches your main AI agent when and how to spawn sub-agents automatically.

## Keyboard Shortcuts

All shortcuts are customizable in Settings → Shortcuts.

| Shortcut | Action |
|----------|--------|
| `⌘ O` | Add project |
| `⌘ B` | Toggle sidebar |
| `⌘ /` | Toggle right panel (usage) |
| `⌘ T` | New terminal |
| `⌘ D` | Close focused terminal |
| `⌘ ;` | Rename terminal title |
| `⌘ ]` | Next terminal |
| `⌘ [` | Previous terminal |
| `⌘ E` | Unfocus / refocus last terminal |
| `⌘ F` | Star / unstar focused terminal |
| `⌘ J` | Next starred terminal |
| `⌘ K` | Previous starred terminal |
| `⌘ S` | Save workspace |
| `⌘ ⇧ S` | Save workspace as |
| `⌘ 1` | Terminal size: default |
| `⌘ 2` | Terminal size: wide |
| `⌘ 3` | Terminal size: tall |
| `⌘ 4` | Terminal size: large |

> On Windows/Linux, replace `⌘` with `Ctrl`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron |
| Frontend | React, TypeScript |
| Terminal | xterm.js (WebGL), node-pty |
| State | Zustand |
| Styling | Tailwind CSS, Geist font |
| Drawing | perfect-freehand |
| Auth & sync | Supabase |
| Build | Vite, esbuild |

## Acknowledgements

- [lazygit](https://github.com/jesseduffield/lazygit) — TermCanvas integrates lazygit as a built-in terminal type for visual git management on the canvas.

## Contributing & License

Contributions welcome — fork, branch, and open a PR. Licensed under [MIT](LICENSE).
