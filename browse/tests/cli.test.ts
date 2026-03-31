import test from "node:test";
import assert from "node:assert/strict";
import { startServer, setCommandRegistry } from "../src/server.ts";
import type { CommandHandler } from "../src/server.ts";

test("CLI can send command to server and receive response", async () => {
  const echo: CommandHandler = async (_page, args) => ({
    ok: true,
    output: `echo: ${args.join(" ")}`,
  });
  const registry = new Map<string, CommandHandler>([["echo", echo]]);
  setCommandRegistry(registry);

  const { state, shutdown } = await startServer(0);
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ command: "echo", args: ["hello", "world"] }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.output, "echo: hello world");
  } finally {
    await shutdown();
  }
});

test("CLI handles unknown command gracefully", async () => {
  setCommandRegistry(new Map());
  const { state, shutdown } = await startServer(0);
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ command: "nonexistent", args: [] }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /unknown command/);
  } finally {
    await shutdown();
  }
});
