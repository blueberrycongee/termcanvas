# Hydra Task Result: Composer Submit Bracketed Paste Analysis

## Files Changed

None — this is a review/audit task.

## Analysis

### 1. Is appending `\r` to the final write() correct and safe?

**Yes, this is correct and strictly better than the old approach.**

The old approach (`write(paste)` → delay → `write(\r)`) had a fundamental race: the delay was a guess, and the `\r` arrived as a separate PTY write. If the CLI's TUI hadn't finished processing the paste content by the time `\r` arrived, it got swallowed as a literal newline inside the input box.

The new approach (`write(paste + \r)`) eliminates the race by construction. A single `write()` syscall produces contiguous bytes in the kernel's tty input queue. The CLI's `read()` will return the paste-end marker `\x1b[201~` and `\r` in the same chunk (assuming the payload fits in the tty buffer — see point 2). The CLI processes both in the same event-loop tick: it exits paste mode, then immediately sees `\r` as a submit keypress.

There is no terminal protocol issue here. `\r` is not part of the bracketed paste sequence — it follows *after* the `\x1b[201~` end marker. Any correctly implemented bracketed paste handler will first process the end marker, return to normal input mode, and then interpret `\r` as Enter.

### 2. PTY buffer splitting risk

**Low risk for file paths, moderate risk for large text prompts.**

macOS tty input queue (`MAX_INPUT`) is typically 1024 bytes. POSIX `PIPE_BUF` on macOS is 512 bytes, though this applies to pipes, not PTYs directly. In practice, the PTY master `write()` feeds into the kernel's tty line discipline, and the slave side's `read()` drains whatever is available in the input queue.

Payload size analysis:
- Bracketed paste overhead: 13 bytes (`\x1b[200~` + `\x1b[201~` + `\r`)
- Single file path: ~60-200 bytes → total ~73-213 bytes. **No risk.**
- Text prompt under ~1000 chars: total ~1013 bytes. **Borderline but likely safe.**
- Text prompt 2-4 KB: **Real risk of kernel splitting the write into multiple `read()` chunks.**

However, even if the kernel splits the data, the situation is still better than the old separate-write approach:

1. **Split within paste content** (e.g., `\x1b[200~some text...` | `...rest\x1b[201~\r`): The CLI stays in paste-accumulation mode across both reads, then processes end-marker + `\r` together. **Works fine.**

2. **Split between `\x1b[201~` and `\r`** (worst case): The CLI gets paste-end in one read, `\r` in the next. BUT both are available immediately in the kernel buffer — no I/O wait. Node.js's libuv read loop will drain both chunks before yielding to the event loop, so they're processed in the same tick. **Very likely works**, though technically depends on the CLI's stdin read implementation.

3. **Split inside `\x1b[201~`** (e.g., `\x1b[2` | `01~\r`): This requires the ANSI parser to handle partial escape sequences across reads. Ink (Claude Code's framework) and most mature terminal parsers do handle this with state machines. **Should work.**

**Bottom line**: For the typical payloads in your use case (file paths 60-200 bytes, text prompts typically under 1KB), the single-write approach is safe. For very large text prompts (>1KB), there's a theoretical risk, but it's still far more reliable than the old delay-based approach because even split chunks are immediately available in the buffer.

### 3. Do any CLIs break when `\r` immediately follows `\x1b[201~`?

**No known CLIs break on this.**

The bracketed paste protocol (defined in xterm's documentation) is clear: `\x1b[201~` terminates the paste, and any subsequent bytes are normal input. There is no required delimiter or gap between the end marker and subsequent input.

For Claude Code specifically:
- Uses Ink's `useInput` + `useStdin` hooks
- Ink's stdin handler processes raw bytes through an ANSI parser
- The parser identifies `\x1b[201~` as the paste-end sequence and switches out of paste mode
- `\r` is then processed as a normal keypress → triggers submit
- This is exactly what happens when a user pastes text and immediately hits Enter in a normal terminal emulator — same byte sequence

For Codex CLI, Gemini CLI, Kimi, OpenCode: all use similar TUI frameworks with bracketed paste support. None would break on this.

### 4. Multiple images timing

Current flow for 2 images + text:
```
write('\x1b[200~/path/image-1.png\x1b[201~')  // ~73 bytes
  delay(120ms)
write('\x1b[200~/path/image-2.png\x1b[201~')  // ~73 bytes
  delay(120ms)
write('\x1b[200~prompt text\x1b[201~\r')       // final, with \r
```

**This is fine.** Two observations:

1. The 120ms inter-paste delay is adequate. Each image paste is a small payload (~73 bytes). The CLI needs microseconds to process the ANSI sequence and insert the path text into its input buffer. 120ms is generous — even 10ms would probably work. No timing issue here.

2. The `\r` is correctly attached only to the final paste. The intermediate image pastes insert paths into the input box; the final paste inserts the prompt text and submits. Each paste event correctly adds content to the input buffer before submission.

**One subtle concern**: The behavior depends on how each CLI handles multiple consecutive bracketed paste events. Claude Code appends each paste to the input buffer at the cursor position. Multiple pastes result in concatenated content, typically newline-separated (since each paste event ends and a new one begins). This is the expected behavior.

If a CLI were to *replace* the input buffer on each paste (rather than append), the earlier image paths would be lost. But no known CLI does this — bracketed paste insertion at cursor position is universal.

### 5. Alternative approaches

**The current approach is the right one. I don't recommend changes.**

Alternatives considered:

a) **Single concatenated paste** — combine all image paths + text into one paste:
   ```
   \x1b[200~/path/image-1.png\n/path/image-2.png\nprompt\x1b[201~\r
   ```
   This eliminates inter-paste delays entirely. However, it changes the semantics: the CLI would see one paste event with newlines in it, rather than multiple discrete paste events. Whether this works depends on how each CLI formats multi-line paste content. The current multi-paste approach is safer because each path is a discrete paste event that the CLI processes independently.

b) **Drain-based flow control** — read PTY output after each write to confirm the CLI processed it before sending the next payload. Too complex, too fragile (you'd need to parse CLI-specific output to detect readiness), and totally unnecessary for payloads this small.

c) **Write coalescing with a single buffer** — for the multi-image case, you could coalesce all writes into a single large buffer:
   ```
   \x1b[200~path1\x1b[201~\x1b[200~path2\x1b[201~\x1b[200~text\x1b[201~\r
   ```
   This is technically valid but untested — CLIs might not handle back-to-back paste sequences without any inter-sequence gap. The 120ms delay is cheap insurance. Not worth the risk.

**Verdict**: The current implementation is sound. The single-write `paste+\r` fix correctly eliminates the race condition. The multi-image flow with 120ms delays is pragmatic and reliable. No changes recommended.

## Issues Found

No bugs or correctness issues found in the current implementation. The change from separate `write()` calls to appended `\r` is a correct fix for the race condition described.

One observation (not a bug): if users routinely send text prompts larger than ~1KB, you may eventually see the old race condition resurface due to kernel buffer splitting. If that happens, the mitigation would be to chunk large payloads into ~512-byte writes with explicit flow control, or to use a protocol-level acknowledgment. But this is a theoretical concern — for current usage patterns it's not actionable.

## Tests

Tests were reviewed (not modified). The existing test suite in `tests/composer-submit.test.ts` correctly validates:
- Single paste with `\r` appended (`codex` and `claude` text-only tests)
- Multi-paste with `\r` on final paste only (image + text tests)
- Direct text mode for `shell` type
- Error handling for unsupported images and PTY write failures
