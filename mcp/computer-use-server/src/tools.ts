import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { COMPUTER_USE_PROTOCOL_SUMMARY } from "./instructions.js";

const ACTION_GUARDRAIL =
  "Before acting, call get_app_state for the target app in this turn. After acting, call get_app_state again and verify the UI changed before reporting success.";

const COORDINATE_GUARDRAIL =
  "coordinate_space=screenshot is only for coordinates read from the current get_app_state screenshot for the same app. Pass capture_id from that screenshot when available so stale coordinates can be rejected. Do not use browser, Playwright, full-screen, or stale screenshot coordinates as screenshot coordinates.";

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
      "Read the TermCanvas Computer Use operating protocol. Call this before the first local desktop automation task in a session, when multiple automation tools are available, or whenever the correct AX-first workflow is unclear.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "setup",
    description:
      "Start TermCanvas Computer Use, request required macOS Accessibility and Screen Recording permissions, and open the macOS permission panes when approval is still needed. Call this when status reports the helper is unhealthy, not running, or permissions are missing before attempting desktop control. If permissions remain false after approval, guide stale macOS permission repair instead of retrying blindly.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_config",
    description:
      "Read persistent TermCanvas Computer Use configuration, including capture_mode (som, vision, ax) and max_image_dimension. Use this when choosing whether observations should return AX, screenshots, or both.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "set_config",
    description:
      "Persist TermCanvas Computer Use configuration. capture_mode=som returns AX plus screenshots, vision skips AX and returns screenshots only, ax skips screenshots and returns AX only. max_image_dimension caps screenshot long edge; 0 disables downscaling.",
    inputSchema: {
      type: "object" as const,
      properties: {
        capture_mode: {
          type: "string",
          enum: ["som", "vision", "ax", "screenshot"],
          description:
            "Observation mode. screenshot is accepted as a deprecated alias for vision.",
        },
        max_image_dimension: {
          type: "number",
          description:
            "Maximum screenshot long edge in pixels. Set 0 to keep native resolution.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_recording",
    description:
      "Enable or disable trajectory recording for Computer Use action tools. When enabled, action calls are written as turn-000001/action.json files under output_dir. This records tool trajectories, not video.",
    inputSchema: {
      type: "object" as const,
      properties: {
        enabled: {
          type: "boolean",
          description: "True to start recording; false to stop.",
        },
        output_dir: {
          type: "string",
          description: "Directory for session.json and turn-*/action.json files. Required when enabled=true.",
        },
        video_experimental: {
          type: "boolean",
          description: "Reserved for future video recording. Currently rejected when true.",
        },
      },
      required: ["enabled"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recording_state",
    description:
      "Return whether Computer Use trajectory recording is enabled, its output_dir, and the next turn number.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "replay_trajectory",
    description:
      "Replay a trajectory directory previously written by set_recording. The replay executes each recorded action tool in turn; set stop_on_error=false to continue after failures.",
    inputSchema: {
      type: "object" as const,
      properties: {
        input_dir: {
          type: "string",
          description: "Recording directory containing turn-*/action.json files.",
        },
        stop_on_error: {
          type: "boolean",
          description: "Stop on first tool error. Defaults to true.",
        },
      },
      required: ["input_dir"],
      additionalProperties: false,
    },
  },
  {
    name: "list_apps",
    description:
      "List running macOS applications with localized name, bundle ID, PID, and frontmost status. Call status first and call setup if the helper is unavailable or permissions are missing. Prefer returned bundle IDs or PIDs for later calls instead of guessing app names.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_windows",
    description:
      "List addressable top-level macOS windows with window_id, owning pid/app, title, bounds, z-order, and on-screen state. Use this before window-scoped observation or pixel actions; do not guess which window an app means when multiple windows exist.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pid: {
          type: "number",
          description: "Optional process ID filter from list_apps.",
        },
        on_screen_only: {
          type: "boolean",
          description: "When true, return only windows currently on screen.",
        },
      },
    },
  },
  {
    name: "get_screen_size",
    description:
      "Return the main display pixel size and backing scale. Use this for screen-level reasoning only; prefer window screenshots and window_id-scoped actions for app control.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "screenshot",
    description:
      "Capture a screenshot as MCP image content. ScreenCaptureKit is the primary capture path on supported macOS versions, with CoreGraphics fallback when unavailable. With pid + window_id, captures that specific window; with pid only, captures the app's topmost layer-0 window; with no target, captures the main display.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pid: {
          type: "number",
          description: "Optional process ID of the app to capture.",
        },
        window_id: {
          type: "number",
          description: "Optional CGWindowID from list_windows. Requires pid.",
        },
      },
    },
  },
  {
    name: "zoom",
    description:
      "Crop and return a zoomed region from the latest screenshot for a target pid. Coordinates are screenshot pixels from get_window_state or screenshot. After zoom, click with from_zoom=true using coordinates from the zoom image.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pid: { type: "number", description: "Target process ID." },
        capture_id: { type: "string", description: "Optional source screenshot capture_id to reject stale zoom requests." },
        x1: { type: "number", description: "Left edge in source screenshot pixels." },
        y1: { type: "number", description: "Top edge in source screenshot pixels." },
        x2: { type: "number", description: "Right edge in source screenshot pixels." },
        y2: { type: "number", description: "Bottom edge in source screenshot pixels." },
      },
      required: ["pid", "x1", "y1", "x2", "y2"],
    },
  },
  {
    name: "open_app",
    description:
      "Launch or activate a macOS application by bundle ID or display name. Prefer bundle_id when known; otherwise use the exact localized name returned by list_apps.",
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
    name: "launch_app",
    description:
      "Launch a macOS application without intentionally activating it. Prefer this over open_app for background Computer Use workflows where the user's frontmost app should not change.",
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
      "Observe before acting: start an app use session if needed, then get the app key-window state according to persistent capture_mode. Default som returns indexed Accessibility tree and screenshot; vision returns screenshot only; ax returns AX only. Use this for local macOS apps; do not use browser or Playwright screenshots for desktop apps. Prefer bundle_id or pid from list_apps for localized or ambiguous apps. If the tree is empty or sparse, re-activate/open the app and observe again before declaring a limitation. Coordinate fallbacks should pass the returned screenshot capture_id.",
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
    name: "get_window_state",
    description:
      "Observe a specific macOS window by pid and window_id from list_windows. This is the window-scoped successor to get_app_state: default capture_mode=som returns the target window's AX tree, Space membership, and screenshot without silently choosing a different window; vision returns screenshot only; ax returns AX only. Call this before element-indexed or screenshot-coordinate actions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pid: {
          type: "number",
          description: "Target process ID from list_apps or list_windows.",
        },
        window_id: {
          type: "number",
          description: "CGWindowID from list_windows.",
        },
        include_screenshot: {
          type: "boolean",
          description: "Whether to capture and return the target window screenshot. Defaults to true.",
        },
        max_depth: {
          type: "number",
          description: "Maximum accessibility tree traversal depth.",
        },
      },
      required: ["pid", "window_id"],
    },
  },
  {
    name: "click",
    description:
      `Click an element by integer index or pixel coordinates. Prefer AX element indexes from get_app_state; coordinates are the last resort. When pid/window_id are provided, pixel clicks are delivered through the target pid path to avoid activating or raising the app unless the target is already frontmost. Use debug_image_out to write a crosshair PNG when diagnosing coordinate math. ${COORDINATE_GUARDRAIL} ${ACTION_GUARDRAIL}`,
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
          description: "Integer element index from get_app_state or get_window_state.",
        },
        element_index: {
          type: "number",
          description: "Element index from get_window_state. Prefer with window_id for stable snapshot-scoped actions.",
        },
        element_id: {
          type: "string",
          description: "Legacy accessibility element ID from get_app_state.",
        },
        window_id: {
          type: "number",
          description: "CGWindowID whose get_window_state produced element_index.",
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
        capture_id: {
          type: "string",
          description:
            "Capture ID from the current get_app_state screenshot. Use with coordinate_space=screenshot to reject stale screenshot coordinates.",
        },
        click_count: {
          type: "number",
          description: "Number of clicks. Defaults to 1.",
        },
        from_zoom: {
          type: "boolean",
          description: "When true, x/y are coordinates in the latest zoom image for this pid and are mapped back to the source screenshot.",
        },
        mouse_button: {
          type: "string",
          enum: ["left", "right", "double"],
          description: "Mouse button or click type. Defaults to left.",
        },
        debug_image_out: {
          type: "string",
          description:
            "Optional absolute PNG path for pixel clicks. The helper writes the latest target screenshot with a red crosshair at the received coordinate before dispatching the click. Use with coordinate_space=screenshot or coordinate_space=window when debugging coordinate math.",
        },
      },
    },
  },
  {
    name: "double_click",
    description:
      `Double-click an element or coordinates. This is a convenience wrapper over click with mouse_button=double and uses the same pid/window_id no-focus-steal pixel path when targeting a background app. ${COORDINATE_GUARDRAIL} ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        pid: { type: "number", description: "Target process ID." },
        app_name: { type: "string", description: "Target app name or bundle ID." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
        element_index: { type: "number", description: "Element index from get_window_state." },
        element: { type: "number", description: "Legacy element index." },
        x: { type: "number", description: "X coordinate." },
        y: { type: "number", description: "Y coordinate." },
        coordinate_space: { type: "string", enum: ["screen", "window", "screenshot"] },
        capture_id: { type: "string", description: "Capture ID for screenshot coordinates." },
        from_zoom: { type: "boolean", description: "Map x/y from the latest zoom image back to the source screenshot." },
        debug_image_out: { type: "string", description: "Optional absolute PNG path for coordinate debug crosshair output." },
      },
    },
  },
  {
    name: "right_click",
    description:
      `Right-click an element or coordinates. Prefer perform_secondary_action with AXShowMenu when AX exposes it. Coordinate right-clicks use the same pid/window_id no-focus-steal pixel path when targeting a background app. ${COORDINATE_GUARDRAIL} ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        pid: { type: "number", description: "Target process ID." },
        app_name: { type: "string", description: "Target app name or bundle ID." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
        element_index: { type: "number", description: "Element index from get_window_state." },
        element: { type: "number", description: "Legacy element index." },
        x: { type: "number", description: "X coordinate." },
        y: { type: "number", description: "Y coordinate." },
        coordinate_space: { type: "string", enum: ["screen", "window", "screenshot"] },
        capture_id: { type: "string", description: "Capture ID for screenshot coordinates." },
        from_zoom: { type: "boolean", description: "Map x/y from the latest zoom image back to the source screenshot." },
        debug_image_out: { type: "string", description: "Optional absolute PNG path for coordinate debug crosshair output." },
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
        element_index: { type: "number", description: "Element index from get_window_state." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
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
        element_index: { type: "number", description: "Element index from get_window_state." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
        element_id: { type: "string", description: "Legacy element ID." },
        value: { type: "string", description: "Value to assign." },
      },
      required: ["value"],
    },
  },
  {
    name: "type_text",
    description:
      `Type literal text using keyboard input. Prefer set_value for writable AX elements. Pass pid to deliver keyboard events to a target process instead of the frontmost app; with element_index + window_id, the helper focuses the cached element first. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to type." },
        pid: { type: "number", description: "Optional target process ID for pid-routed keyboard events." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
        element_index: { type: "number", description: "Optional cached element index to focus before typing." },
      },
      required: ["text"],
    },
  },
  {
    name: "type_text_chars",
    description:
      "Type text character-by-character. This is currently the same pid-routed keyboard path as type_text; use it for Chromium/Electron fields when AX set_value is unavailable.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to type." },
        pid: { type: "number", description: "Optional target process ID for pid-routed keyboard events." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
        element_index: { type: "number", description: "Optional cached element index to focus before typing." },
      },
      required: ["text"],
    },
  },
  {
    name: "press_key",
    description:
      `Press a key or key-combination. Supports xdotool-like syntax such as Return, Tab, super+c, Up, KP_0. Pass pid to deliver the key to a target process instead of the frontmost app; with element_index + window_id, the helper focuses the cached element first. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "Key or key-combination to press." },
        pid: { type: "number", description: "Optional target process ID for pid-routed keyboard events." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
        element_index: { type: "number", description: "Optional cached element index to focus before pressing the key." },
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
    name: "hotkey",
    description:
      `Press a key combination such as ["cmd","c"] or ["cmd","shift","g"]. Pass pid to target a process instead of the frontmost app. ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Modifier keys plus one final non-modifier key.",
        },
        pid: { type: "number", description: "Optional target process ID for pid-routed keyboard events." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
        element_index: { type: "number", description: "Optional cached element index to focus before pressing the hotkey." },
      },
      required: ["keys"],
    },
  },
  {
    name: "scroll",
    description:
      `Scroll an AX element or screen coordinate in a direction by a number of pages. Prefer element indexes; coordinate scrolling is a fallback when AX does not expose a scrollable target. ${COORDINATE_GUARDRAIL} ${ACTION_GUARDRAIL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        app_name: { type: "string", description: "Target app name or bundle ID." },
        pid: { type: "number", description: "Target app process ID." },
        element: { type: "number", description: "Integer element index." },
        element_index: { type: "number", description: "Element index from get_window_state." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced element_index." },
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
        capture_id: {
          type: "string",
          description:
            "Capture ID from the current get_app_state screenshot. Use with coordinate_space=screenshot to reject stale screenshot coordinates.",
        },
      },
      required: ["direction"],
    },
  },
  {
    name: "drag",
    description:
      `Drag from one point to another using element indexes or pixel coordinates. Prefer element indexes when available; coordinate dragging is a fallback for non-AX UI. ${COORDINATE_GUARDRAIL} ${ACTION_GUARDRAIL}`,
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
        from_element_index: { type: "number", description: "Starting element index from get_window_state." },
        to_element_index: { type: "number", description: "Ending element index from get_window_state." },
        window_id: { type: "number", description: "CGWindowID whose get_window_state produced the element indexes." },
        from_element_id: { type: "string", description: "Legacy starting element ID." },
        to_element_id: { type: "string", description: "Legacy ending element ID." },
        coordinate_space: {
          type: "string",
          enum: ["screen", "window", "screenshot"],
          description: "Coordinate space for coordinates. Defaults to screen.",
        },
        capture_id: {
          type: "string",
          description:
            "Capture ID from the current get_app_state screenshot. Use with coordinate_space=screenshot to reject stale screenshot coordinates.",
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
