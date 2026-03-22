import test from "node:test";
import assert from "node:assert/strict";

import {
  getComposerPassthroughSequence,
  shouldSubmitComposerFromKeyEvent,
} from "../src/components/composerInputBehavior.ts";

test("Enter submits the composer", () => {
  assert.equal(
    shouldSubmitComposerFromKeyEvent({
      key: "Enter",
      shiftKey: false,
    }),
    true,
  );
});

test("Shift+Enter keeps multiline input", () => {
  assert.equal(
    shouldSubmitComposerFromKeyEvent({
      key: "Enter",
      shiftKey: true,
    }),
    false,
  );
});

test("Composing text with an IME does not submit on Enter", () => {
  assert.equal(
    shouldSubmitComposerFromKeyEvent({
      key: "Enter",
      shiftKey: false,
      nativeEvent: {
        isComposing: true,
      },
    }),
    false,
  );
});

test("Windows Ctrl+Arrow forwards to terminal even with draft text", () => {
  assert.equal(
    getComposerPassthroughSequence(
      {
        key: "ArrowUp",
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
      },
      "hello",
      false,
      "win32",
    ),
    "\x1b[A",
  );
});

test("Windows plain Arrow stays in composer when draft has text", () => {
  assert.equal(
    getComposerPassthroughSequence(
      {
        key: "ArrowUp",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      },
      "hello",
      false,
      "win32",
    ),
    null,
  );
});
