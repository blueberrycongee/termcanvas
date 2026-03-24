import test from "node:test";
import assert from "node:assert/strict";

import { getSerializableBuffer } from "../src/terminal/scrollbackBuffer.ts";

test("serializable buffer uses the active buffer when the normal screen is active", () => {
  const normal = { length: 10 };
  const alternate = { length: 5 };

  const result = getSerializableBuffer({
    active: normal,
    normal,
    alternate,
  });

  assert.equal(result, normal);
});

test("serializable buffer prefers normal scrollback while an alternate screen is active", () => {
  const normal = { length: 12 };
  const alternate = { length: 20 };

  const result = getSerializableBuffer({
    active: alternate,
    normal,
    alternate,
  });

  assert.equal(result, normal);
});

test("serializable buffer falls back to the alternate screen when no normal scrollback exists", () => {
  const normal = { length: 0 };
  const alternate = { length: 6 };

  const result = getSerializableBuffer({
    active: alternate,
    normal,
    alternate,
  });

  assert.equal(result, alternate);
});
