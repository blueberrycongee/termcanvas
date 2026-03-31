import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TelemetryService } from "../electron/telemetry-service.ts";
import { ServerEventBus } from "../headless-runtime/event-bus.ts";
import {
  createGracefulShutdown,
  createPersistenceController,
} from "../headless-runtime/lifecycle.ts";
import { sanitizeProjectsForPersistence } from "../headless-runtime/persisted-projects.ts";
import { launchTrackedTerminal } from "../headless-runtime/terminal-launch.ts";
import { ProjectStore, generateId } from "../headless-runtime/project-store.ts";
import { FakePtyManager } from "./headless-runtime-test-helpers.ts";

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

test("graceful shutdown persists terminals without live PTY bindings", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-headless-shutdown-state-"),
  );
  const statePath = path.join(tempDir, "state.json");
  const portFile = path.join(tempDir, "port");
  fs.writeFileSync(portFile, "7080", "utf-8");

  const projectStore = new ProjectStore();
  const projectId = generateId();
  const worktreeId = generateId();
  projectStore.addProject({
    id: projectId,
    name: "repo",
    path: tempDir,
    position: { x: 0, y: 0 },
    collapsed: false,
    zIndex: 0,
    worktrees: [
      {
        id: worktreeId,
        name: "main",
        path: tempDir,
        position: { x: 0, y: 0 },
        collapsed: false,
        terminals: [],
      },
    ],
  });

  const ptyManager = new FakePtyManager();
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const persistence = createPersistenceController(
    statePath,
    () => sanitizeProjectsForPersistence(projectStore.getProjects()),
    60_000,
  );

  await launchTrackedTerminal({
    projectStore,
    ptyManager,
    telemetryService,
    eventBus: new ServerEventBus(),
    onMutation: () => persistence.schedule(),
    worktree: tempDir,
    type: "shell",
  });

  const shutdown = createGracefulShutdown({
    host: "0.0.0.0",
    port: 7080,
    version: "1.2.3",
    eventBus: new ServerEventBus(),
    persistence,
    apiServer: {
      stop() {},
    },
    ptyManager,
    telemetryService,
    portFile,
    exit() {},
  });

  await shutdown("SIGTERM");

  const saved = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  assert.equal(saved[0].worktrees[0].terminals[0].ptyId, null);
  assert.equal(saved[0].worktrees[0].terminals[0].status, "idle");
});

test("persisted project sanitizer strips live terminal runtime fields", () => {
  const sanitized = sanitizeProjectsForPersistence([
    {
      id: "project-1",
      name: "repo",
      path: "/tmp/repo",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 0,
      worktrees: [
        {
          id: "worktree-1",
          name: "main",
          path: "/tmp/repo",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-running",
              title: "Terminal",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: 9,
              status: "running",
              span: { cols: 1, rows: 1 },
            },
            {
              id: "terminal-success",
              title: "Terminal",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: 10,
              status: "success",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
  ]);

  assert.equal(sanitized[0].worktrees[0].terminals[0].ptyId, null);
  assert.equal(sanitized[0].worktrees[0].terminals[0].status, "idle");
  assert.equal(sanitized[0].worktrees[0].terminals[1].ptyId, null);
  assert.equal(sanitized[0].worktrees[0].terminals[1].status, "success");
});
