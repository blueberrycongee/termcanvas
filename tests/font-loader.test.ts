import test from "node:test";
import assert from "node:assert/strict";

import { toFontFileUrl } from "../src/terminal/fontLoader.ts";

test("toFontFileUrl creates a valid Windows file URL", () => {
  assert.equal(
    toFontFileUrl("C:\\Users\\foo\\AppData\\Roaming\\termcanvas\\fonts\\JetBrains Mono.ttf"),
    "file:///C:/Users/foo/AppData/Roaming/termcanvas/fonts/JetBrains%20Mono.ttf",
  );
});

test("toFontFileUrl creates a valid POSIX file URL", () => {
  assert.equal(
    toFontFileUrl("/Users/foo/Library/Application Support/termcanvas/fonts/JetBrains Mono.ttf"),
    "file:///Users/foo/Library/Application%20Support/termcanvas/fonts/JetBrains%20Mono.ttf",
  );
});
