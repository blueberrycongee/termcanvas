import test from "node:test";
import assert from "node:assert/strict";

import { isSafeExternalUrl } from "../electron/external-url.ts";

test("isSafeExternalUrl only allows http and https URLs", () => {
  assert.equal(isSafeExternalUrl("https://example.com/path"), true);
  assert.equal(isSafeExternalUrl("http://localhost:3000"), true);
  assert.equal(isSafeExternalUrl("file:///Users/test/.ssh/id_rsa"), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("x-apple.systempreferences:Privacy_Accessibility"), false);
  assert.equal(isSafeExternalUrl("not a url"), false);
});

