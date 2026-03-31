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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browse-interact-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html><head><title>Interact Test</title></head>
<body>
  <button id="btn" onclick="document.getElementById('result').textContent='clicked'">Click Me</button>
  <input type="text" id="input" aria-label="Name" />
  <div id="result"></div>
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

test("click works with CSS selector", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "click", [
      "#btn",
    ]);
    assert.equal(result.ok, true);
    assert.match(result.output, /Clicked/);

    const text = await sendCommand(state.port, state.token, "text", []);
    assert.match(text.output, /clicked/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("click works with ref after snapshot", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    await sendCommand(state.port, state.token, "snapshot", ["-i"]);
    // @e1 should be the button
    const result = await sendCommand(state.port, state.token, "click", [
      "@e1",
    ]);
    assert.equal(result.ok, true);

    const text = await sendCommand(state.port, state.token, "text", []);
    assert.match(text.output, /clicked/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("fill works with CSS selector", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "fill", [
      "#input",
      "hello world",
    ]);
    assert.equal(result.ok, true);
    assert.match(result.output, /Filled/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});
