import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, setCommandRegistry } from "../src/server.ts";
import type { CommandHandler } from "../src/server.ts";
import { navigationCommands } from "../src/commands/navigation.ts";
import { metaCommands } from "../src/commands/meta.ts";

function makeRegistry(): Map<string, CommandHandler> {
  const m = new Map<string, CommandHandler>();
  for (const [k, v] of navigationCommands) m.set(k, v);
  for (const [k, v] of metaCommands) m.set(k, v);
  return m;
}

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browse-meta-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><title>Meta Test</title></head><body><h1>Hello</h1></body></html>`,
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

test("screenshot creates a file", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  const screenshotPath = path.join(dir, "test-screenshot.png");
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "screenshot", [
      screenshotPath,
    ]);
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(screenshotPath), "screenshot file should exist");
    const stat = fs.statSync(screenshotPath);
    assert.ok(stat.size > 100, "screenshot should have content");
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("tabs lists open pages", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "tabs", []);
    assert.equal(result.ok, true);
    assert.match(result.output, /index\.html/);
    assert.match(result.output, /\(active\)/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("cookies returns JSON array", async () => {
  setCommandRegistry(makeRegistry());
  const { state, shutdown } = await startServer(0);
  try {
    const result = await sendCommand(state.port, state.token, "cookies", []);
    assert.equal(result.ok, true);
    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed));
  } finally {
    await shutdown();
  }
});
