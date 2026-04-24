import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "computer_use_status",
    description:
      "Check whether the Computer Use helper is running and has the required macOS permissions (Accessibility, Screen Recording). " +
      "Call this first before using any other computer use tools to verify the system is ready.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "computer_use_list_apps",
    description:
      "List all running macOS applications with their name, bundle ID, PID, and whether they are the frontmost app. " +
      "Use this to discover which apps are available before interacting with them.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "computer_use_open_app",
    description:
      "Open (launch or activate) a macOS application by bundle ID or name. " +
      "Provide either bundle_id (preferred, e.g. 'com.apple.Safari') or name (e.g. 'Safari'). " +
      "Returns the PID of the opened app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        bundle_id: {
          type: "string",
          description: "The bundle identifier of the app to open (e.g. 'com.apple.Safari')",
        },
        name: {
          type: "string",
          description: "The display name of the app to open (e.g. 'Safari')",
        },
      },
    },
  },
  {
    name: "computer_use_get_app_state",
    description:
      "Get the full accessibility state of a running application: its windows, UI element tree, and optionally a screenshot. " +
      "This is your primary tool for understanding what's on screen. Always call this before clicking or typing " +
      "to get the current UI element IDs and positions. Use include_screenshot=true when you need to see the visual layout. " +
      "max_depth controls how deep the element tree is traversed (default varies by app complexity).",
    inputSchema: {
      type: "object" as const,
      properties: {
        pid: {
          type: "number",
          description: "Process ID of the target application (from list_apps or open_app)",
        },
        include_screenshot: {
          type: "boolean",
          description: "Whether to capture and return a screenshot of the app (default: false)",
        },
        max_depth: {
          type: "number",
          description: "Maximum depth for element tree traversal",
        },
      },
      required: ["pid"],
    },
  },
  {
    name: "computer_use_click",
    description:
      "Click on a UI element in a Mac application. Prefer using element_id (from get_app_state) over raw coordinates — " +
      "element IDs are more reliable and adapt to window position changes. " +
      "Use coordinates only when the element has no accessibility representation. " +
      "After clicking, call get_app_state again to verify the result.",
    inputSchema: {
      type: "object" as const,
      properties: {
        element_id: {
          type: "string",
          description: "Accessibility element ID from get_app_state",
        },
        pid: {
          type: "number",
          description: "Process ID of the target app (required when using element_id)",
        },
        x: {
          type: "number",
          description: "Screen X coordinate (use only when element_id is unavailable)",
        },
        y: {
          type: "number",
          description: "Screen Y coordinate (use only when element_id is unavailable)",
        },
        coordinate_space: {
          type: "string",
          enum: ["screen"],
          description: "Coordinate space for x/y (default: screen)",
        },
        button: {
          type: "string",
          enum: ["left", "right", "double"],
          description: "Mouse button or click type (default: left)",
        },
      },
    },
  },
  {
    name: "computer_use_type_text",
    description:
      "Type text into the currently focused UI element. Make sure the target text field is focused first " +
      "(click on it using computer_use_click). This simulates keyboard input character by character.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The text to type",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "computer_use_press_key",
    description:
      "Press a keyboard key, optionally with modifier keys. " +
      "Use standard key names: 'return', 'tab', 'escape', 'space', 'delete', 'up', 'down', 'left', 'right', " +
      "or single characters like 'a', '1'. " +
      "Modifiers: 'command', 'control', 'option', 'shift'. " +
      "Example: key='c', modifiers=['command'] for Cmd+C.",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: {
          type: "string",
          description: "The key to press (e.g. 'return', 'tab', 'a', 'escape')",
        },
        modifiers: {
          type: "array",
          items: { type: "string" },
          description: "Modifier keys to hold (e.g. ['command', 'shift'])",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "computer_use_scroll",
    description:
      "Scroll within an application. Either provide coordinates (x, y) with scroll deltas (dx, dy), " +
      "or use element_id with a direction. Positive dy scrolls down, negative scrolls up. " +
      "Prefer element_id-based scrolling when targeting a specific scrollable container.",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: {
          type: "number",
          description: "Screen X coordinate of the scroll target",
        },
        y: {
          type: "number",
          description: "Screen Y coordinate of the scroll target",
        },
        dx: {
          type: "number",
          description: "Horizontal scroll delta",
        },
        dy: {
          type: "number",
          description: "Vertical scroll delta",
        },
        element_id: {
          type: "string",
          description: "Accessibility element ID of the scrollable container",
        },
        pid: {
          type: "number",
          description: "Process ID (required when using element_id)",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction (used with element_id)",
        },
        amount: {
          type: "number",
          description: "Scroll amount in pixels (used with element_id + direction)",
        },
      },
    },
  },
  {
    name: "computer_use_drag",
    description:
      "Drag from one point to another, either by coordinates or element IDs. " +
      "Use element IDs when dragging between known UI elements. " +
      "Use coordinates for freeform drag operations like drawing or resizing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from_x: {
          type: "number",
          description: "Starting X coordinate",
        },
        from_y: {
          type: "number",
          description: "Starting Y coordinate",
        },
        to_x: {
          type: "number",
          description: "Ending X coordinate",
        },
        to_y: {
          type: "number",
          description: "Ending Y coordinate",
        },
        from_element_id: {
          type: "string",
          description: "Accessibility element ID to drag from",
        },
        to_element_id: {
          type: "string",
          description: "Accessibility element ID to drag to",
        },
        pid: {
          type: "number",
          description: "Process ID (required when using element IDs)",
        },
      },
    },
  },
  {
    name: "computer_use_stop",
    description:
      "Stop the Computer Use helper process. Use this when you're done with computer use " +
      "and want to release system resources. The helper can be restarted from TermCanvas settings.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];
