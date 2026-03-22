import test from "node:test";
import assert from "node:assert/strict";

import {
  addWindowsPathEntry,
  hasWindowsPathEntry,
  removeWindowsPathEntry,
} from "../electron/windows-cli-path.ts";

test("hasWindowsPathEntry ignores case and slash style", () => {
  assert.equal(
    hasWindowsPathEntry(
      "C:\\Windows\\System32;C:\\Users\\Foo\\AppData\\Local\\termcanvas\\bin",
      "c:/users/foo/appdata/local/termcanvas/bin/",
    ),
    true,
  );
});

test("addWindowsPathEntry appends missing entries once", () => {
  assert.equal(
    addWindowsPathEntry("C:\\Windows\\System32", "C:\\termcanvas\\bin"),
    "C:\\Windows\\System32;C:\\termcanvas\\bin",
  );
  assert.equal(
    addWindowsPathEntry(
      "C:\\Windows\\System32;C:\\termcanvas\\bin",
      "c:/termcanvas/bin/",
    ),
    "C:\\Windows\\System32;C:\\termcanvas\\bin",
  );
});

test("removeWindowsPathEntry removes only the target entry", () => {
  assert.equal(
    removeWindowsPathEntry(
      "C:\\Windows\\System32;C:\\termcanvas\\bin;C:\\Other",
      "c:/termcanvas/bin",
    ),
    "C:\\Windows\\System32;C:\\Other",
  );
});
