Files changed and why
- `.hydra-result-hydra-db4a6fd2bacbb4ec.md`: recorded the review findings, verification evidence, and test status required by the task.

Issues found
- High: the proposed `single bracketed paste` with `image-path + "\n" + text` is not cross-CLI safe.
  - Claude Code: the reverse-engineered behavior is substantially correct. In `~/.nvm/versions/node/v24.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js`, `KKq` batches pasted chunks with a 100ms timer (`SbY=100`), joins them with `V.join("")`, then splits by ` / (?=\/|[A-Za-z]:\\)/` and newline before testing `\.(png|jpe?g|gif|webp)$`. That means a single paste containing `path\ntext` should parse correctly in Claude.
  - Codex: the same payload does not behave the same way. I ran a live Codex TUI session and sent `\x1b[200~/tmp/tc-valid-image.png\nhello from tc\x1b[201~`. Codex rendered literal multi-line text in the composer instead of attaching the image. As a control, sending `\x1b[200~/tmp/tc-valid-image.png\x1b[201~` immediately produced `[Image #1]`, and `~/.codex/log/codex-tui.log` recorded `codex_tui::bottom_pane::chat_composer: OK: /tmp/tc-valid-image.png`.
  - Conclusion: adopting the newline-separated single-paste format globally would fix Claude while breaking Codex.

- Medium: the proposed format is also semantically lossy for some Claude inputs.
  - If user text intentionally begins with a file path on its own line and ends in an image extension, Claude will classify that line as an image path, not text.
  - Multiple images plus text can work if each item is on its own line, but only if every image path is on a separate line and the text is allowed to stay multi-line after Claude rejoins the non-image parts with newline.
  - Paths with spaces are fine in the newline-separated format because Claude’s parser splits on newline first and only uses the `space + path-start` regex within a line. A path like `/tmp/My File.png` remains intact.
  - Text containing newlines is mostly fine for Claude, but it means every text line is independently exposed to the image-path detector. A text line that looks like `/tmp/foo.png` will be promoted into an image attachment.

- Medium: the current tests do not prove the behavior that matters.
  - `tests/composer-submit.test.ts` only asserts PTY write sequences. It does not model Claude’s 100ms aggregation or Codex’s image-path parsing.
  - The current test suite passes, but it would not catch the Codex regression introduced by the proposed newline approach.

Assessment
- I would not ship the newline-separated single-paste format as a universal change.
- I would only consider it as a Claude-specific adapter behavior, and even then only after explicitly accepting the text-line ambiguity above.
- The current cross-CLI adapter model already varies behavior per terminal type in `src/terminal/cliConfig.ts`, so a terminal-specific strategy is consistent with the codebase.

Better alternatives
- Best practical option: make paste framing terminal-specific.
  - Keep Codex on the current `separate bracketed pastes` behavior, because live verification shows it correctly recognizes a path-only paste as an image.
  - Change Claude to a single bracketed paste only when there is at least one image and some text, using newline separators between image paths and text blocks.

- Better long-term option: support richer per-terminal submit strategies instead of a single generic bracketed-paste path.
  - Example: a Claude strategy that emits one aggregate payload, and a Codex strategy that emits one paste per semantic item.
  - This avoids baking Claude-specific parsing assumptions into behavior for other CLIs.

- Not recommended: trying to beat Claude’s debounce with inter-paste delays.
  - You already identified the failure mode correctly. Delays above 100ms avoid chunk coalescing but reintroduce timing races around React state and submission ordering.

- Possibly worth exploring, but unverified: Claude-specific synthetic key/input flow that mirrors its native image-paste command path instead of relying on path heuristics.
  - I did not find evidence in the installed Claude bundle that TermCanvas can trigger a safer dedicated attachment path through PTY input alone.
  - Without a documented or observed terminal protocol for attachments, this is speculative.

Verification performed
- Read current implementation:
  - `electron/composer-submit.ts`
  - `tests/composer-submit.test.ts`
  - `src/terminal/cliConfig.ts`
- Verified Claude bundled behavior from:
  - `~/.nvm/versions/node/v24.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js`
- Empirically tested Codex 0.116.0 in a live TUI session:
  - `path + newline + text` in one bracketed paste => plain multi-line text
  - `path` alone in one bracketed paste => `[Image #1]` attachment and `OK:` log entry
- Ran tests:
  - `node --experimental-strip-types --test tests/composer-submit.test.ts`
  - Result: pass (10/10)

Whether tests pass
- Yes. `tests/composer-submit.test.ts` passes as-is.

Unresolved problems
- I did not perform a live Claude TUI submission test; the Claude conclusion is source-based rather than end-to-end empirical.
- I do not have source-level Rust code for Codex’s exact parser path in this environment, only binary strings, logs, and live behavior.
- If you choose a Claude-specific aggregate-paste strategy, you still need targeted regression tests or an adapter-level harness that simulates per-CLI parsing expectations.
