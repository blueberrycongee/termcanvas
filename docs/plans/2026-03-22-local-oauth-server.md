# Local HTTP Server OAuth Callback — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace unreliable `termcanvas://` custom protocol callback with a local HTTP server that reliably receives OAuth tokens on all platforms.

**Architecture:** `login()` spins up a temporary HTTP server on `127.0.0.1:17249`. Supabase redirects the browser there after OAuth. The server returns an HTML page whose JS reads the URL fragment (`#access_token=...`) and POSTs the tokens back to the server. The server calls `handleAuthCallback` logic, then shuts down.

**Tech Stack:** Node.js `http` module (already available in Electron main process), no new dependencies.

---

### Task 1: Revert debug code in main.ts

Remove the temporary `fs.writeFileSync` debug line added during investigation.

**Files:**
- Modify: `electron/main.ts:1047-1048`

**Step 1: Remove the debug line**

Change:
```typescript
  app.on("open-url", async (event, url) => {
    event.preventDefault();
    // DEBUG: write received URL to file for diagnosis
    fs.writeFileSync(path.join(TERMCANVAS_DIR, "open-url-debug.txt"), `${new Date().toISOString()}\n${url}\n`, "utf-8");
    if (url.startsWith("termcanvas://auth/callback")) {
```

To:
```typescript
  app.on("open-url", async (event, url) => {
    event.preventDefault();
    if (url.startsWith("termcanvas://auth/callback")) {
```

**Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "chore: remove open-url debug logging"
```

---

### Task 2: Add local OAuth callback server to auth.ts

**Files:**
- Modify: `electron/auth.ts` — add `startCallbackServer()` function, update `login()`

**Step 1: Write the failing test**

Create `tests/auth-callback-server.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

// We test the HTML relay page logic: given a fragment, it should POST tokens
// to the server's /auth/receive endpoint. We simulate this by:
// 1. Starting the callback server
// 2. Sending a GET to /auth/callback (simulates browser landing)
// 3. Verifying the HTML response contains the fragment-relay JS
// 4. Sending a POST to /auth/receive with tokens
// 5. Verifying the server resolves with the tokens

// Import the server function (will be created in Step 3)
import { startCallbackServer } from "../electron/auth.ts";

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
    assert.equal(tokens.access_token, "test-access");
    assert.equal(tokens.refresh_token, "test-refresh");
  } finally {
    close();
  }
});

test("callback server times out after deadline", async () => {
  const { tokenPromise, close } = await startCallbackServer(500); // 500ms timeout
  try {
    const tokens = await tokenPromise;
    assert.equal(tokens, null, "should resolve null on timeout");
  } finally {
    close();
  }
});
```

**Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/auth-callback-server.test.ts
```

Expected: FAIL — `startCallbackServer` does not exist yet.

**Step 3: Implement `startCallbackServer`**

In `electron/auth.ts`, add before the `login()` function:

```typescript
import http from "http";

const OAUTH_CALLBACK_PORT = 17249;
const OAUTH_CALLBACK_TIMEOUT = 30_000;

interface CallbackTokens {
  access_token: string;
  refresh_token: string;
}

const CALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<p>Completing login...</p>
<script>
(function() {
  var h = location.hash.substring(1);
  if (!h) { document.body.textContent = 'No tokens received.'; return; }
  var params = new URLSearchParams(h);
  var data = {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token')
  };
  if (!data.access_token || !data.refresh_token) {
    document.body.textContent = 'Missing tokens.';
    return;
  }
  fetch('/auth/receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function() {
    document.body.textContent = 'Login successful! You can close this tab.';
  }).catch(function() {
    document.body.textContent = 'Login failed.';
  });
})();
</script>
</body></html>`;

export function startCallbackServer(
  timeoutMs: number = OAUTH_CALLBACK_TIMEOUT,
): Promise<{ port: number; tokenPromise: Promise<CallbackTokens | null>; close: () => void }> {
  return new Promise((resolveSetup) => {
    let settled = false;
    let resolveTokens: (v: CallbackTokens | null) => void;
    const tokenPromise = new Promise<CallbackTokens | null>((r) => { resolveTokens = r; });

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url?.startsWith("/auth/callback")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CALLBACK_HTML);
        return;
      }

      if (req.method === "POST" && req.url === "/auth/receive") {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
          try {
            const tokens = JSON.parse(body) as CallbackTokens;
            if (!settled) {
              settled = true;
              resolveTokens(tokens);
            }
          } catch { /* ignore parse errors */ }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolveTokens(null);
      }
    }, timeoutMs);

    const close = () => {
      clearTimeout(timeout);
      server.close();
    };

    server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : OAUTH_CALLBACK_PORT;
      resolveSetup({ port, tokenPromise, close });
    });
  });
}
```

**Step 4: Run test to verify it passes**

```bash
node --experimental-strip-types --test tests/auth-callback-server.test.ts
```

Expected: all 3 tests PASS.

**Step 5: Commit**

```bash
git add electron/auth.ts tests/auth-callback-server.test.ts
git commit -m "feat(auth): add local HTTP callback server for OAuth token relay"
```

---

### Task 3: Update `login()` to use local server

**Files:**
- Modify: `electron/auth.ts` — rewrite `login()` to start local server, set `redirectTo` to local URL

**Step 1: Rewrite `login()`**

Replace the current `login()` function:

```typescript
export async function login(): Promise<LoginResult> {
  if (!supabase) {
    console.warn("[Auth] Supabase not configured, cannot login");
    return { ok: false, error: "Auth not configured" };
  }

  try {
    // Start local HTTP server to receive OAuth callback
    const { port, tokenPromise, close } = await startCallbackServer();
    const redirectTo = `http://127.0.0.1:${port}/auth/callback`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      close();
      console.error("[Auth] OAuth error:", error.message);
      return { ok: false, error: error.message };
    }

    if (!data.url) {
      close();
      return { ok: false, error: "Failed to get OAuth URL" };
    }

    // Open browser — don't await the token here, let it resolve in background
    try {
      await shell.openExternal(data.url);
    } catch (err) {
      close();
      console.error("[Auth] Failed to open browser:", err);
      return { ok: false, url: data.url, error: "Failed to open browser" };
    }

    // Wait for tokens in background, process when received
    tokenPromise.then(async (tokens) => {
      close();
      if (!tokens) {
        console.warn("[Auth] OAuth callback timed out");
        return;
      }
      // Reuse existing handleAuthCallback logic by constructing a URL
      const fakeUrl = `http://localhost/auth/callback#access_token=${encodeURIComponent(tokens.access_token)}&refresh_token=${encodeURIComponent(tokens.refresh_token)}`;
      await handleAuthCallback(fakeUrl);
    }).catch((err) => {
      close();
      console.error("[Auth] Callback error:", err);
    });

    return { ok: true };
  } catch (err) {
    console.error("[Auth] Login failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

**Step 2: Run existing tests**

```bash
node --experimental-strip-types --test tests/auth-callback-server.test.ts tests/auth-store.test.ts
```

Expected: all PASS.

**Step 3: Commit**

```bash
git add electron/auth.ts
git commit -m "feat(auth): use local HTTP server for OAuth callback instead of custom protocol"
```

---

### Task 4: Update Supabase redirect URLs

**Files:**
- Modify: `supabase/config.toml:152` — add local server URL to redirect list

**Step 1: Add the local server URL to config**

In `supabase/config.toml`, change:

```toml
additional_redirect_urls = ["https://127.0.0.1:3000", "termcanvas://auth/callback"]
```

To:

```toml
additional_redirect_urls = ["https://127.0.0.1:3000", "termcanvas://auth/callback", "http://127.0.0.1:17249/auth/callback"]
```

**Step 2: Manual action — Supabase Dashboard**

In the Supabase Dashboard (https://supabase.com/dashboard) → Authentication → URL Configuration → Redirect URLs, add:

```
http://127.0.0.1:17249/auth/callback
```

**Step 3: Commit**

```bash
git add supabase/config.toml
git commit -m "feat(auth): add local OAuth server URL to Supabase redirect allow-list"
```

---

### Task 5: Verify all tests pass

**Step 1: Run full test suite**

```bash
npm test
```

Expected: all existing tests PASS, no regressions.

**Step 2: Run auth-specific tests**

```bash
node --experimental-strip-types --test tests/auth-callback-server.test.ts tests/auth-store.test.ts
```

Expected: all PASS.

---

## Notes

- The `open-url` handler and `second-instance` handler in `main.ts` remain as fallbacks for Windows/Linux and any edge cases where the custom protocol does work.
- The `termcanvas://` protocol registration in `electron-builder.yml` and `main.ts` stays — no removal needed.
- After implementation, the user must add `http://127.0.0.1:17249/auth/callback` to the Supabase Dashboard redirect URLs manually.
