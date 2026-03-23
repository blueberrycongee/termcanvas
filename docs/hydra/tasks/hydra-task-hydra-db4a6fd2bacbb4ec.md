# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

## Background

We are building TermCanvas, a terminal canvas app that has a Composer component for sending text+images to AI CLI tools (Claude Code, Codex, etc.) running in embedded terminals.

## The Problem

When sending an image + text together from the Composer to Claude Code, the image path and text get concatenated into one string (e.g. `image-1.png你好`) instead of being recognized separately.

## Root Cause (Reverse-Engineered)

Claude Code's Ink-based React hook `KKq` (usePasteHandler) has a **100ms debounce aggregation** layer:

1. Each bracketed paste event's text is pushed into a `chunks[]` array
2. A 100ms timeout is set/reset on each new chunk
3. When the timeout fires, all chunks are joined: `chunks.join("")`
4. The joined string is then split by `/ (?=\/|[A-Za-z]:\\)/` (space + path start) or `\n` (newline)
5. Parts matching `/\.(png|jpe?g|gif|webp)$/i` are treated as images, the rest as text

This means:
- Two separate paste writes arriving <100ms apart → joined into one string → can't split → broken
- Two separate paste writes with >100ms delay → first one's timer fires independently → works BUT causes a React state race that can drop the second paste

## Proposed Solution

Send image paths and text in a **single bracketed paste**, separated by `\n`:

```
\x1b[200~/path/to/image-1.png\nhello text\x1b[201~
```

Claude Code's own splitting logic would then:
1. Single paste → `chunks = ["/path/image-1.png\nhello text"]`
2. join → `"/path/image-1.png\nhello text"`
3. Split by newline → `["/path/image-1.png", "hello text"]`
4. `Hf1("/path/image-1.png")` → true → image
5. `"hello text"` → false → plain text

Benefits: single write, no delay, no race condition, leverages Claude Code's existing parsing.

## Additional Context

- Codex CLI (Rust + crossterm) does NOT have this problem because each paste event is processed independently without an aggregation layer
- The current code is in `/Users/zzzz/termcanvas/electron/composer-submit.ts`
- Tests are in `/Users/zzzz/termcanvas/tests/composer-submit.test.ts`
- Terminal configs are in `/Users/zzzz/termcanvas/src/terminal/cliConfig.ts`

## Your Task

1. **Critically review this proposed solution.** Consider:
   - Edge cases: What if text itself contains newlines? What if there are multiple images? What about paths with spaces?
   - Does the splitting regex `/ (?=\/|[A-Za-z]:\\)/` interact with newline splitting in unexpected ways?
   - Could this break Codex or other CLIs that DON'T have this aggregation layer?
   - Is there a better approach we haven't considered?

2. **Independently verify** the reverse-engineering findings if you want. Claude Code is at `~/.nvm/versions/node/v24.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js`. You can search for relevant functions like the paste handler, the 100ms debounce, the splitting logic, etc. Feel free to explore the actual source to confirm or challenge our findings.

3. **Consider Codex compatibility.** The current approach works fine for Codex. Would the newline-separator approach also work with Codex's crossterm-based paste handler? Check Codex source if needed.

4. **Propose alternatives** if you think there's a better fundamental solution. Don't feel constrained by our proposed approach - if you find something better during your exploration, share it.

Be direct and critical. We want honest assessment, not agreement.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-db4a6fd2bacbb4ec.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
