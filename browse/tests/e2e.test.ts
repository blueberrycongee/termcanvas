import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, setCommandRegistry } from "../src/server.ts";
import { createCommandRegistry } from "../src/commands/index.ts";

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browse-e2e-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html><head><title>E2E Test Page</title></head>
<body>
  <h1>Welcome</h1>
  <button id="btn" onclick="document.getElementById('msg').textContent='done'">Go</button>
  <input type="text" aria-label="Search" />
  <a href="page2.html">Next Page</a>
  <div id="msg"></div>
</body></html>`,
  );
  fs.writeFileSync(
    path.join(dir, "page2.html"),
    `<!DOCTYPE html><html><head><title>Page 2</title></head><body><h1>Page 2</h1></body></html>`,
  );
  return dir;
}

async function sendCommand(
  port: number,
  token: string,
  command: string,
  args: string[],
) {
  const res = await fetch(`http://127.0.0.1:${port}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ command, args }),
  });
  return res.json();
}

test("end-to-end: goto → snapshot → click → screenshot → stop", async () => {
  setCommandRegistry(createCommandRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  const screenshotPath = path.join(dir, "e2e.png");
  try {
    // 1. Navigate
    const gotoResult = await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    assert.equal(gotoResult.ok, true);
    assert.match(gotoResult.output, /E2E Test Page/);

    // 2. Snapshot with refs
    const snapResult = await sendCommand(state.port, state.token, "snapshot", [
      "-i",
    ]);
    assert.equal(snapResult.ok, true);
    assert.match(snapResult.output, /@e1/);
    assert.match(snapResult.output, /button/);

    // 3. Click ref
    const clickResult = await sendCommand(
      state.port,
      state.token,
      "click",
      ["@e1"],
    );
    assert.equal(clickResult.ok, true);

    // Verify click had effect
    const textResult = await sendCommand(state.port, state.token, "text", []);
    assert.match(textResult.output, /done/);

    // 4. Screenshot
    const ssResult = await sendCommand(
      state.port,
      state.token,
      "screenshot",
      [screenshotPath],
    );
    assert.equal(ssResult.ok, true);
    assert.ok(fs.existsSync(screenshotPath));

    // 5. URL check
    const urlResult = await sendCommand(state.port, state.token, "url", []);
    assert.match(urlResult.output, /index\.html/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("end-to-end: fill input and press key", async () => {
  setCommandRegistry(createCommandRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);

    // Snapshot to get refs
    await sendCommand(state.port, state.token, "snapshot", ["-i"]);

    // Find the textbox ref and fill it
    const fillResult = await sendCommand(state.port, state.token, "fill", [
      "input",
      "hello world",
    ]);
    assert.equal(fillResult.ok, true);

    // Press Enter
    const pressResult = await sendCommand(state.port, state.token, "press", [
      "Enter",
    ]);
    assert.equal(pressResult.ok, true);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});
