import * as fs from "node:fs/promises";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HelperClient } from "./helper-client.js";
import type {
  HealthResponse,
  StatusResponse,
  AppInfo,
  AppState,
  OkResponse,
  OpenAppResponse,
} from "./types.js";
import {
  COMPUTER_USE_STATUS_GUIDANCE,
  readComputerUseInstructions,
} from "./instructions.js";

function textResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function plainTextResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  try {
    switch (name) {
      case "status":
      case "computer_use_status":
        return await handleStatus(client);
      case "get_instructions":
      case "computer_use_get_instructions":
        return plainTextResult(readComputerUseInstructions());
      case "list_apps":
      case "computer_use_list_apps":
        return await handleListApps(client);
      case "open_app":
      case "computer_use_open_app":
        return await handleOpenApp(args, client);
      case "get_app_state":
      case "computer_use_get_app_state":
        return await handleGetAppState(args, client);
      case "click":
      case "computer_use_click":
        return await handleClick(args, client);
      case "type_text":
      case "computer_use_type_text":
        return await handleTypeText(args, client);
      case "press_key":
      case "computer_use_press_key":
        return await handlePressKey(args, client);
      case "scroll":
      case "computer_use_scroll":
        return await handleScroll(args, client);
      case "drag":
      case "computer_use_drag":
        return await handleDrag(args, client);
      case "set_value":
      case "computer_use_set_value":
        return await handleSetValue(args, client);
      case "perform_secondary_action":
      case "computer_use_perform_secondary_action":
        return await handlePerformSecondaryAction(args, client);
      case "stop":
      case "computer_use_stop":
        return await handleStop(client);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(message);
  }
}

async function handleStatus(client: HelperClient): Promise<CallToolResult> {
  let healthy = false;
  let accessibilityGranted = false;
  let screenRecordingGranted = false;

  try {
    const health = (await client.get("health")) as HealthResponse;
    healthy = health.ok === true;
  } catch {
    return textResult({
      healthy: false,
      accessibility_granted: false,
      screen_recording_granted: false,
      usage_guidance: COMPUTER_USE_STATUS_GUIDANCE,
    });
  }

  try {
    const status = (await client.post("status")) as StatusResponse;
    accessibilityGranted = status.accessibility_granted;
    screenRecordingGranted = status.screen_recording_granted;
  } catch {
    // health passed but status failed
  }

  return textResult({
    healthy,
    accessibility_granted: accessibilityGranted,
    screen_recording_granted: screenRecordingGranted,
    usage_guidance: COMPUTER_USE_STATUS_GUIDANCE,
  });
}

async function handleListApps(client: HelperClient): Promise<CallToolResult> {
  const result = (await client.post("list_apps")) as { apps: AppInfo[] };
  return textResult(result.apps);
}

async function handleOpenApp(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post("open_app", args)) as OpenAppResponse;
  return textResult(result);
}

async function handleGetAppState(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const request = {
    include_screenshot: true,
    ...args,
  };
  const state = (await client.post("get_app_state", request)) as AppState;

  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify(state, null, 2) },
  ];

  const screenshotPath =
    state.screenshot_path ??
    (typeof state.screenshot === "object" && state.screenshot !== null
      ? (state.screenshot as { path?: string }).path
      : undefined);

  if (screenshotPath) {
    try {
      const imageData = await fs.readFile(screenshotPath);
      content.push({
        type: "image",
        data: imageData.toString("base64"),
        mimeType: "image/png",
      });
    } catch {
      content.push({
        type: "text",
        text: `(screenshot at ${screenshotPath} could not be read)`,
      });
    }
  }

  return { content };
}

async function handleClick(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post("click", args)) as OkResponse;
  return textResult(result);
}

async function handleTypeText(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post("type_text", args)) as OkResponse;
  return textResult(result);
}

async function handlePressKey(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post("press_key", args)) as OkResponse;
  return textResult(result);
}

async function handleSetValue(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post("set_value", args)) as OkResponse;
  return textResult(result);
}

async function handlePerformSecondaryAction(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post(
    "perform_secondary_action",
    args,
  )) as OkResponse;
  return textResult(result);
}

async function handleScroll(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post("scroll", args)) as OkResponse;
  return textResult(result);
}

async function handleDrag(
  args: Record<string, unknown>,
  client: HelperClient,
): Promise<CallToolResult> {
  const result = (await client.post("drag", args)) as OkResponse;
  return textResult(result);
}

async function handleStop(client: HelperClient): Promise<CallToolResult> {
  const result = (await client.post("stop")) as OkResponse;
  return textResult(result);
}
