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

<img src="docs/demo.gif" alt="TermCanvas in action — canvas navigation, focus, zoom, and panel switching" />

<br>

<img src="docs/image.png?v=2" alt="TermCanvas demo — multiple AI agents on an infinite canvas" />

</div>

<br>

TermCanvas spreads all your terminals across an infinite spatial canvas — no more tabs, no more split panes. Drag them around, zoom in to focus, zoom out to see the big picture.

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

Double-click a terminal title bar to zoom-to-fit. Drag to reorder. Box-select multiple terminals. Save your entire layout to a `.termcanvas` file.

### AI Coding Agents

First-class support for **Claude Code**, **Codex**, **Kimi**, **Gemini**, and **OpenCode**.

- **Live status & completion glow** — see at a glance whether an agent is working, waiting, or done
- **Telemetry truth layer** — real-time turn state, tool activity, and progress tracking per agent; stall detection, advisory badges, and structured snapshots for both UI and Hydra
- **Session resume** — close and reopen an agent terminal without losing context
- **Inline diff cards** — review an agent's changes without leaving the canvas

### Git

Built-in Git panel in the left sidebar — commit history, diff viewer, and git status at a glance without leaving the canvas.

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
Usage: termcanvas <project|terminal|telemetry|diff|state> <command> [args]

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
  terminal output <id> [--lines N]             Read terminal output (default 50 lines)
  terminal destroy <id>                        Destroy a terminal

Telemetry commands:
  telemetry get --terminal <id>                Get terminal telemetry snapshot
  telemetry get --workflow <id> [--repo <p>]   Get workflow telemetry snapshot
  telemetry events --terminal <id>             List recent terminal telemetry events

Other commands:
  diff <worktree-path> [--summary]             View git diff for a worktree
  state                                        Dump full canvas state as JSON

Flags:
  --json    Output in JSON format
```

</details>

```bash
termcanvas project add ~/my-repo
termcanvas terminal create --worktree ~/my-repo --type claude --prompt "Audit the auth flow and fix the root cause"
termcanvas terminal status <id>
termcanvas telemetry get --terminal <id>
termcanvas diff ~/my-repo --summary
```

For Claude/Codex task automation, start a fresh terminal with `termcanvas terminal create --prompt "..."`. `termcanvas terminal input` is not a supported dispatch path.

<br>

<div align="center">
<img src="docs/hydra-icon.png" width="80" alt="Hydra icon" />

### hydra
</div>

<br>

Hydra is TermCanvas's terminal orchestration toolkit for Lead-driven workflows and isolated direct workers. It coordinates **git worktrees**, **assignment/run file contracts**, and the **telemetry truth layer** without taking control away from the agent sessions themselves.

Hydra is now **Lead-driven**. One main terminal owns the workflow, reads the codebase, and decides what to do at each decision point. Worker terminals stay autonomous. Workflow state lives under repo-local `.hydra/workflows/`, and the authoritative contract is on disk: `inputs/intent.md`, `nodes/<nodeId>/intent.md`, `report.md`, `result.json`, and `ledger.jsonl`. Terminal prose is advisory only; validated `result.json` is the machine gate.

Role-driven workflows currently target **Claude/Codex** through the Hydra role registry. If you only need one isolated worker without a Lead-driven DAG, use `hydra spawn` instead.

This design is inspired by [Anthropic's harness design research](https://www.anthropic.com/engineering/harness-design-long-running-apps) on long-running agent orchestration, adapted for terminal-based agents where each process is naturally isolated. For the theoretical foundations behind this approach, see [Harness Design from a Distribution Perspective](harness-design-essay.md).

#### Getting started

Run `hydra init-repo` in your project (or click **Enable Hydra** in the worktree header) to sync the Hydra instructions into `CLAUDE.md` / `AGENTS.md`. Then either talk to your main agent, or drive the workflow yourself:

> *Write a PRD or describe your requirements clearly, then tell the agent:*
>
> *"Read the Hydra skill. I want you to choose the right mode and autonomously complete this task based on the PRD in `docs/prd/auth-redesign.md`."*

The main agent should classify the task and pick the lightest fitting path:

- **Stay in current agent** — simple or local tasks, no orchestration overhead
- **`hydra spawn`** — a direct isolated worker when the task is clear and self-contained
- **`hydra init` + `dispatch` + `watch`** — Lead-driven workflow for ambiguous, risky, parallel, or multi-step work

```bash
hydra init-repo

hydra init --intent "Add OAuth login" --repo .

hydra dispatch --workflow <workflow-id> --node dev --role dev \
  --intent "Implement OAuth login and the tests that cover it" --repo .

hydra watch --workflow <workflow-id> --repo .

hydra dispatch --workflow <workflow-id> --node review --role reviewer \
  --intent "Independent review of the OAuth change" \
  --depends-on dev --repo .

hydra watch --workflow <workflow-id> --repo .
hydra complete --workflow <workflow-id> --repo .
```

Role files choose the CLI / model / reasoning profile. The caller chooses the `role`; Hydra resolves the terminal from that role definition.

<details>
<summary>Full command reference</summary>

```
Usage: hydra <command> [options]

Lead-driven workflow:
  init        Create a workflow context
  dispatch    Dispatch a node into a workflow
  watch       Wait until a decision point is reached
  redispatch  Re-run an eligible/reset node
  approve     Mark a node output as approved
  reset       Reset a node (and downstream by default) for rework
  ask         Ask a completed node a follow-up question via session resume
  merge       Merge completed parallel node branches
  complete    Mark a workflow as completed
  fail        Mark a workflow as failed

Inspection:
  status      Show structured workflow + assignment state
  ledger      Show workflow event log
  list        List direct spawned agents (pass --workflows for workflows)
  list-roles  Show available role definitions

Housekeeping:
  spawn      Create one direct isolated worker terminal
  cleanup    Clean up workflow state or direct spawned workers
  init-repo  Sync Hydra instructions into CLAUDE.md and AGENTS.md
```

</details>

<details>
<summary>Example commands</summary>

```bash
# Repo setup
hydra init-repo

# Start a Lead-driven workflow
hydra init --intent "fix the login bug" --repo .

# Dispatch a node and wait for the decision point
hydra dispatch --workflow <workflow-id> --node dev --role dev \
  --intent "Fix the login bug and add regression coverage" --repo .
hydra watch --workflow <workflow-id> --repo .

# Ask a completed node a follow-up question without re-running it
hydra ask --workflow <workflow-id> --node dev \
  --message "Why did you change the session validation path?" --repo .

# Send a node back for rework
hydra reset --workflow <workflow-id> --node dev \
  --feedback "The fix regressed the refresh-token path. Rework it." --repo .
hydra redispatch --workflow <workflow-id> --node dev --repo .

# Direct isolated worker
hydra spawn --task "investigate the flaky CI failure" --repo .

# Inspection
hydra status --workflow <workflow-id> --repo .
hydra ledger --workflow <workflow-id> --repo .
hydra list --workflows --repo .
hydra list-roles --repo .

# Cleanup
hydra cleanup --workflow <workflow-id> --repo . --force
hydra cleanup <agent-id> --force
```

</details>

Lead-driven workflows advance through validated `result.json` evidence inside `.hydra/workflows/`. The telemetry truth layer provides real-time `turn_state`, `last_meaningful_progress_at`, `derived_status`, and session attachment data — used by both the UI and Hydra's watch / retry / health-check paths.

**Typical workflow:** write a PRD → run `hydra init-repo` once → let the Lead choose direct work vs `spawn` vs `init/dispatch/watch` → monitor via `hydra watch` or the canvas UI → read `report.md` before approving / resetting / completing. See [Hydra Orchestration Guide](docs/hydra-orchestration.md) for the control-plane details, and the [Hydra Panoramic Flowchart](docs/hydra-panorama-flow.md) for the updated state / file model.

---

## Keyboard Shortcuts

All shortcuts are customizable in Settings → Shortcuts. On Windows/Linux, the default app shortcuts use <kbd>Alt</kbd>.

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
<tr><td><b>Auth & sync</b></td><td>Supabase</td></tr>
<tr><td><b>Build</b></td><td>Vite · esbuild</td></tr>
</table>

<br>

**Acknowledgements** — [lazygit](https://github.com/jesseduffield/lazygit) is integrated as a built-in terminal type for visual git management on the canvas.

---

## Roadmap

TermCanvas is evolving from a local desktop tool into a **cloud-native AI development platform**. Here's what's coming:

### Cloud Runtime

Move task execution from your local machine to the cloud. Spin up AI agents on remote runtimes — your tasks run in managed environments with full git, toolchain, and dependency support, while your canvas remains the single pane of glass.

- **Hosted agent execution** — delegate Claude, Codex, and other agent tasks to cloud workers with on-demand compute
- **Persistent remote sessions** — close your laptop, come back later, your agents are still working
- **Parallel cloud workers** — scale out Hydra workflows across multiple cloud instances instead of local terminals

### Automated Vibe Pipeline

End-to-end automation from idea to shipped code, powered by cloud runtime:

- **Intent → Plan → Implement → Review → Merge** — a fully automated pipeline where you describe what you want and the system handles the rest
- **Continuous vibe loop** — agents plan, implement, self-review, and iterate autonomously until the result meets acceptance criteria
- **Pipeline-as-code** — define reusable workflow templates for common tasks (bug triage, feature implementation, migration, refactoring)
- **Human-in-the-loop checkpoints** — configurable approval gates at any stage for when you want to stay in control

### Vision

The goal is simple: **you describe intent, TermCanvas handles the rest.** Your canvas becomes a mission control for autonomous AI development — monitor progress, review results, intervene when needed, and let the cloud do the heavy lifting.

---

**Contributing** — fork, branch, and open a PR. Licensed under [MIT](LICENSE).

<div align="center">

<img src="docs/QQ.jpg" width="240" alt="QQ Group" />

[![Star History Chart](https://api.star-history.com/svg?repos=blueberrycongee/termcanvas&type=Date)](https://star-history.com/#blueberrycongee/termcanvas&Date)

</div>
