import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, setCommandRegistry } from "../src/server.ts";
import type { CommandHandler } from "../src/server.ts";
import { navigationCommands } from "../src/commands/navigation.ts";

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browse-nav-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><title>Test Page</title></head><body><h1>Hello</h1><a href="page2.html">Link</a></body></html>`,
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

test("goto navigates to local file and returns title", async () => {
  setCommandRegistry(navigationCommands);
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    const result = await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    assert.equal(result.ok, true);
    assert.match(result.output, /Test Page/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("url returns current page URL", async () => {
  setCommandRegistry(navigationCommands);
  const { state, shutdown } = await startServer(0);
  const dir = makeFixture();
  try {
    await sendCommand(state.port, state.token, "goto", [
      `file://${path.join(dir, "index.html")}`,
    ]);
    const result = await sendCommand(state.port, state.token, "url", []);
    assert.equal(result.ok, true);
    assert.match(result.output, /index\.html/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true });
  }
});

test("goto rejects invalid URL scheme", async () => {
  setCommandRegistry(navigationCommands);
  const { state, shutdown } = await startServer(0);
  try {
    const result = await sendCommand(state.port, state.token, "goto", [
      "ftp://example.com",
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /http/);
  } finally {
    await shutdown();
  }
});
