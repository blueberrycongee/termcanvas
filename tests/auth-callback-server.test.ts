import test from "node:test";
import assert from "node:assert/strict";

import { startCallbackServer } from "../electron/oauth-callback-server.ts";

test("callback server resolves PKCE code from query param", async () => {
  const { port, resultPromise, close } = await startCallbackServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/callback?code=test-code-123`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Login successful"), "should show success page");

    const result = await resultPromise;
    assert.deepEqual(result, { type: "code", code: "test-code-123" });
  } finally {
    close();
  }
});

test("callback server returns relay HTML when no code param (implicit flow)", async () => {
  const { port, resultPromise, close } = await startCallbackServer();
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
  const { port, resultPromise, close } = await startCallbackServer();
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

    const result = await resultPromise;
    assert.deepEqual(result, { type: "tokens", access_token: "test-access", refresh_token: "test-refresh" });
  } finally {
    close();
  }
});

test("callback server times out after deadline", async () => {
  const { resultPromise, close } = await startCallbackServer(500);
  try {
    const result = await resultPromise;
    assert.equal(result, null, "should resolve null on timeout");
  } finally {
    close();
  }
});
