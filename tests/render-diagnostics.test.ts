import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RenderDiagnosticsLogger } from "../electron/render-diagnostics.ts";

test("render diagnostics logger persists renderer and main events as JSONL", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-render-diagnostics-"),
  );
  const filePath = path.join(tempDir, "logs", "render-diagnostics.jsonl");
  let tick = 0;
  const logger = new RenderDiagnosticsLogger(
    filePath,
    () => `2026-04-20T00:00:0${tick++}.000Z`,
  );

  logger.recordRendererEvent({
    kind: "shortcut_cycle_terminal",
    terminalId: "terminal-1",
    data: {
      direction: "next",
    },
  });
  logger.recordMainEvent("browser_window_focus", {
    window_id: 3,
  });

  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
  assert.equal(lines.length, 2);

  const first = JSON.parse(lines[0]);
  const second = JSON.parse(lines[1]);

  assert.equal(first.source, "renderer");
  assert.equal(first.kind, "shortcut_cycle_terminal");
  assert.equal(first.terminal_id, "terminal-1");
  assert.equal(first.data.direction, "next");
  assert.equal(first.logged_at, "2026-04-20T00:00:00.000Z");
  assert.equal(typeof first.data.process_pid, "number");

  assert.equal(second.source, "main");
  assert.equal(second.kind, "browser_window_focus");
  assert.equal(second.terminal_id, undefined);
  assert.equal(second.data.window_id, 3);
  assert.equal(second.logged_at, "2026-04-20T00:00:01.000Z");

  assert.deepEqual(logger.getLogInfo(), { filePath });
});
