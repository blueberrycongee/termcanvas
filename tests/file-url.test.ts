import test from "node:test";
import assert from "node:assert/strict";

import { toFileUrl } from "../electron/file-url.ts";

test("toFileUrl creates a valid Windows file URL", () => {
  if (process.platform !== "win32") return;

  assert.equal(
    toFileUrl("C:\\Users\\foo\\file.txt"),
    "file:///C:/Users/foo/file.txt",
  );
});
