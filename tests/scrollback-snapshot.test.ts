import test from "node:test";
import assert from "node:assert/strict";

import { serializeBufferToText } from "../src/terminal/scrollbackSnapshot.ts";

function line(text: string, isWrapped = false) {
  return {
    isWrapped,
    translateToString(trimRight?: boolean) {
      return trimRight ? text.replace(/\s+$/u, "") : text;
    },
  };
}

test("serializeBufferToText merges wrapped lines into a single logical line", () => {
  const lines = [
    line("hello ", true),
    line("world"),
    line("tail"),
  ];

  const buffer = {
    length: lines.length,
    getLine(y: number) {
      return lines[y];
    },
  };

  assert.equal(serializeBufferToText(buffer), "helloworld\r\ntail");
});

test("serializeBufferToText trims trailing empty rows from the viewport", () => {
  const lines = [
    line("first"),
    line(""),
    line(""),
  ];

  const buffer = {
    length: lines.length,
    getLine(y: number) {
      return lines[y];
    },
  };

  assert.equal(serializeBufferToText(buffer), "first");
});
