# TermCanvas Design

An infinite canvas desktop app for visually managing terminals in a three-layer hierarchy: Project → Worktree → CLI.

## Data Model

```
Canvas
├── viewport: { x, y, scale }
├── projects: Project[]
│   ├── id: string
│   ├── name: string                  # repo name
│   ├── path: string                  # local repo path
│   ├── position: { x, y }           # position on canvas
│   ├── collapsed: boolean
│   └── worktrees: Worktree[]
│       ├── id: string
│       ├── name: string              # branch / worktree name
│       ├── path: string              # worktree directory path
│       ├── position: { x, y }       # offset relative to Project
│       ├── collapsed: boolean
│       └── terminals: Terminal[]
│           ├── id: string
│           ├── title: string
│           ├── type: "shell" | "claude" | "codex"
│           ├── position: { x, y }   # offset relative to Worktree
│           ├── size: { w, h }
│           ├── minimized: boolean
│           ├── focused: boolean
│           ├── ptyId: number         # node-pty process ID
│           └── sessionId?: string    # AI tool session ID (for restore)
```

## State Management

Three Zustand stores:

- **canvasStore** — viewport state (zoom, pan), global actions (add project, save/load layout)
- **projectStore** — project tree structure (projects, worktrees, terminals)
- **terminalStore** — terminal runtime state (pty connection map, scrollback buffer cache)

## Persistence

- Layout data (positions, sizes) → `~/.termcanvas/state.json`
- Scrollback buffers → `~/.termcanvas/scrollback/{terminalId}.buf`
- AI session IDs → stored in layout JSON for session restore

## Architecture

### Electron Process Model

```
Main Process (Node.js)
├── PTY Manager
│   ├── Create/destroy node-pty instances
│   ├── Maintain ptyId → pty instance mapping
│   └── Data relay: pty.onData → IPC → renderer
├── Project Scanner
│   ├── Read git repo info
│   └── Execute `git worktree list` and parse output
├── State Persistence
│   ├── Auto-save layout + scrollback on interval
│   └── Save running terminal metadata on close
└── IPC Handlers
    ├── terminal:create / terminal:destroy
    ├── terminal:input / terminal:output
    ├── terminal:resize
    ├── project:scan
    └── state:save / state:load

Renderer Process (React)
├── Canvas Layer — CSS transform container
│   ├── ProjectContainer × N
│   │   ├── Title bar (project name, collapse, add worktree)
│   │   └── WorktreeContainer × N
│   │       ├── Title bar (branch name, collapse, new terminal)
│   │       └── TerminalTile × N
│   │           ├── Title bar (title, type icon, minimize/close)
│   │           └── xterm.js instance
├── Toolbar — top bar (add project, zoom controls, search)
└── Overlay — fullscreen terminal focus layer
```

### IPC Communication

```
User input → xterm.js onData → IPC terminal:input(ptyId, data) → main → pty.write(data)
PTY output → pty.onData → IPC terminal:output(ptyId, data) → renderer → xterm.js write(data)
Resize     → xterm.js onResize → IPC terminal:resize(ptyId, cols, rows) → pty.resize(cols, rows)
```

### Session Restore Flow

```
App start
  → Read state.json
  → Restore canvas layout (project/worktree/terminal positions)
  → For each terminal:
      ├── type: "shell"
      │   → Create new pty (cd to worktree dir)
      │   → Load scrollback buffer into xterm
      │   → Show hint: [Session restored]
      ├── type: "claude"
      │   → Create new pty
      │   → Run: claude --resume {sessionId}
      │   → On failure: show hint, fall back to plain shell
      └── type: "codex"
          → Create new pty
          → Run: codex resume {sessionId}
          → Same failure handling
```

## Canvas Interaction

### Rendering Approach

CSS Transform canvas — a container div with `transform: scale(s) translate(tx, ty)`. All tiles are real DOM nodes.

```
Container div (overflow: hidden, fullscreen)
└── Transform div (transform: scale(s) translate(tx, ty))
    └── All Project/Worktree/Terminal nodes
```

### Controls

- **Pan**: middle mouse drag / trackpad two-finger scroll → update translate
- **Zoom**: scroll wheel / trackpad pinch → update scale (range 0.1–2.0), zoom toward cursor
- **Box select**: Shift + left mouse drag to select multiple tiles, batch move

### Tile Operations

| Operation | Interaction |
|-----------|-------------|
| Drag move | Left click + hold title bar |
| Resize | Drag handle at bottom-right / edges |
| Minimize | Title bar button, collapse to title-only strip |
| Fullscreen focus | Double-click title bar or shortcut, overlay fullscreen, ESC to exit |
| Cross-worktree move | Drag tile into another worktree container and drop |
| Close | Title bar close button, kills pty process |

### Nested Container Drag Rules

- Drag Terminal tile → moves only that tile
- Drag Worktree title bar → moves entire worktree (with all terminals)
- Drag Project title bar → moves entire project (with all worktrees and terminals)
- Show semi-transparent drop zone highlights on drag

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New terminal in current worktree |
| `Cmd+=` / `Cmd+-` | Canvas zoom in/out |
| `Cmd+0` | Reset canvas zoom |
| `Cmd+F` | Search terminals (filter by title/project) |
| `ESC` | Exit fullscreen focus |
| `Cmd+W` | Close focused terminal |

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop framework | Electron |
| Frontend | React 18 + TypeScript |
| Build tool | Vite |
| State management | Zustand |
| Terminal rendering | xterm.js + @xterm/addon-fit + @xterm/addon-webgl |
| PTY | node-pty |
| Styling | Tailwind CSS |
| Packaging | electron-builder |

Electron + Vite integration via `electron-vite` or `vite-plugin-electron`.

## Project Structure

```
termcanvas/
├── electron/
│   ├── main.ts              # Electron main process entry
│   ├── preload.ts           # Preload script, expose IPC API
│   ├── pty-manager.ts       # node-pty instance management
│   ├── project-scanner.ts   # git repo / worktree scanning
│   └── state-persistence.ts # Layout and scrollback persistence
├── src/
│   ├── App.tsx
│   ├── canvas/
│   │   ├── Canvas.tsx               # Canvas container (transform logic)
│   │   ├── useCanvasInteraction.ts  # Pan/zoom hook
│   │   └── DropZone.tsx             # Drag-and-drop highlight
│   ├── containers/
│   │   ├── ProjectContainer.tsx
│   │   └── WorktreeContainer.tsx
│   ├── terminal/
│   │   ├── TerminalTile.tsx         # Terminal tile component
│   │   ├── TerminalInstance.tsx     # xterm.js wrapper
│   │   └── FullscreenOverlay.tsx
│   ├── toolbar/
│   │   └── Toolbar.tsx
│   ├── stores/
│   │   ├── canvasStore.ts
│   │   ├── projectStore.ts
│   │   └── terminalStore.ts
│   └── types/
│       └── index.ts                 # All type definitions
├── package.json
├── vite.config.ts
├── electron-builder.yml
└── tsconfig.json
```

## Project Addition Flow

1. User clicks "Add Project" in toolbar
2. Native file dialog opens, user selects a git repo directory
3. Main process runs `git worktree list` in that directory
4. Parses output to get all worktrees (paths + branch names)
5. Creates Project node on canvas with Worktree children
6. Each worktree starts with zero terminals, user adds as needed
