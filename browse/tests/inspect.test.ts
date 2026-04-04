import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, setCommandRegistry } from "../src/server.ts";
import type { CommandHandler } from "../src/server.ts";
import { navigationCommands } from "../src/commands/navigation.ts";
import { inspectCommands } from "../src/commands/inspect.ts";
import { interactCommands } from "../src/commands/interact.ts";

function makeRegistry(): Map<string, CommandHandler> {
  const m = new Map<string, CommandHandler>();
  for (const [k, v] of navigationCommands) m.set(k, v);
  for (const [k, v] of inspectCommands) m.set(k, v);
  for (const [k, v] of interactCommands) m.set(k, v);
  return m;
}

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browse-inspect-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html><head><title>Inspect Test</title></head>
<body>
  <h1>Hello World</h1>
  <button>Submit</button>
  <input type="text" placeholder="Email" aria-label="Email" />
  <a href="https://example.com">Example Link</a>
  <p>Some paragraph text</p>
</body></html>`,
  );
  return dir;
}

function makeConsoleFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browse-console-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html><head><title>Console Test</title></head>
<body>
  <button onclick="console.log('hello from button')">Log</button>
  <script>console.log('page loaded');</script>
</body></html>`,
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

test("snapshot returns accessibility tree with refs for interactive elements", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "snapshot", ["-i"]);
    assert.equal(result.ok, true);
    assert.match(result.output, /@e\d+/);
    assert.match(result.output, /button/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("text extracts visible page text", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "text", []);
    assert.equal(result.ok, true);
    assert.match(result.output, /Hello World/);
    assert.match(result.output, /Some paragraph text/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("links extracts all anchors", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "links", []);
    assert.equal(result.ok, true);
    assert.match(result.output, /Example Link/);
    assert.match(result.output, /example\.com/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("console captures page messages", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeConsoleFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    await new Promise((r) => setTimeout(r, 200));
    const result = await sendCommand(state.port, state.token, "console", []);
    assert.equal(result.ok, true);
    assert.match(result.output, /page loaded/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("full snapshot (without -i) includes non-interactive elements", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "snapshot", []);
    assert.equal(result.ok, true);
    assert.match(result.output, /heading/);
    assert.match(result.output, /button/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});
