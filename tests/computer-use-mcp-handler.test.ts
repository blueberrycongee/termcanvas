import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleToolCall } from "../mcp/computer-use-server/src/handler.ts";
import type { HelperClient } from "../mcp/computer-use-server/src/helper-client.ts";

class FakeHelperClient {
  posts: Array<{ endpoint: string; body?: unknown }> = [];
  screenshotPath: string | null = null;

  async get(endpoint: string): Promise<unknown> {
    assert.equal(endpoint, "health");
    return { ok: true, version: "test" };
  }

  async post(endpoint: string, body?: unknown): Promise<unknown> {
    this.posts.push({ endpoint, body });
    if (endpoint === "status") {
      return { accessibility_granted: true, screen_recording_granted: true };
    }
    if (endpoint === "list_apps") {
      return {
        apps: [
          {
            name: "TermCanvas",
            bundle_id: "com.blueberrycongee.termcanvas",
            pid: 42,
            is_frontmost: true,
          },
        ],
      };
    }
    if (endpoint === "get_app_state") {
      return {
        app: { name: "TermCanvas", bundle_id: "com.blueberrycongee.termcanvas", pid: 42 },
        windows: [],
        elements: [{ index: 0, role: "AXButton", actions: ["AXPress"] }],
        accessibility_tree: [],
        screenshot_path: this.screenshotPath,
        screenshot_scale: 2,
      };
    }
    return { ok: true };
  }
}

function asHelper(client: FakeHelperClient): HelperClient {
  return client as unknown as HelperClient;
}

test("computer use MCP list_apps unwraps helper response", async () => {
  const client = new FakeHelperClient();
  const result = await handleToolCall("list_apps", {}, asHelper(client));

  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text as string), [
    {
      name: "TermCanvas",
      bundle_id: "com.blueberrycongee.termcanvas",
      pid: 42,
      is_frontmost: true,
    },
  ]);
});

test("computer use MCP get_app_state defaults to screenshot and returns image content", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-cu-test-"));
  const screenshotPath = path.join(dir, "screenshot.png");
  fs.writeFileSync(screenshotPath, Buffer.from("png"));

  try {
    const client = new FakeHelperClient();
    client.screenshotPath = screenshotPath;
    const result = await handleToolCall(
      "get_app_state",
      { app_name: "TermCanvas" },
      asHelper(client),
    );

    assert.equal(result.isError, undefined);
    assert.deepEqual(client.posts[0], {
      endpoint: "get_app_state",
      body: { include_screenshot: true, app_name: "TermCanvas" },
    });
    assert.equal(result.content.some((item) => item.type === "image"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("computer use MCP supports new set_value and secondary action tools", async () => {
  const client = new FakeHelperClient();

  await handleToolCall("set_value", { app_name: "Notes", element: 3, value: "hello" }, asHelper(client));
  await handleToolCall(
    "perform_secondary_action",
    { app_name: "Notes", element: 3, action: "AXShowMenu" },
    asHelper(client),
  );

  assert.deepEqual(client.posts, [
    {
      endpoint: "set_value",
      body: { app_name: "Notes", element: 3, value: "hello" },
    },
    {
      endpoint: "perform_secondary_action",
      body: { app_name: "Notes", element: 3, action: "AXShowMenu" },
    },
  ]);
});
