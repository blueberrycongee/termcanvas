import test from "node:test";
import assert from "node:assert/strict";

import { getHookSocketPath } from "../electron/hook-receiver.ts";

test("getHookSocketPath uses a Windows named pipe on win32", () => {
  assert.equal(
    getHookSocketPath("win32", 4321, "C:\\Temp"),
    "\\\\.\\pipe\\termcanvas-4321",
  );
});

test("getHookSocketPath uses a unix socket path on non-Windows platforms", () => {
  assert.equal(
    getHookSocketPath("linux", 4321, "/tmp"),
    "/tmp/termcanvas-4321.sock",
  );
});
