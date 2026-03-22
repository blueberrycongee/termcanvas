import http from "http";

const OAUTH_CALLBACK_PORT = 17249;
const OAUTH_CALLBACK_TIMEOUT = 30_000;

export interface CallbackTokens {
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
