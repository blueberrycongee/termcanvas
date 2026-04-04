import http from "http";

export type CallbackResult =
  | { type: "success"; code: string }
  | { type: "error"; error: string; description: string }
  | { type: "timeout" };

const OAUTH_CALLBACK_TIMEOUT = 120_000; // 2 minutes — first-time OAuth flows can be slow
const CALLBACK_PORT = 8914;

/**
 * HTML page served at the callback URL.
 *
 * Supabase may deliver the OAuth result in two ways:
 * 1. Query params: ?code=xxx (success) or ?error=xxx&error_description=yyy (failure)
 * 2. Hash fragment: #access_token=xxx (success) or #error=xxx (failure)
 *
 * For the PKCE flow, Supabase redirects with ?code=xxx as a query param,
 * which the server handles directly. But some error scenarios put info in
 * the hash fragment, which the server can't see — so the HTML page reads
 * the fragment and POSTs it back to /relay.
 */
const RELAY_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>TermCanvas Login</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh;
         margin: 0; background: #0d1117; color: #c9d1d9; }
  .card { text-align: center; padding: 2rem; }
  .error { color: #f85149; }
  .success { color: #3fb950; }
  h2 { margin-bottom: 0.5rem; }
  p { color: #8b949e; margin-top: 0.5rem; }
</style>
</head>
<body>
<div class="card" id="msg">
  <h2>Processing login...</h2>
  <p>Please wait.</p>
</div>
<script>
(function() {
  var msg = document.getElementById("msg");

  // Check hash fragment for error info (some Supabase error flows use fragments)
  var hash = window.location.hash.substring(1);
  if (hash) {
    var params = new URLSearchParams(hash);
    var error = params.get("error");
    var errorDesc = params.get("error_description");
    if (error) {
      // POST error info back to the server since it can't see hash fragments
      fetch("/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error, error_description: errorDesc || error })
      }).then(function() {
        msg.innerHTML = '<h2 class="error">Login failed</h2>' +
          '<p>' + (errorDesc || error) + '</p>' +
          '<p>You can close this tab and try again.</p>';
      });
      return;
    }
  }

  // Check query params for errors (server already handles ?code=, but show UI feedback)
  var query = new URLSearchParams(window.location.search);
  var qError = query.get("error");
  var qErrorDesc = query.get("error_description");
  if (qError) {
    msg.innerHTML = '<h2 class="error">Login failed</h2>' +
      '<p>' + (qErrorDesc || qError) + '</p>' +
      '<p>You can close this tab and try again.</p>';
    return;
  }

  // Success — server already captured the code from query params
  if (query.get("code")) {
    msg.innerHTML = '<h2 class="success">Login successful!</h2>' +
      '<p>You can close this tab and return to TermCanvas.</p>';
    return;
  }

  // No code, no error — unexpected state
  msg.innerHTML = '<h2 class="error">Something went wrong</h2>' +
    '<p>No authorization data received. Please try again.</p>';
})();
</script>
</body>
</html>`;

/**
 * Starts a local HTTP server to receive the OAuth callback from Supabase.
 *
 * Returns a promise that resolves with the callback result (success code,
 * error, or timeout). The server shuts itself down after receiving a result
 * or timing out.
 */
export function startOAuthCallbackServer(): {
  port: number;
  resultPromise: Promise<CallbackResult>;
  shutdown: () => void;
} {
  let settle: (result: CallbackResult) => void;
  let settled = false;
  const resultPromise = new Promise<CallbackResult>((resolve) => {
    settle = (result: CallbackResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${CALLBACK_PORT}`);

    // POST /relay — hash fragment data relayed from the browser JS
    if (req.method === "POST" && url.pathname === "/relay") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            console.error(
              `[OAuthCallback] Error relayed from browser: ${data.error} — ${data.error_description}`,
            );
            settle({
              type: "error",
              error: data.error,
              description: data.error_description || data.error,
            });
          }
        } catch (err) {
          console.error("[OAuthCallback] Failed to parse relay body:", err);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // GET /callback — the main OAuth redirect target
    if (url.pathname === "/callback") {
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      if (error) {
        console.error(
          `[OAuthCallback] Error in query params: ${error} — ${errorDescription}`,
        );
        settle({
          type: "error",
          error,
          description: errorDescription || error,
        });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(RELAY_HTML);
        return;
      }

      // Check for authorization code (PKCE flow)
      const code = url.searchParams.get("code");
      if (code) {
        console.log("[OAuthCallback] Authorization code received");
        settle({ type: "success", code });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(RELAY_HTML);
        return;
      }

      // No code and no error in query — serve HTML to check hash fragment
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(RELAY_HTML);
      return;
    }

    // Anything else — 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[OAuthCallback] Port ${CALLBACK_PORT} is already in use. Cannot start OAuth callback server.`,
      );
      settle({
        type: "error",
        error: "port_in_use",
        description: `Port ${CALLBACK_PORT} is already in use. Close any other TermCanvas instances and try again.`,
      });
    } else {
      console.error("[OAuthCallback] Server error:", err);
      settle({
        type: "error",
        error: "server_error",
        description: err.message,
      });
    }
  });

  server.listen(CALLBACK_PORT, "127.0.0.1", () => {
    console.log(
      `[OAuthCallback] Listening on http://127.0.0.1:${CALLBACK_PORT}/callback`,
    );
  });

  // Timeout — don't leave the server hanging forever
  const timer = setTimeout(() => {
    console.warn("[OAuthCallback] Timed out waiting for callback");
    settle({ type: "timeout" });
    server.close();
  }, OAUTH_CALLBACK_TIMEOUT);

  const shutdown = () => {
    clearTimeout(timer);
    server.close();
  };

  resultPromise.then(() => {
    // Small delay so the browser can finish loading the response HTML
    setTimeout(() => shutdown(), 2000);
  });

  return { port: CALLBACK_PORT, resultPromise, shutdown };
}
