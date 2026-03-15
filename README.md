# TermCanvas

An infinite canvas desktop app for visually managing terminals across git projects and worktrees.

[中文文档](./README.zh-CN.md)

## Overview

TermCanvas organizes your development workflow on a spatial canvas. Instead of tabbed terminals buried in a sidebar, you see all your projects, worktrees, and terminals laid out visually — drag them around, draw annotations, and focus on what matters.

**Project → Worktree → Terminal** — a three-layer hierarchy that mirrors how you actually work with git.

## Features

- **Infinite canvas** — pan, zoom, and arrange freely
- **Three-layer hierarchy** — git projects contain worktrees, worktrees contain terminals
- **Live worktree detection** — create a worktree in your terminal, it appears automatically
- **Drawing tools** — pen, text, rectangles, and arrows for annotations
- **Terminal types** — Shell, Claude Code, and Codex with status indicators
- **Sidebar navigation** — click a project to fly to it with smooth animation
- **Drag & resize** — every container is draggable and resizable with zoom-aware coordinates
- **Click to focus** — overlapping containers brought to front on click

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 41 |
| Frontend | React 19, TypeScript |
| Terminal | xterm.js 6, node-pty |
| State | Zustand 5 |
| Styling | Tailwind CSS 4, Geist font |
| Drawing | perfect-freehand |
| Build | Vite 7 |

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- macOS, Linux, or Windows

### Install

```bash
git clone https://github.com/blueberrycongee/termcanvas.git
cd termcanvas
npm install
```

### Development

```bash
npm run dev
```

This starts Vite dev server and launches the Electron app with hot reload.

### Build

```bash
npm run build
```

## Project Structure

```
termcanvas/
├── electron/              # Electron main process
│   ├── main.ts            # Window creation, IPC handlers
│   ├── preload.ts         # Context bridge API
│   ├── pty-manager.ts     # node-pty lifecycle management
│   ├── project-scanner.ts # Git worktree scanning & watching
│   └── state-persistence.ts
├── src/                   # React renderer
│   ├── canvas/            # Infinite canvas, drawing layer
│   ├── containers/        # Project and worktree containers
│   ├── terminal/          # Terminal tile with xterm.js
│   ├── toolbar/           # Top toolbar
│   ├── components/        # Sidebar, notifications
│   ├── stores/            # Zustand stores
│   ├── hooks/             # Drag, resize hooks
│   └── types/             # TypeScript interfaces
├── vite.config.ts
└── package.json
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Electron Main Process                  │
│  ┌──────────┐ ┌────────────────────┐    │
│  │ PtyManager│ │ ProjectScanner     │    │
│  │ (node-pty)│ │ (fs.watch + git)   │    │
│  └──────────┘ └────────────────────┘    │
│        ↕ IPC            ↕ IPC           │
├─────────────────────────────────────────┤
│  Renderer Process                       │
│  ┌────────────────────────────────────┐ │
│  │ Canvas (transform: translate/scale)│ │
│  │  ├── DrawingLayer (SVG)            │ │
│  │  ├── ProjectContainer (absolute)   │ │
│  │  │    └── WorktreeContainer        │ │
│  │  │         └── TerminalTile        │ │
│  │  │              └── xterm.js       │ │
│  └────────────────────────────────────┘ │
│  Zustand: canvasStore, projectStore,    │
│           drawingStore, notificationStore│
└─────────────────────────────────────────┘
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes (`git commit -m "feat: add something"`)
4. Push to the branch (`git push origin feat/your-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
