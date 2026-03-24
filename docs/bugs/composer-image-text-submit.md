# Composer Image+Text Submit Bug

**Baseline**: `013d740` (2026-03-20)
**File**: `electron/composer-submit.ts`
**Strategy**: aggregate (Claude Code only)

## Bug Summary

When submitting image + text together via the Composer, the image is not
recognized as an image by Claude Code. Two distinct failure modes observed:

### Scenario 3a: Image + text (no newline)

**Steps to reproduce**:
1. Paste an image in the Composer
2. Type text directly (no leading newline)
3. Submit

**Expected**: Claude recognizes the image and receives the text as input.

**Actual**: Claude sees the image file path concatenated with the text as a
single string (e.g., `/path/image.pnghello world`). The image is not
recognized.

**Root cause**: The aggregate strategy sends image paths as a bracketed paste,
then immediately sends text as raw characters with no delay between them:

```
writePtyData(ptyId, buildBracketedPaste(imagePaths), ...)  // paste
writePtyData(ptyId, text, ...)                              // raw chars, immediate
await delayMs(120)
writePtyData(ptyId, "\r", ...)                              // submit
```

The two `writePtyData` calls may be coalesced into a single stdin chunk by the
PTY. Ink's paste handler has a 100ms debounce — raw characters arriving within
this window get concatenated with the paste buffer, so Claude sees
`imagepath + text` as one string instead of processing them separately.

### Scenario 3b: Image + `\n` + text (user workaround)

**Steps to reproduce**:
1. Paste an image in the Composer
2. Type Enter (newline) in the Composer, then type text
3. Submit

**Expected**: Claude recognizes the image and receives the text, submitted in
one action.

**Actual**: The image IS recognized (the `\n` separates the image path from
the text in the paste buffer). However, the user must press submit **twice** —
the first `\r` is interpreted as "add a newline" (multi-line input mode)
rather than "submit".

**Root cause**: The `\n` in the raw character stream triggers Claude Code's
multi-line input mode. In multi-line mode, `\r` (Enter) adds a newline
instead of submitting. The second `\r` from the next Composer submit actually
submits the content.

## Current Code Path (aggregate, image+text)

```typescript
// electron/composer-submit.ts, lines 181-203
if (stagedImagePaths.length > 0) {
  writePtyData(ptyId, buildBracketedPaste(stagedImagePaths.join("\n")), ...);
  if (request.text.trim().length > 0) {
    writePtyData(ptyId, request.text, ...);  // raw chars, NO delay before this
  }
} else if (request.text.trim().length > 0) {
  writePtyData(ptyId, buildBracketedPaste(request.text), ...);
}

if (stagedImagePaths.length > 0 || request.text.trim().length > 0) {
  await deps.delayMs(adapter.pasteDelayMs);   // 120ms, only before \r
}
writePtyData(ptyId, "\r", ...);
```

## Fix Plan

1. **Add delay between image paste and raw text** (fixes 3a): Wait for Ink's
   paste handler (100ms debounce) to finish processing image paths before
   sending raw text characters. This prevents the PTY from coalescing them
   into one stdin chunk.

2. **Trim leading newlines from text before sending as raw chars** (fixes 3b):
   With the delay fix, the `\n` workaround is no longer needed. Stripping
   leading newlines prevents accidentally triggering Claude's multi-line
   input mode from residual Composer textarea formatting.

## Historical Context

The paste/submit timing has been through 11 iterations (see
`docs/composer-submit-timing.md`). All previous delay placements were between
the last content write and `\r` — never between image paste and text. This
fix targets a new position in the sequence.
