import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.ts";

test("server starts and responds to health check", async () => {
  const { state, shutdown } = await startServer(0);
  try {
    assert.ok(state.port > 0, "port should be assigned");
    assert.ok(state.token.length > 0, "token should be generated");
    assert.equal(state.pid, process.pid);

    const res = await fetch(`http://127.0.0.1:${state.port}/health`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.pid, process.pid);
  } finally {
    await shutdown();
  }
});

test("server rejects unauthorized command", async () => {
  const { state, shutdown } = await startServer(0);
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "test", args: [] }),
    });
    assert.equal(res.status, 401);
  } finally {
    await shutdown();
  }
});

test("server handles stop command", async () => {
  const { state } = await startServer(0);
  const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify({ command: "stop", args: [] }),
  });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.output, "shutting down");
});
