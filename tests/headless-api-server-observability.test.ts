import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import {
  addProjectWithMainWorktree,
  calculateDirectorySizeSync,
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
  writeWorkflowFixture,
} from "./headless-runtime-test-helpers.ts";

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("health endpoints expose detailed observability data with workspace-scoped disk usage", async () => {
  const workspaceDir = createWorkspaceFixture({
    "notes.txt": "abc",
    "nested/build.log": "hello",
  });
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  writeWorkflowFixture(repoPath, { id: "workflow-active", status: "running" });
  writeWorkflowFixture(repoPath, { id: "workflow-done", status: "completed" });

  const projectStore = new ProjectStore();
  const { projectId, worktreeId } = addProjectWithMainWorktree(
    projectStore,
    repoPath,
    "workspace-repo",
  );
  const firstTerminal = projectStore.addTerminal(projectId, worktreeId, "shell");
  const secondTerminal = projectStore.addTerminal(projectId, worktreeId, "codex");
  projectStore.updateTerminalStatus(projectId, worktreeId, firstTerminal.id, "running");
  projectStore.updateTerminalStatus(projectId, worktreeId, secondTerminal.id, "error");

  const harness = await startHeadlessServer({
    workspaceDir,
    projectStore,
    serverVersion: "1.2.3",
  });

  try {
    const health = await fetchJson(`${harness.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((health.body as { status: string }).status, "ok");
    assert.equal((health.body as { version: string }).version, "1.2.3");
    assert.equal(
      (health.body as { node_version: string }).node_version,
      process.version,
    );
    assert.equal(
      (health.body as { platform: string }).platform,
      process.platform,
    );
    assert.equal(
      (health.body as { active_terminals: number }).active_terminals,
      2,
    );
    assert.equal(
      (health.body as { active_workflows: number }).active_workflows,
      1,
    );
    assert.deepEqual(
      (health.body as { terminal_status_summary: Record<string, number> })
        .terminal_status_summary,
      { running: 1, error: 1 },
    );
    assert.equal(
      (health.body as { disk_usage_bytes: number }).disk_usage_bytes,
      calculateDirectorySizeSync(workspaceDir),
    );
    assert.ok(
      (health.body as { memory: { rss_bytes: number } }).memory.rss_bytes > 0,
    );

    const live = await fetchJson(`${harness.baseUrl}/health/live`);
    assert.equal(live.status, 200);
    assert.equal((live.body as { status: string }).status, "ok");

    const ready = await fetchJson(`${harness.baseUrl}/health/ready`);
    assert.equal(ready.status, 200);
    assert.equal((ready.body as { ready: boolean }).ready, true);
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("status stays authenticated and excludes secrets plus terminal-private output", async () => {
  await withEnv(
    {
      TERMCANVAS_API_TOKEN: "api-token-12345678",
      TERMCANVAS_WEBHOOK_URL: "https://hooks.example.test/events",
      TERMCANVAS_WEBHOOK_SECRET: "webhook-secret-12345678",
      OPENAI_API_KEY: "openai-secret-12345678",
    },
    async () => {
      const workspaceDir = createWorkspaceFixture({ "workspace.txt": "workspace" });
      const repoPath = path.join(workspaceDir, "repo");
      fs.mkdirSync(repoPath, { recursive: true });
      writeWorkflowFixture(repoPath, { id: "workflow-live", status: "waiting_for_approval" });

      const projectStore = new ProjectStore();
      const { projectId, worktreeId } = addProjectWithMainWorktree(
        projectStore,
        repoPath,
        "secured-repo",
      );
      const terminal = projectStore.addTerminal(projectId, worktreeId, "shell");
      projectStore.updateTerminalStatus(projectId, worktreeId, terminal.id, "running");

      const harness = await startHeadlessServer({
        workspaceDir,
        projectStore,
        serverVersion: "9.9.9",
      });

      try {
        harness.eventBus.emit("terminal_output", {
          terminalId: terminal.id,
          chunk: "do-not-leak-this",
        });
        harness.eventBus.emit("server_started", { host: "127.0.0.1", port: harness.port });

        const publicHealth = await fetchJson(`${harness.baseUrl}/health`);
        assert.equal(publicHealth.status, 200);

        const unauthorizedStatus = await fetchJson(`${harness.baseUrl}/api/status`);
        assert.equal(unauthorizedStatus.status, 401);

        const authorizedStatus = await fetchJson(`${harness.baseUrl}/api/status`, {
          headers: {
            Authorization: "Bearer api-token-12345678",
          },
        });
        assert.equal(authorizedStatus.status, 200);

        const statusBody = authorizedStatus.body as {
          terminals: Array<Record<string, unknown>>;
          active_workflows: Array<Record<string, unknown>>;
          recent_events: Array<{ type: string }>;
          server: {
            config: {
              api_token_configured: boolean;
              webhook_enabled: boolean;
            };
          };
        };

        assert.equal(statusBody.active_workflows.length, 1);
        assert.equal(statusBody.terminals.length, 1);
        assert.equal("ptyId" in statusBody.terminals[0], false);
        assert.equal(statusBody.server.config.api_token_configured, true);
        assert.equal(statusBody.server.config.webhook_enabled, true);
        assert.deepEqual(
          statusBody.recent_events.map((event) => event.type),
          ["server_started"],
        );

        const serialized = JSON.stringify(statusBody);
        assert.equal(serialized.includes("do-not-leak-this"), false);
        assert.equal(serialized.includes("api-token-12345678"), false);
        assert.equal(serialized.includes("webhook-secret-12345678"), false);
        assert.equal(serialized.includes("openai-secret-12345678"), false);
      } finally {
        await stopHeadlessServer(harness);
      }
    },
  );
});
