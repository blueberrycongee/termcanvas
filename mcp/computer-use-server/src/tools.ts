import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { COMPUTER_USE_PROTOCOL_SUMMARY } from "./instructions.js";

const ACTION_GUARDRAIL =
  "Before acting, call get_app_state for the target app in this turn. After acting, call get_app_state again and verify the UI changed before reporting success.";

export const tools: Tool[] = [
  {
    name: "status",
    description:
      `Check whether the Computer Use helper is running and has macOS Accessibility and Screen Recording permissions. ${COMPUTER_USE_PROTOCOL_SUMMARY}`,
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_instructions",
    description:
      "Read the TermCanvas Computer Use operating protocol. Call this before the first local desktop automation task in a session, or whenever the correct AX-first workflow is unclear.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_apps",
    description:
      "List running macOS applications with name, bundle ID, PID, and frontmost status.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "open_app",
    description:
      "Launch or activate a macOS application by bundle ID or display name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        bundle_id: {
          type: "string",
          description: "Bundle identifier, for example com.apple.Safari.",
        },
        name: {
          type: "string",
          description: "Display name, for example Safari.",
        },
      },
    },
  },
  {
    name: "get_app_state",
    description:
      "Observe before acting: start an app use session if needed, then get the app key-window state, indexed Accessibility tree, and screenshot. Use the returned AX element indexes first; use the screenshot to understand state and as coordinate fallback only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "App name or bundle ID, for example Safari or com.apple.Safari.",
        },
        pid: {
          type: "number",
          description: "Process ID from list_apps or open_app. Prefer app_name unless you need a specific process.",
        },
        include_screenshot: {
          type: "boolean",
          description: "Whether to capture and return a screenshot. Defaults to true.",
        },
        max_depth: {
          type: "number",
          description: "Maximum accessibility tree traversal depth.",
        },
      },
    },
  },
  {
    name: "click",
    description:
      `Click an element by integer index or pixel coordinates. Prefer AX element indexes from get_app_state; coordinates are the last resort. Use coordinate_space=screenshot for x/y from the returned screenshot. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: {
          type: "string",
          description: "Target app name or bundle ID.",
        },
        pid: {
          type: "number",
          description: "Target app process ID.",
        },
        element: {
          type: "number",
          description: "Integer element index from get_app_state.",
        },
        element_id: {
          type: "string",
          description: "Legacy accessibility element ID from get_app_state.",
        },
        x: {
          type: "number",
          description: "X coordinate in screen, window, or screenshot space.",
        },
        y: {
          type: "number",
          description: "Y coordinate in screen, window, or screenshot space.",
        },
        coordinate_space: {
          type: "string",
          enum: ["screen", "window", "screenshot"],
          description: "Coordinate space for x/y. Defaults to screen.",
        },
        click_count: {
          type: "number",
          description: "Number of clicks. Defaults to 1.",
        },
        mouse_button: {
          type: "string",
          enum: ["left", "right", "double"],
          description: "Mouse button or click type. Defaults to left.",
        },
      },
    },
  },
  {
    name: "perform_secondary_action",
    description:
      `Invoke a secondary Accessibility action exposed by an element, such as AXPress or AXShowMenu. Prefer this over coordinate clicking when the target element exposes a usable AX action. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: { type: "string", description: "Target app name or bundle ID." },
        pid: { type: "number", description: "Target app process ID." },
        element: { type: "number", description: "Integer element index." },
        element_id: { type: "string", description: "Legacy element ID." },
        action: {
          type: "string",
          description: "Accessibility action name, for example AXPress or AXShowMenu.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "set_value",
    description:
      `Set the value of a settable Accessibility element. Prefer this over keyboard typing when get_app_state shows a writable AX element. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: { type: "string", description: "Target app name or bundle ID." },
        pid: { type: "number", description: "Target app process ID." },
        element: { type: "number", description: "Integer element index." },
        element_id: { type: "string", description: "Legacy element ID." },
        value: { type: "string", description: "Value to assign." },
      },
      required: ["value"],
    },
  },
  {
    name: "type_text",
    description:
      `Type literal text using keyboard input into the focused element. Prefer set_value for writable AX elements; use type_text after focusing a field when set_value is unavailable. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to type." },
      },
      required: ["text"],
    },
  },
  {
    name: "press_key",
    description:
      `Press a key or key-combination. Supports xdotool-like syntax such as Return, Tab, super+c, Up, KP_0. Use keyboard paths when AX exposes focus but not direct actions. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "Key or key-combination to press." },
        modifiers: {
          type: "array",
          items: { type: "string" },
          description: "Optional legacy modifier names such as command, shift, option, control.",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "scroll",
    description:
      `Scroll an AX element or screen coordinate in a direction by a number of pages. Prefer element indexes; coordinate scrolling is a fallback when AX does not expose a scrollable target. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: { type: "string", description: "Target app name or bundle ID." },
        pid: { type: "number", description: "Target app process ID." },
        element: { type: "number", description: "Integer element index." },
        element_id: { type: "string", description: "Legacy element ID." },
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction.",
        },
        amount: {
          type: "number",
          description: "Scroll amount in pages for element scrolling. Defaults to 1.",
        },
        x: { type: "number", description: "Coordinate X for coordinate scrolling." },
        y: { type: "number", description: "Coordinate Y for coordinate scrolling." },
        dx: { type: "number", description: "Horizontal scroll delta." },
        dy: { type: "number", description: "Vertical scroll delta." },
        coordinate_space: {
          type: "string",
          enum: ["screen", "window", "screenshot"],
          description: "Coordinate space for x/y. Defaults to screen.",
        },
      },
      required: ["direction"],
    },
  },
  {
    name: "drag",
    description:
      `Drag from one point to another using element indexes or pixel coordinates. Prefer element indexes when available; coordinate dragging is a fallback for non-AX UI. Use coordinate_space=screenshot for screenshot-derived coordinates. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: { type: "string", description: "Target app name or bundle ID." },
        pid: { type: "number", description: "Target app process ID." },
        start_x: { type: "number", description: "Starting X coordinate." },
        start_y: { type: "number", description: "Starting Y coordinate." },
        end_x: { type: "number", description: "Ending X coordinate." },
        end_y: { type: "number", description: "Ending Y coordinate." },
        from_x: { type: "number", description: "Legacy starting X coordinate." },
        from_y: { type: "number", description: "Legacy starting Y coordinate." },
        to_x: { type: "number", description: "Legacy ending X coordinate." },
        to_y: { type: "number", description: "Legacy ending Y coordinate." },
        from_element: { type: "number", description: "Starting element index." },
        to_element: { type: "number", description: "Ending element index." },
        from_element_id: { type: "string", description: "Legacy starting element ID." },
        to_element_id: { type: "string", description: "Legacy ending element ID." },
        coordinate_space: {
          type: "string",
          enum: ["screen", "window", "screenshot"],
          description: "Coordinate space for coordinates. Defaults to screen.",
        },
      },
    },
  },
  {
    name: "stop",
    description: "Stop the Computer Use helper process and release system resources.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];
