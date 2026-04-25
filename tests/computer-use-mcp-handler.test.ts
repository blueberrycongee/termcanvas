import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleToolCall } from "../mcp/computer-use-server/src/handler.ts";
import {
  resolveHelperConnection,
  HelperClient as RealHelperClient,
  type HelperClient,
} from "../mcp/computer-use-server/src/helper-client.ts";
import { readComputerUseInstructions } from "../mcp/computer-use-server/src/instructions.ts";
import type { TermCanvasClient } from "../mcp/computer-use-server/src/termcanvas-client.ts";
import { tools } from "../mcp/computer-use-server/src/tools.ts";

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
      return {
        accessibility_granted: true,
        screen_recording_granted: true,
        skylight_post_to_pid_available: true,
        focus_without_raise_available: true,
        window_location_available: true,
        screen_capture_kit_available: true,
      };
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
    if (endpoint === "list_windows") {
      return {
        windows: [
          {
            window_id: 7,
            pid: 42,
            app_name: "TermCanvas",
            title: "Main",
            bounds: { x: 10, y: 20, width: 800, height: 600 },
            layer: 0,
            z_index: 0,
            is_on_screen: true,
          },
        ],
        current_space_id: null,
      };
    }
    if (endpoint === "get_screen_size") {
      return { width: 3024, height: 1964, scale: 2 };
    }
    if (endpoint === "screenshot") {
      return {
        capture_id: "42:7:789",
        path: this.screenshotPath,
        pixel_size: { width: 1600, height: 1200 },
        scale: 2,
        coordinate_space: "screenshot",
      };
    }
    if (endpoint === "zoom") {
      return {
        capture_id: "42:7:789:zoom:1",
        path: this.screenshotPath,
        pixel_size: { width: 200, height: 120 },
        scale: 2,
        coordinate_space: "zoom",
      };
    }
    if (endpoint === "get_app_state") {
      return {
        app: { name: "TermCanvas", bundle_id: "com.blueberrycongee.termcanvas", pid: 42 },
        windows: [],
        elements: [{ index: 0, role: "AXButton", actions: ["AXPress"] }],
        accessibility_tree: [],
        screenshot_path: this.screenshotPath,
        screenshot_capture_id: "42:7:123",
        screenshot: { capture_id: "42:7:123" },
        screenshot_scale: 2,
      };
    }
    if (endpoint === "get_window_state") {
      return {
        app: { name: "TermCanvas", bundle_id: "com.blueberrycongee.termcanvas", pid: 42 },
        windows: [
          {
            id: "7",
            window_id: 7,
            title: "Main",
            frame: { x: 10, y: 20, width: 800, height: 600 },
          },
        ],
        elements: [{ index: 0, role: "AXButton", actions: ["AXPress"] }],
        accessibility_tree: [],
        screenshot_path: this.screenshotPath,
        screenshot_capture_id: "42:7:456",
        screenshot: { capture_id: "42:7:456" },
        screenshot_scale: 2,
      };
    }
    return { ok: true };
  }
}

function asHelper(client: FakeHelperClient): HelperClient {
  return client as unknown as HelperClient;
}

class FakeTermCanvasClient {
  posts: string[] = [];
  gets: string[] = [];

  async post(pathname: string): Promise<unknown> {
    this.posts.push(pathname);
    return {
      enabled: true,
      helperRunning: true,
      accessibilityGranted: false,
      screenRecordingGranted: false,
    };
  }
}

function asTermCanvas(client: FakeTermCanvasClient): TermCanvasClient {
  return client as unknown as TermCanvasClient;
}

async function withTempComputerUseConfig<T>(
  fn: () => Promise<T> | T,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-cu-config-"));
  const previous = process.env.TERMCANVAS_COMPUTER_USE_CONFIG;
  process.env.TERMCANVAS_COMPUTER_USE_CONFIG = path.join(dir, "config.json");
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TERMCANVAS_COMPUTER_USE_CONFIG;
    } else {
      process.env.TERMCANVAS_COMPUTER_USE_CONFIG = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test("computer use MCP list_windows exposes addressable windows", async () => {
  const client = new FakeHelperClient();
  const result = await handleToolCall(
    "list_windows",
    { pid: 42, on_screen_only: true },
    asHelper(client),
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(client.posts[0], {
    endpoint: "list_windows",
    body: { pid: 42, on_screen_only: true },
  });
  const payload = JSON.parse(result.content[0].text as string);
  assert.equal(payload.windows[0].window_id, 7);
  assert.equal(payload.windows[0].pid, 42);
});

test("computer use MCP get_app_state defaults to screenshot and returns image content", async () => {
  await withTempComputerUseConfig(async () => {
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
        body: {
          include_screenshot: true,
          capture_mode: "som",
          max_image_dimension: 1568,
          app_name: "TermCanvas",
        },
      });
      assert.equal(result.content.some((item) => item.type === "image"), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("computer use MCP launch_app uses background launch endpoint", async () => {
  const client = new FakeHelperClient();
  const result = await handleToolCall(
    "launch_app",
    { bundle_id: "com.apple.TextEdit" },
    asHelper(client),
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(client.posts[0], {
    endpoint: "launch_app",
    body: { bundle_id: "com.apple.TextEdit" },
  });
});

test("computer use MCP persists capture config and forwards it to observations", async () => {
  await withTempComputerUseConfig(async () => {
    const client = new FakeHelperClient();

    const initial = await handleToolCall("get_config", {}, asHelper(client));
    assert.deepEqual(JSON.parse(initial.content[0].text as string), {
      schema_version: 1,
      capture_mode: "som",
      max_image_dimension: 1568,
    });

    const updated = await handleToolCall(
      "set_config",
      { capture_mode: "screenshot", max_image_dimension: 1024 },
      asHelper(client),
    );
    assert.deepEqual(JSON.parse(updated.content[0].text as string), {
      schema_version: 1,
      capture_mode: "vision",
      max_image_dimension: 1024,
    });

    await handleToolCall("get_app_state", { pid: 42 }, asHelper(client));
    assert.deepEqual(client.posts[0], {
      endpoint: "get_app_state",
      body: {
        include_screenshot: true,
        capture_mode: "vision",
        max_image_dimension: 1024,
        pid: 42,
      },
    });
  });
});

test("computer use MCP rejects invalid config keys", async () => {
  await withTempComputerUseConfig(async () => {
    const client = new FakeHelperClient();
    const result = await handleToolCall(
      "set_config",
      { capture_mode: "bad-mode" },
      asHelper(client),
    );

    assert.equal(result.isError, true);
    assert.match(result.content[0].text as string, /capture_mode must be one of/);
  });
});

test("computer use MCP forwards debug crosshair requests with configured image cap", async () => {
  await withTempComputerUseConfig(async () => {
    const client = new FakeHelperClient();
    await handleToolCall(
      "set_config",
      { max_image_dimension: 900 },
      asHelper(client),
    );

    await handleToolCall(
      "click",
      {
        pid: 42,
        window_id: 7,
        x: 10,
        y: 20,
        coordinate_space: "screenshot",
        debug_image_out: "/tmp/termcanvas-crosshair.png",
      },
      asHelper(client),
    );

    assert.deepEqual(client.posts[0], {
      endpoint: "click",
      body: {
        max_image_dimension: 900,
        pid: 42,
        window_id: 7,
        x: 10,
        y: 20,
        coordinate_space: "screenshot",
        debug_image_out: "/tmp/termcanvas-crosshair.png",
      },
    });
  });
});

test("computer use MCP records and replays action trajectories", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-cu-rec-"));
  try {
    const client = new FakeHelperClient();
    const started = await handleToolCall(
      "set_recording",
      { enabled: true, output_dir: dir },
      asHelper(client),
    );
    assert.equal(JSON.parse(started.content[0].text as string).enabled, true);

    await handleToolCall("click", { pid: 42, x: 10, y: 20 }, asHelper(client));

    const state = await handleToolCall("get_recording_state", {}, asHelper(client));
    assert.equal(JSON.parse(state.content[0].text as string).next_turn, 2);

    const actionFile = path.join(dir, "turn-000001", "action.json");
    const action = JSON.parse(fs.readFileSync(actionFile, "utf-8"));
    assert.equal(action.schema_version, "termcanvas/computer-use-action/v1");
    assert.equal(action.tool, "click");
    assert.deepEqual(action.arguments, { pid: 42, x: 10, y: 20 });

    await handleToolCall("set_recording", { enabled: false }, asHelper(client));
    client.posts = [];

    const replay = await handleToolCall(
      "replay_trajectory",
      { input_dir: dir },
      asHelper(client),
    );
    const replayPayload = JSON.parse(replay.content[0].text as string);

    assert.equal(replayPayload.attempted, 1);
    assert.deepEqual(client.posts, [
      { endpoint: "click", body: { pid: 42, x: 10, y: 20 } },
    ]);
  } finally {
    await handleToolCall("set_recording", { enabled: false }, asHelper(new FakeHelperClient()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("computer use MCP rejects unsupported video recording flag", async () => {
  const client = new FakeHelperClient();
  const result = await handleToolCall(
    "set_recording",
    { enabled: true, output_dir: "/tmp/termcanvas-cu-video", video_experimental: true },
    asHelper(client),
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text as string, /video_experimental recording is not supported/);
});

test("computer use MCP get_window_state requires explicit window target", async () => {
  await withTempComputerUseConfig(async () => {
    const client = new FakeHelperClient();
    const result = await handleToolCall(
      "get_window_state",
      { pid: 42, window_id: 7 },
      asHelper(client),
    );
    const state = JSON.parse(result.content[0].text as string);

    assert.equal(result.isError, undefined);
    assert.deepEqual(client.posts[0], {
      endpoint: "get_window_state",
      body: {
        include_screenshot: true,
        capture_mode: "som",
        max_image_dimension: 1568,
        pid: 42,
        window_id: 7,
      },
    });
    assert.equal(state.windows[0].window_id, 7);
    assert.equal(state.capture_id, "42:7:456");
  });
});

test("computer use MCP exposes screenshot and screen size tools", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-cu-shot-"));
  const screenshotPath = path.join(dir, "screenshot.png");
  fs.writeFileSync(screenshotPath, Buffer.from("png"));

  try {
    const client = new FakeHelperClient();
    client.screenshotPath = screenshotPath;

    const sizeResult = await handleToolCall("get_screen_size", {}, asHelper(client));
    assert.deepEqual(JSON.parse(sizeResult.content[0].text as string), {
      width: 3024,
      height: 1964,
      scale: 2,
    });

    const shotResult = await handleToolCall(
      "screenshot",
      { pid: 42, window_id: 7 },
      asHelper(client),
    );
    assert.equal(shotResult.content.some((item) => item.type === "image"), true);
    const zoomResult = await handleToolCall(
      "zoom",
      { pid: 42, capture_id: "42:7:789", x1: 10, y1: 20, x2: 110, y2: 80 },
      asHelper(client),
    );
    assert.equal(zoomResult.content.some((item) => item.type === "image"), true);
    assert.match(zoomResult.content[0].text as string, /from_zoom=true/);
    assert.deepEqual(client.posts.slice(0, 3), [
      { endpoint: "get_screen_size", body: undefined },
      { endpoint: "screenshot", body: { pid: 42, window_id: 7 } },
      {
        endpoint: "zoom",
        body: { pid: 42, capture_id: "42:7:789", x1: 10, y1: 20, x2: 110, y2: 80 },
      },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("computer use MCP exposes operating instructions as a tool", async () => {
  const client = new FakeHelperClient();
  const previousInstructions = process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS;
  let result: Awaited<ReturnType<typeof handleToolCall>> | undefined;
  try {
    process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS = path.join(
      process.cwd(),
      "skills",
      "computer-use-instructions.md",
    );
    result = await handleToolCall("get_instructions", {}, asHelper(client));
  } finally {
    if (previousInstructions === undefined) {
      delete process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS;
    } else {
      process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS = previousInstructions;
    }
  }

  assert.ok(result);
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text as string, /AX-first/i);
  assert.match(result.content[0].text as string, /Do not use browser automation, Playwright, or browser screenshots/);
  assert.match(result.content[0].text as string, /do not guess English app names on a non-English system/);
  assert.match(result.content[0].text as string, /Empty windows or missing screenshots can be transient/);
  assert.match(result.content[0].text as string, /CEF\/Chromium/);
  assert.match(result.content[0].text as string, /capture_id/);
  assert.match(result.content[0].text as string, /capture_mode/);
  assert.match(result.content[0].text as string, /After every action/);
});

test("computer use MCP status includes usage guidance", async () => {
  const client = new FakeHelperClient();
  const result = await handleToolCall("status", {}, asHelper(client));
  const status = JSON.parse(result.content[0].text as string);

  assert.equal(status.healthy, true);
  assert.deepEqual(status.capabilities, {
    skylight_post_to_pid_available: true,
    focus_without_raise_available: true,
    window_location_available: true,
    screen_capture_kit_available: true,
  });
  assert.equal(status.usage_guidance.setup_tool, "setup");
  assert.equal(status.usage_guidance.instructions_tool, "get_instructions");
  assert.deepEqual(status.usage_guidance.protocol.slice(0, 4), [
    "Use status first. If the helper is not healthy or permissions are missing, call setup. Read status.capabilities to see whether SkyLight pid posting, focus-without-raise, window-local events, and ScreenCaptureKit are available.",
    "If permissions remain false after the user says they already allowed them, guide the user to remove stale TermCanvas and computer-use-helper entries from both macOS permission panes, then add /Applications/TermCanvas.app and /Applications/TermCanvas.app/Contents/Resources/computer-use-helper again.",
    "For local macOS desktop apps, use TermCanvas Computer Use. Do not use browser automation or Playwright unless the target is a web page in a browser.",
    "Use list_apps for app identity and list_windows for window identity. Prefer pid + window_id for window-scoped observation when available.",
  ]);
  assert.match(
    status.usage_guidance.protocol.join("\n"),
    /pass capture_id when available so stale coordinates can be rejected/,
  );
  assert.match(
    status.usage_guidance.protocol.join("\n"),
    /CEF\/Chromium\/WebGL\/media surfaces/,
  );
});

test("computer use MCP get_app_state exposes a top-level capture_id alias", async () => {
  const client = new FakeHelperClient();
  const result = await handleToolCall("get_app_state", {}, asHelper(client));
  const state = JSON.parse(result.content[0].text as string);

  assert.equal(state.screenshot_capture_id, "42:7:123");
  assert.equal(state.screenshot.capture_id, "42:7:123");
  assert.equal(state.capture_id, "42:7:123");
});

test("computer use MCP setup starts Computer Use through TermCanvas", async () => {
  const helper = new FakeHelperClient();
  const termcanvas = new FakeTermCanvasClient();
  const result = await handleToolCall(
    "setup",
    {},
    asHelper(helper),
    asTermCanvas(termcanvas),
  );
  const setup = JSON.parse(result.content[0].text as string);

  assert.equal(result.isError, undefined);
  assert.deepEqual(termcanvas.posts, ["/api/computer-use/setup"]);
  assert.deepEqual(termcanvas.gets, []);
  assert.equal(setup.ok, true);
  assert.deepEqual(setup.next_steps.slice(0, 2), [
    "TermCanvas opened the macOS permission flow if any required permission is missing.",
    "If macOS shows permission prompts or System Settings panes, the user must approve Accessibility and Screen Recording / Screen & System Audio Recording.",
  ]);
  assert.match(
    setup.next_steps.join("\n"),
    /remove stale TermCanvas and computer-use-helper entries/,
  );
  assert.match(
    setup.next_steps.join("\n"),
    /\/Applications\/TermCanvas\.app\/Contents\/Resources\/computer-use-helper/,
  );
});

test("computer use MCP tool descriptions teach the AX-first protocol", () => {
  const descriptions = Object.fromEntries(
    tools.map((tool) => [tool.name, tool.description ?? ""]),
  );

  assert.match(descriptions.status, /TermCanvas desktop control protocol/);
  assert.match(descriptions.status, /SkyLight pid posting/);
  assert.match(descriptions.setup, /open the macOS permission panes/);
  assert.match(descriptions.get_config, /capture_mode/);
  assert.match(descriptions.set_config, /vision skips AX/);
  assert.match(descriptions.set_recording, /trajectory recording/);
  assert.match(descriptions.get_recording_state, /recording is enabled/);
  assert.match(descriptions.replay_trajectory, /Replay a trajectory/);
  assert.match(descriptions.get_app_state, /Observe before acting/);
  assert.match(descriptions.get_app_state, /capture_mode/);
  assert.match(descriptions.list_windows, /window_id/);
  assert.match(descriptions.screenshot, /MCP image content/);
  assert.match(descriptions.zoom, /from_zoom=true/);
  assert.match(descriptions.get_window_state, /pid and window_id/);
  assert.match(descriptions.hotkey, /key combination/);
  assert.match(descriptions.get_app_state, /do not use browser or Playwright screenshots/);
  assert.match(descriptions.list_apps, /Prefer returned bundle IDs or PIDs/);
  assert.match(descriptions.open_app, /exact localized name returned by list_apps/);
  assert.match(descriptions.launch_app, /without intentionally activating/);
  assert.match(descriptions.click, /coordinates are the last resort/);
  assert.match(descriptions.click, /debug_image_out/);
  assert.match(descriptions.middle_click, /Middle-click/);
  assert.match(descriptions.move_cursor, /hover/);
  assert.match(descriptions.move_cursor, /no-focus-steal pid path/);
  assert.match(descriptions.click, /Do not use browser, Playwright, full-screen, or stale screenshot coordinates/);
  assert.match(descriptions.click, /Pass capture_id from that screenshot/);
  assert.match(descriptions.get_app_state, /returned screenshot capture_id/);
  assert.match(descriptions.set_value, /Prefer this over keyboard typing/);
  assert.match(descriptions.type_text, /After acting, call get_app_state again/);
});

test("computer use instructions are not loaded from the agent working directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-cu-cwd-"));
  const previousCwd = process.cwd();
  const previousInstructions = process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS;
  try {
    fs.mkdirSync(path.join(dir, "skills"));
    fs.writeFileSync(
      path.join(dir, "skills", "computer-use-instructions.md"),
      "malicious local instructions",
    );
    delete process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS;
    process.chdir(dir);

    const instructions = readComputerUseInstructions();

    assert.doesNotMatch(instructions, /malicious local instructions/);
    assert.match(instructions, /TermCanvas Computer Use/);
  } finally {
    process.chdir(previousCwd);
    if (previousInstructions === undefined) {
      delete process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS;
    } else {
      process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS = previousInstructions;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("computer use MCP supports new set_value and secondary action tools", async () => {
  const client = new FakeHelperClient();

  await handleToolCall("click", { pid: 42, window_id: 7, element_index: 3 }, asHelper(client));
  await handleToolCall("click", { pid: 42, x: 11, y: 22, modifiers: ["cmd"] }, asHelper(client));
  await handleToolCall("double_click", { pid: 42, x: 10, y: 20, modifiers: ["shift"] }, asHelper(client));
  await handleToolCall("right_click", { pid: 42, x: 10, y: 20, modifiers: ["control"] }, asHelper(client));
  await handleToolCall("middle_click", { pid: 42, x: 10, y: 20 }, asHelper(client));
  await handleToolCall("move_cursor", { pid: 42, window_id: 7, x: 10, y: 20, coordinate_space: "screenshot", capture_id: "cap" }, asHelper(client));
  await handleToolCall("type_text", { pid: 42, window_id: 7, element_index: 3, text: "hello" }, asHelper(client));
  await handleToolCall("type_text_chars", { pid: 42, text: "hello" }, asHelper(client));
  await handleToolCall("press_key", { pid: 42, window_id: 7, element_index: 3, key: "Return" }, asHelper(client));
  await handleToolCall("hotkey", { pid: 42, keys: ["cmd", "c"] }, asHelper(client));
  await handleToolCall("set_value", { app_name: "Notes", element: 3, value: "hello" }, asHelper(client));
  await handleToolCall(
    "perform_secondary_action",
    { app_name: "Notes", element: 3, action: "AXShowMenu" },
    asHelper(client),
  );

  assert.deepEqual(client.posts, [
    {
      endpoint: "click",
      body: { pid: 42, window_id: 7, element_index: 3 },
    },
    {
      endpoint: "click",
      body: { pid: 42, x: 11, y: 22, modifiers: ["cmd"] },
    },
    {
      endpoint: "click",
      body: { pid: 42, x: 10, y: 20, modifiers: ["shift"], mouse_button: "double" },
    },
    {
      endpoint: "click",
      body: { pid: 42, x: 10, y: 20, modifiers: ["control"], mouse_button: "right" },
    },
    {
      endpoint: "click",
      body: { pid: 42, x: 10, y: 20, mouse_button: "middle" },
    },
    {
      endpoint: "move_cursor",
      body: { pid: 42, window_id: 7, x: 10, y: 20, coordinate_space: "screenshot", capture_id: "cap" },
    },
    {
      endpoint: "type_text",
      body: { pid: 42, window_id: 7, element_index: 3, text: "hello" },
    },
    {
      endpoint: "type_text",
      body: { pid: 42, text: "hello" },
    },
    {
      endpoint: "press_key",
      body: { pid: 42, window_id: 7, element_index: 3, key: "Return" },
    },
    {
      endpoint: "press_key",
      body: { pid: 42, key: "cmd+c" },
    },
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

test("computer use helper client reads port and token from state file", () => {
  const stateFile = "/tmp/termcanvas-cu-state.json";
  const connection = resolveHelperConnection(
    {
      TERMCANVAS_COMPUTER_USE_STATE_FILE: stateFile,
      TERMCANVAS_CU_PORT: "11111",
      TERMCANVAS_CU_TOKEN: "env-token",
    },
    (file) => {
      assert.equal(file, stateFile);
      return JSON.stringify({ enabled: true, port: 17492, token: "state-token" });
    },
  );

  assert.deepEqual(connection, {
    port: 17492,
    token: "state-token",
    stateFilePath: stateFile,
  });
});

test("computer use helper client falls back to legacy env when state file is unavailable", () => {
  const connection = resolveHelperConnection(
    {
      TERMCANVAS_COMPUTER_USE_STATE_FILE: "/tmp/missing-state.json",
      TERMCANVAS_CU_PORT: "11111",
      TERMCANVAS_CU_TOKEN: "env-token",
    },
    () => {
      throw new Error("missing");
    },
  );

  assert.deepEqual(connection, {
    port: 11111,
    token: "env-token",
    stateFilePath: "/tmp/missing-state.json",
  });
});

test("computer use helper client reloads state file for each request", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-cu-state-"));
  const stateFile = path.join(dir, "state.json");
  const previousStateFile = process.env.TERMCANVAS_COMPUTER_USE_STATE_FILE;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; token: string | null }> = [];

  try {
    process.env.TERMCANVAS_COMPUTER_USE_STATE_FILE = stateFile;
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ enabled: true, port: 18101, token: "token-a" }),
    );
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        token:
          init?.headers &&
          typeof init.headers === "object" &&
          !Array.isArray(init.headers)
            ? ((init.headers as Record<string, string>)["X-Token"] ?? null)
            : null,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = new RealHelperClient();
    await client.get("health");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ enabled: true, port: 18102, token: "token-b" }),
    );
    await client.get("health");

    assert.deepEqual(requests, [
      { url: "http://127.0.0.1:18101/health", token: "token-a" },
      { url: "http://127.0.0.1:18102/health", token: "token-b" },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStateFile === undefined) {
      delete process.env.TERMCANVAS_COMPUTER_USE_STATE_FILE;
    } else {
      process.env.TERMCANVAS_COMPUTER_USE_STATE_FILE = previousStateFile;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
