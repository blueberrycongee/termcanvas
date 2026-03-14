# TermCanvas

An infinite canvas desktop app for visually managing terminals. Organize your development workflow with a three-layer hierarchy: **Project → Worktree → CLI**.

## Features

- Infinite canvas with pan and zoom
- Three-layer visual hierarchy: git projects, worktrees, and terminal instances
- Drag, resize, minimize, and fullscreen-focus terminal tiles
- Session restore for Claude Code and Codex terminals
- Scrollback buffer persistence for regular shells

## Tech Stack

- Electron + React 18 + TypeScript
- xterm.js + node-pty
- Zustand for state management
- Tailwind CSS
- Vite

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## License

[MIT](LICENSE)
