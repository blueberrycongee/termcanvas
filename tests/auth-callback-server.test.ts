import test from "node:test";
import assert from "node:assert/strict";

import { startCallbackServer } from "../electron/oauth-callback-server.ts";

test("callback server returns HTML page on GET /auth/callback", async () => {
  const { port, tokenPromise, close } = await startCallbackServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/callback`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("location.hash"), "HTML should read location.hash");
    assert.ok(html.includes("/auth/receive"), "HTML should POST to /auth/receive");
  } finally {
    close();
  }
});

test("callback server resolves tokens on POST /auth/receive", async () => {
  const { port, tokenPromise, close } = await startCallbackServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: "test-access",
        refresh_token: "test-refresh",
      }),
    });
    assert.equal(res.status, 200);

    const tokens = await tokenPromise;
    assert.equal(tokens!.access_token, "test-access");
    assert.equal(tokens!.refresh_token, "test-refresh");
  } finally {
    close();
  }
});

test("callback server times out after deadline", async () => {
  const { tokenPromise, close } = await startCallbackServer(500);
  try {
    const tokens = await tokenPromise;
    assert.equal(tokens, null, "should resolve null on timeout");
  } finally {
    close();
  }
});
