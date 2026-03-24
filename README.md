<div align="center">

<img src="docs/icon.png" width="128" alt="TermCanvas app icon" />

# TermCanvas

**Your terminals, on an infinite canvas.**

[![GitHub release](https://img.shields.io/github/v/release/blueberrycongee/termcanvas)](https://github.com/blueberrycongee/termcanvas/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)]()
[![Website](https://img.shields.io/badge/website-termcanvas-e8b840)](https://website-ten-mu-37.vercel.app)

[**termcanvas.dev →**](https://website-ten-mu-37.vercel.app)

<br>

<img src="docs/image.png" alt="TermCanvas demo — multiple AI agents on an infinite canvas" />

</div>

<br>

TermCanvas spreads all your terminals across an infinite spatial canvas — no more tabs, no more split panes. Drag them around, zoom in to focus, zoom out to see the big picture, and annotate with freehand drawings.

It organizes everything in a **Project → Worktree → Terminal** hierarchy that mirrors how you actually use git. Add a project, and TermCanvas auto-detects its worktrees. Create a new worktree from the terminal, and it appears on the canvas instantly.

<p align="right"><a href="./README.zh-CN.md">中文文档 →</a></p>

---

## Quick Start

**Download** — grab the latest build from [GitHub Releases](https://github.com/blueberrycongee/termcanvas/releases).

> [!WARNING]
> **macOS note for unsigned builds**
> If macOS says TermCanvas is damaged or blocks launch because the app is unsigned, clear the quarantine attribute and try again:
>
> ```bash
> xattr -cr /Applications/TermCanvas.app
> ```
>
> If you installed the app somewhere else, replace the path with the actual app location.

**Build from source:**

```bash
git clone https://github.com/blueberrycongee/termcanvas.git
cd termcanvas
npm install
npm run dev
```

**Install CLI tools** — after launching the app, go to Settings → General → Command line interface and click Register. This adds `termcanvas` and `hydra` to your PATH.

---

## Features

### Canvas

Infinite canvas — pan, zoom, and arrange terminals freely. Three-layer hierarchy: projects contain worktrees, worktrees contain terminals. New worktrees appear automatically as you create them.

Double-click a terminal title bar to zoom-to-fit. Drag to reorder. Box-select multiple terminals. Annotate with pen, text, rectangles, and arrows. Save your entire layout to a `.termcanvas` file.

### AI Coding Agents

First-class support for **Claude Code**, **Codex**, **Kimi**, **Gemini**, and **OpenCode**.

- **Composer** — a unified input bar that sends prompts to the focused agent, with image paste support
- **Live status & completion glow** — see at a glance whether an agent is working, waiting, or done
- **Session resume** — close and reopen an agent terminal without losing context
- **Inline diff cards** — review an agent's changes without leaving the canvas

### Terminals

Shell, lazygit, and tmux terminals live alongside AI agents on the same canvas. Star important terminals and cycle through them with <kbd>⌘</kbd> <kbd>J</kbd> / <kbd>K</kbd>. Four size presets, customizable titles, per-agent CLI override.

### Usage Tracking

Token usage and cost dashboard — total spend, per-project and per-model breakdown. Hourly token heatmap, 24-hour cost sparkline, cache hit/miss stats. Quota monitor for 5-hour and 7-day rate limits. Sign in to sync usage across devices.

### Settings

6 downloadable monospace fonts · dark/light theme · customizable keyboard shortcuts · minimum contrast ratio for accessibility · English and Chinese (auto-detected) · auto-update with in-app changelog.

---

## CLI

Both CLIs are bundled with the app. Register them from Settings to use in any terminal.

### termcanvas

<details>
<summary>Full command reference</summary>

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

</details>

```bash
termcanvas project add ~/my-repo
termcanvas terminal create --worktree ~/my-repo --type claude
termcanvas terminal status <id>
termcanvas diff ~/my-repo --summary
```

<br>

<div align="center">
<img src="docs/hydra-icon.png" width="80" alt="Hydra icon" />

### hydra
</div>

<br>

Hydra lets you break a big task into smaller pieces and hand each piece to an AI agent running in its own git worktree. Every agent gets its own terminal on the canvas, so you can watch them all work in parallel.

**The easiest way to use Hydra is to ask your AI agent directly.** After running `hydra init` in your project, just tell your agent:

> *"Use Hydra to split this refactor into subtasks and run them in parallel."*

The agent already knows how to call `hydra spawn`, monitor progress, and merge results — you don't need to memorize any CLI flags.

```bash
hydra init    # teach Claude Code / Codex how to use Hydra in this project
```

<details>
<summary>Manual usage</summary>

```bash
hydra spawn --task "fix the login bug" --type claude --repo .
hydra list
hydra cleanup <agent-id>
```

`hydra spawn` creates a worktree + branch, opens a terminal on the canvas, and sends the task. Pass `--auto-approve` to inherit the parent agent's permission level. For read-only tasks (review, analysis), pass `--worktree <path>` to reuse an existing worktree.

</details>

---

## Keyboard Shortcuts

All shortcuts are customizable in Settings → Shortcuts. On Windows/Linux, replace <kbd>⌘</kbd> with <kbd>Ctrl</kbd>.

| Shortcut | Action |
|----------|--------|
| <kbd>⌘</kbd> <kbd>O</kbd> | Add project |
| <kbd>⌘</kbd> <kbd>B</kbd> | Toggle sidebar |
| <kbd>⌘</kbd> <kbd>/</kbd> | Toggle right panel (usage) |
| <kbd>⌘</kbd> <kbd>T</kbd> | New terminal |
| <kbd>⌘</kbd> <kbd>D</kbd> | Close focused terminal |
| <kbd>⌘</kbd> <kbd>;</kbd> | Rename terminal title |
| <kbd>⌘</kbd> <kbd>]</kbd> | Next terminal |
| <kbd>⌘</kbd> <kbd>[</kbd> | Previous terminal |
| <kbd>⌘</kbd> <kbd>E</kbd> | Unfocus / refocus last terminal |
| <kbd>⌘</kbd> <kbd>F</kbd> | Star / unstar focused terminal |
| <kbd>⌘</kbd> <kbd>J</kbd> | Next starred terminal |
| <kbd>⌘</kbd> <kbd>K</kbd> | Previous starred terminal |
| <kbd>⌘</kbd> <kbd>S</kbd> | Save workspace |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>S</kbd> | Save workspace as |
| <kbd>⌘</kbd> <kbd>1</kbd>–<kbd>4</kbd> | Terminal size: default / wide / tall / large |

---

<table>
<tr><td><b>Desktop</b></td><td>Electron</td></tr>
<tr><td><b>Frontend</b></td><td>React · TypeScript</td></tr>
<tr><td><b>Terminal</b></td><td>xterm.js (WebGL) · node-pty</td></tr>
<tr><td><b>State</b></td><td>Zustand</td></tr>
<tr><td><b>Styling</b></td><td>Tailwind CSS · Geist</td></tr>
<tr><td><b>Drawing</b></td><td>perfect-freehand</td></tr>
<tr><td><b>Auth & sync</b></td><td>Supabase</td></tr>
<tr><td><b>Build</b></td><td>Vite · esbuild</td></tr>
</table>

<br>

**Acknowledgements** — [lazygit](https://github.com/jesseduffield/lazygit) is integrated as a built-in terminal type for visual git management on the canvas.

**Contributing** — fork, branch, and open a PR. Licensed under [MIT](LICENSE).
