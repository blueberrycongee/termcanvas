# Terminal Auto-Summary Design

## Scope

Add AI-generated one-line summaries for CLI terminals that have session logs (claude, codex, etc.). Shell, lazygit, tmux terminals are excluded.

## Mechanism

Spawn a short-lived CLI process (Claude or Codex, user-configurable) in the background. Feed it recent session JSONL log content with a prompt requesting a one-line summary. Write the result into `TerminalData.customTitle`. Kill the process after receiving the response.

The CLI process is purely background — no terminal tile is created on the canvas.

## Trigger Paths

### On-demand
User explicitly requests a summary (UI entry point TBD).

### Automatic
Fires when ALL of the following conditions are met:
- Terminal is not focused
- Terminal has been idle for a period (no new output)
- Terminal is not destroyed
- No `customTitle` exists, OR enough new conversation turns have accumulated since the last summary

## Output

One sentence written to `TerminalData.customTitle`. Persisted via snapshot. All existing UI surfaces (tile header, StashBox card, Hub list) display it automatically with zero additional work.

## Data Source

Session JSONL log files on disk. Only the most recent portion is fed to the summarizer (not the full history).

## Settings (preferencesStore)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `summaryEnabled` | `boolean` | `false` | Master on/off toggle |
| `summaryCli` | `"claude" \| "codex"` | `"claude"` | Which CLI to use for summarization |

## What This Does NOT Do

- Does not fork the running CLI's internal agent
- Does not call the Anthropic API directly
- Does not add new stores, fields, or UI components
- Does not summarize non-CLI terminals (shell, lazygit, tmux)
