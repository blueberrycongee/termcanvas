import test from "node:test";
import assert from "node:assert/strict";

test("shellEscapePath escapes spaces", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/path/to/my file.ts"), "/path/to/my\\ file.ts");
});

test("shellEscapePath escapes parentheses", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/path/to/file (1).ts"), "/path/to/file\\ \\(1\\).ts");
});

test("shellEscapePath escapes multiple special characters", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(
    shellEscapePath("/tmp/it's a $HOME/test&file"),
    "/tmp/it\\'s\\ a\\ \\$HOME/test\\&file",
  );
});

test("shellEscapePath returns plain path unchanged", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/Users/foo/bar.ts"), "/Users/foo/bar.ts");
});

test("shellEscapePath escapes backslashes", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/path/with\\backslash"), "/path/with\\\\backslash");
});
