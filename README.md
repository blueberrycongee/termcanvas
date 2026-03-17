<div align="center">

<img src="docs/icon.png" width="128" alt="TermCanvas app icon" />

# TermCanvas

**Your terminals, on an infinite canvas.**

[![GitHub release](https://img.shields.io/github/v/release/blueberrycongee/termcanvas)](https://github.com/blueberrycongee/termcanvas/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)]()

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
- Drawing tools — pen, text, rectangles, arrows for annotations
- Workspace save/load — persist your entire layout to a file

**AI coding agents**
- First-class support for Claude Code, Codex, Kimi, Gemini, and OpenCode
- Live session status — see at a glance whether an agent is working, waiting, or done
- Inline diff cards — review an agent's changes without leaving the canvas

**CLI**
- `termcanvas` — control the canvas from your terminal: add projects, create terminals, read output, view diffs
- `hydra` — spawn AI sub-agents in isolated git worktrees, then review and merge their work

## Quick Start

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

```bash
termcanvas project add ~/my-repo     # add a project to the canvas
termcanvas project list              # list projects
termcanvas terminal create --worktree ~/my-repo --type claude
termcanvas terminal status <id>      # check terminal status
termcanvas diff ~/my-repo --summary  # view worktree diff
```

### hydra

Hydra lets you break a big task into smaller pieces and hand each piece to an AI agent — Claude, Codex, Kimi, Gemini, or OpenCode. Every agent gets its own git worktree and its own terminal on the canvas, so you can watch them all work in parallel and step in whenever you need to.

**Spawn an agent:**

```bash
hydra spawn --task "fix the login bug" --type claude --repo .
# → returns JSON: { agentId, terminalId, worktreePath, branch, resultFile }
```

This creates a new worktree + branch, opens a terminal on the canvas, and sends the task to the agent. The agent works in full isolation — it can only touch files inside its own worktree.

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

| Shortcut | Action |
|----------|--------|
| `⌘ O` | Add project |
| `⌘ B` | Toggle sidebar |
| `⌘ T` | New terminal |
| `⌘ ]` | Next terminal |
| `⌘ [` | Previous terminal |
| `⌘ E` | Unfocus / refocus last terminal |
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
| Terminal | xterm.js, node-pty |
| State | Zustand |
| Styling | Tailwind CSS, Geist font |
| Drawing | perfect-freehand |
| Build | Vite |

## Contributing & License

Contributions welcome — fork, branch, and open a PR. Licensed under [MIT](LICENSE).
