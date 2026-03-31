import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ServerEventBus } from "../headless-runtime/event-bus.ts";
import {
  createGracefulShutdown,
  createPersistenceController,
} from "../headless-runtime/lifecycle.ts";

test("persistence controller flushes the latest pending state immediately", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-headless-persistence-"),
  );
  const statePath = path.join(tempDir, "state.json");
  let state = { saved: 1 };

  const persistence = createPersistenceController(statePath, () => state, 60_000);
  persistence.schedule();

  state = { saved: 2 };
  persistence.flush();

  assert.deepEqual(
    JSON.parse(fs.readFileSync(statePath, "utf-8")),
    { saved: 2 },
  );

  persistence.cancel();
});

test("graceful shutdown flushes state, removes the port file, and only runs once", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-headless-shutdown-"),
  );
  const statePath = path.join(tempDir, "state.json");
  const portFile = path.join(tempDir, "port");
  fs.writeFileSync(portFile, "7080", "utf-8");

  let state = { saved: 1 };
  const persistence = createPersistenceController(statePath, () => state, 60_000);
  persistence.schedule();
  state = { saved: 2 };

  const eventBus = new ServerEventBus();
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  eventBus.on("*", (event) => {
    events.push({ type: event.type, payload: event.payload });
  });

  const cleanupSteps: string[] = [];
  const exitCodes: number[] = [];
  const shutdown = createGracefulShutdown({
    host: "0.0.0.0",
    port: 7080,
    version: "1.2.3",
    eventBus,
    persistence,
    heartbeat: {
      stop() {
        cleanupSteps.push("heartbeat");
      },
    },
    apiServer: {
      stop() {
        cleanupSteps.push("api");
      },
    },
    ptyManager: {
      async destroyAll() {
        cleanupSteps.push("pty");
      },
    },
    telemetryService: {
      dispose() {
        cleanupSteps.push("telemetry");
      },
    },
    webhookService: {
      stop() {
        cleanupSteps.push("webhook");
      },
    },
    portFile,
    exit(code) {
      exitCodes.push(code);
    },
  });

  await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

  assert.deepEqual(cleanupSteps, [
    "heartbeat",
    "api",
    "pty",
    "telemetry",
    "webhook",
  ]);
  assert.deepEqual(exitCodes, [0]);
  assert.equal(fs.existsSync(portFile), false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(statePath, "utf-8")),
    { saved: 2 },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "server_stopping");
  assert.equal(events[0].payload.signal, "SIGTERM");
});
