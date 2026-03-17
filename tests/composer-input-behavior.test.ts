import test from "node:test";
import assert from "node:assert/strict";

import { shouldSubmitComposerFromKeyEvent } from "../src/components/composerInputBehavior.ts";

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
