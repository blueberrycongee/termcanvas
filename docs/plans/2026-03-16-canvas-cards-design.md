# Canvas Cards & Terminal Enhancement Design

## Goal

Extend termcanvas beyond a terminal-only canvas into a developer workspace canvas. Add BrowserCard, lazygit integration, and terminal image protocol support. These features differentiate termcanvas from native terminals like Ghostty — Electron's browser engine becomes a strength, not a limitation.

## New Features (in priority order)

### 1. Enable WebGL Addon

Load `@xterm/addon-webgl` (already in package.json, unused) for GPU-accelerated terminal rendering.

- Two lines of code: import + `xterm.loadAddon(new WebglAddon())`
- Fallback to Canvas 2D if WebGL context creation fails (important for many-terminal scenarios where contexts are exhausted)

### 2. BrowserCard

Embeddable browser on the canvas using Electron's `<webview>` tag.

**Creation triggers:**
- Toolbar button "Add Browser"
- CLI command `termcanvas browser open --url <url>`
- Future: auto-detect `localhost:*` URLs in terminal output

**UI structure:**
- Header: URL bar (editable input), navigation buttons (back/forward/refresh), close button
- Body: `<webview>` element filling the card
- Footer: optional loading indicator

**Behavior:**
- Draggable, resizable (reuses existing card patterns)
- Always pinned (like FileCard — no hover auto-hide)
- Not anchored to any worktree (standalone card on canvas)
- Supports standard web features: JS, CSS, forms, auth
- Navigation within webview (clicking links stays inside the card)

**State:**
- Stored in a new `browserCardStore` (Zustand)
- Fields: `id`, `url`, `x`, `y`, `w`, `h`
- Persisted in workspace save/restore

**Security:**
- `<webview>` runs in separate process (Electron's default isolation)
- No `nodeIntegration` in webview
- Partition webview sessions to prevent credential leakage between cards

### 3. lazygit Terminal Type

Add `lazygit` as a new terminal type alongside `shell`, `claude`, `codex`, etc.

**Implementation:**
- Add `lazygit` to `CLI_CONFIG` in TerminalTile.tsx
- Shell command: `lazygit` launched in worktree directory
- No resume args (lazygit doesn't support session resume)
- Add "Git" button to worktree header in sidebar

**Behavior:**
- Opens as a regular TerminalTile within the worktree grid
- When lazygit exits, terminal tile closes (or offers to reopen)
- Git operations in lazygit trigger existing `git-watcher`, which auto-refreshes DiffCard

### 4. Terminal Image Protocol (xterm-addon-image)

Add sixel image protocol support to terminal tiles.

**Implementation:**
- Install `@xterm/addon-image`
- Load addon alongside WebGL addon in TerminalTile
- Configure: `sixelSupport: true`, reasonable `sixelScrolling` settings

**Use cases:**
- `chafa`, `viu`, `imgcat` display images inline
- `matplotlib` with sixel backend shows plots in terminal
- Aligns with Ghostty's image display capability

## Architecture Notes

### Card System

BrowserCard follows the established card pattern:
- Portal to `#canvas-layer`
- Register in `cardLayoutStore` for collision avoidance
- Drag/resize with viewport scale compensation
- Close via X button or `termcanvas:close-card` event (batch delete support)

Unlike DiffCard/FileTreeCard, BrowserCard is **not anchored to a worktree**. It's a free-floating canvas item. This is a new pattern — the first card type that exists independently of the project/worktree hierarchy.

### State Storage

```
browserCardStore {
  cards: Record<string, BrowserCardData>
  addCard(url: string, position?: {x, y}): string
  removeCard(id: string): void
  updateCard(id: string, patch: Partial<BrowserCardData>): void
}

BrowserCardData {
  id: string
  url: string
  x: number
  y: number
  w: number  // default 800
  h: number  // default 600
}
```

### What We're NOT Doing

- No ImageCard — FileCard already displays images, and terminal image protocol covers inline display
- No custom terminal renderer / WebGPU work — xterm.js WebGL is sufficient for now
- No Ghostty integration — architecturally incompatible, and the card system gives us capabilities Ghostty can't match
- No tmux control mode — interesting idea for the future, but out of scope
