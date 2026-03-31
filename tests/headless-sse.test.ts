import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import {
  FakePtyManager,
  addProjectWithMainWorktree,
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
} from "./headless-runtime-test-helpers.ts";

function parseSseFrames(chunk: string): Array<Record<string, unknown>> {
  const frames = chunk.split("\n\n");
  const events: Array<Record<string, unknown>> = [];

  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n");
    if (data) {
      events.push(JSON.parse(data) as Record<string, unknown>);
    }
  }

  return events;
}

async function collectSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (events: Array<Record<string, unknown>>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";
  const timeoutAt = Date.now() + 2_000;

  while (Date.now() < timeoutAt) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lastFrameIndex = buffer.lastIndexOf("\n\n");
    if (lastFrameIndex >= 0) {
      const complete = buffer.slice(0, lastFrameIndex + 2);
      buffer = buffer.slice(lastFrameIndex + 2);
      events.push(...parseSseFrames(complete));
      if (predicate(events)) {
        return events;
      }
    }
  }

  throw new Error(`Timed out waiting for SSE events: ${JSON.stringify(events)}`);
}

test("terminal SSE streams terminal output and status changes without cross-terminal leaks", async () => {
  const workspaceDir = createWorkspaceFixture({ "README.md": "hello\n" });
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "sse-repo");
  const ptyManager = new FakePtyManager();

  const harness = await startHeadlessServer({
    workspaceDir,
    projectStore,
    ptyManager,
  });

  try {
    const createResponseA = await fetch(`${harness.baseUrl}/terminal/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worktree: workspaceDir,
        type: "shell",
      }),
    });
    const terminalA = await createResponseA.json() as { id: string };

    const createResponseB = await fetch(`${harness.baseUrl}/terminal/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worktree: workspaceDir,
        type: "shell",
      }),
    });
    const terminalB = await createResponseB.json() as { id: string };

    const ptyIdA = harness.projectStore.getTerminal(terminalA.id)?.ptyId;
    const ptyIdB = harness.projectStore.getTerminal(terminalB.id)?.ptyId;
    assert.equal(typeof ptyIdA, "number");
    assert.equal(typeof ptyIdB, "number");

    const controller = new AbortController();
    const response = await fetch(
      `${harness.baseUrl}/api/terminal/${terminalA.id}/events`,
      {
        signal: controller.signal,
      },
    );
    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body.getReader();
    const waitForEvents = collectSseEvents(
      reader,
      (events) => {
        const relevant = events.filter(
          (event) => event.type === "terminal_output" || event.type === "terminal_status_changed",
        );
        return relevant.some((event) =>
          (event.payload as { chunk?: string }).chunk === "hello from A"
        ) && relevant.some((event) =>
          (event.payload as { status?: string }).status === "success"
        );
      },
    );

    ptyManager.emitData(ptyIdA!, "hello from A");
    ptyManager.emitData(ptyIdB!, "hello from B");
    ptyManager.emitExit(ptyIdA!, 0);
    ptyManager.emitExit(ptyIdB!, 1);

    const events = await waitForEvents;
    controller.abort();

    const relevant = events.filter(
      (event) => event.type === "terminal_output" || event.type === "terminal_status_changed",
    );

    assert.ok(
      relevant.some((event) =>
        (event.payload as { chunk?: string }).chunk === "hello from A"
      ),
    );
    assert.ok(
      relevant.some((event) =>
        (event.payload as { status?: string }).status === "success"
      ),
    );
    assert.equal(
      relevant.some((event) =>
        JSON.stringify(event).includes("hello from B")
      ),
      false,
    );
    assert.equal(
      relevant.some((event) =>
        (event.payload as { terminalId?: string }).terminalId === terminalB.id
      ),
      false,
    );
  } finally {
    await stopHeadlessServer(harness);
  }
});
