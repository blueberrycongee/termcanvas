# TermCanvas Computer Use

TermCanvas provides AX-first Computer Use through MCP tools. Use it when the user asks you to operate a local Mac desktop application such as Spotify, NetEase Cloud Music, Finder, System Settings, or another GUI app.

## Tool Routing

- Use TermCanvas Computer Use for local macOS desktop apps and system UI. This includes Spotify, NetEase Cloud Music, Finder, System Settings, Activity Monitor, desktop chat apps, editors, and other GUI apps.
- Do not use browser automation, Playwright, or browser screenshots for macOS desktop apps. Browser tools are only for web pages inside a browser.
- Shell commands may supplement diagnosis or provide non-GUI data, but they do not replace desktop control when the user asked you to operate an app, unless the app cannot be controlled or the user accepts the fallback.

## Operating Protocol

1. Call `status` first. If the helper is not healthy or macOS Accessibility / Screen Recording permissions are missing, call `setup` and wait for the user to approve the macOS permission flow.
2. After permission approval, call `status` again. Do not continue app-control attempts while either permission is false.
3. Call `list_apps` to identify the target app. Prefer the returned `bundle_id` or `pid` for follow-up calls. Use localized display names exactly as returned by `list_apps`; do not guess English app names on a non-English system.
4. Call `list_windows` when the target has or may have multiple windows. Prefer `pid` + `window_id` with `get_window_state` when available; use `get_app_state` only as the app-level compatibility path.
5. Call `get_config` when capture behavior matters. `capture_mode="som"` returns AX plus screenshot, `"vision"` returns screenshot only for sparse/canvas workflows, and `"ax"` returns AX only when screenshots are unnecessary.
6. Before every desktop interaction, call `get_window_state` for the target window or `get_app_state` for the target app. Treat the returned AX tree and returned window screenshot as the source of truth for current UI.
7. If `get_app_state` returns no windows, no screenshot, or an unexpectedly sparse tree, do not immediately conclude the app is inaccessible. Re-activate with `open_app`, retry with the `bundle_id` or `pid` from `list_apps`, and observe again. Increase `max_depth` when deeper controls are needed.
8. Choose actions in this order: direct AX action/value, AX element click/scroll/drag, keyboard navigation/input, screenshot-coordinate fallback.
9. Prefer direct AX operations over simulated input. Use `set_value` for writable text fields and `perform_secondary_action` for exposed actions such as `AXPress`, `AXShowMenu`, or other actions listed on the element.
10. Use keyboard input when AX exposes focusable controls but not a direct action: focus the target field/control first, then use `type_text` or `press_key`.
11. Use screenshots to understand visual state. Use screenshot coordinates only as the last resort for canvas-rendered or non-AX UI. When using coordinates read from the returned `get_app_state` screenshot, set `coordinate_space="screenshot"` and pass the returned `capture_id` when available.
12. After every action, call `get_app_state` again and verify the expected UI state changed. Do not say the task is complete until the latest observed state supports it.
13. Ask the user before destructive or privacy-sensitive actions, purchases, sending messages, sharing data, changing security settings, or anything that could have real-world side effects beyond ordinary navigation/playback.

## Action Hierarchy

- Use `perform_secondary_action` when the target element exposes a semantic action that matches the intent. When the element came from `get_window_state`, pass the same `window_id` with `element_index`.
- Use `set_value` when the target is a writable text field or value control.
- Use `click` with an AX element index when the target is visible in the AX tree but has no better semantic action.
- Use `scroll` or `drag` with AX element indexes when the scrollable or draggable target is represented in AX.
- Use `press_key` and `type_text` when keyboard navigation is the natural app workflow or AX only exposes focus. Pass `pid` whenever available so keyboard events target the intended app instead of the user's frontmost app.
- Use coordinate clicks, drags, or scrolls only when AX and keyboard paths are unavailable or unsuitable.
- For coordinate actions against a background app, pass both `pid` and `window_id` when available so the helper can use its pid-targeted no-focus-steal path instead of relying on the frontmost app.

## Observation Rules

- Observe the target app, not the terminal or browser you are running from.
- Prefer `bundle_id` or `pid` from `list_apps` when there is any ambiguity, localization, duplicate app name, helper process, or launcher process.
- Sparse AX trees are common in custom-rendered apps, Electron/Chromium apps, media apps, games, and canvases. Use the screenshot to understand state, but still use AX for any controls that are exposed.
- CEF/Chromium apps can keep exposing only window chrome or generic groups even after `AXManualAccessibility` is enabled. After one re-observe with the same `bundle_id` or `pid`, treat that as a real sparse-tree limit instead of searching for non-existent AX controls.
- Empty windows or missing screenshots can be transient after launch, activation, Space changes, minimized windows, full-screen transitions, or permission repair. Re-open/re-activate and re-observe before declaring a limitation.
- If an app shows multiple windows or sheets, act on the currently relevant window and re-observe after focus changes.

## macOS Permission Repair

- Treat `status` as the source of truth. Do not assume System Settings is correct if `status` still reports `accessibility_granted=false` or `screen_recording_granted=false`.
- If `setup` opened System Settings and the user says they already allowed permissions, tell them to remove stale entries before adding them again. Do not keep retrying app-control tools while either permission is false.
- In both Accessibility and Screen Recording / Screen & System Audio Recording, ask the user to remove existing `TermCanvas` and `computer-use-helper` entries if present.
- Then ask the user to add and enable `/Applications/TermCanvas.app` and `/Applications/TermCanvas.app/Contents/Resources/computer-use-helper`.
- After the user finishes, call `status` again. Continue only when the helper is healthy and both permissions are true.

## Tool Map

- `status`: check helper health and macOS permissions.
- `setup`: start Computer Use through TermCanvas, request required macOS permissions, and open System Settings when user approval is needed. If permissions remain false after approval, follow the macOS permission repair flow above.
- `get_instructions`: read this operating protocol from the MCP server.
- `get_config`: read persistent capture behavior such as `capture_mode` and `max_image_dimension`.
- `set_config`: persist capture behavior. Use `capture_mode="vision"` for screenshot-only CEF/canvas workflows and `"ax"` for AX-only workflows.
- `list_apps`: list running Mac apps with names, bundle IDs, PIDs, and frontmost state.
- `list_windows`: list addressable top-level windows with `window_id`, owning app, title, bounds, z-order, and on-screen state.
- `get_screen_size`: return main display pixel size and scale.
- `screenshot`: capture the main display, an app window, or a specific `window_id` as MCP image content. ScreenCaptureKit is the primary path on supported macOS versions.
- `zoom`: crop and return a zoomed region from the latest screenshot; after zooming, use `click` with `from_zoom=true` to click coordinates from the zoom image.
- `open_app`: legacy launch-or-activate path.
- `launch_app`: launch an app without intentionally activating it; prefer this for background Computer Use workflows.
- `get_app_state`: return the app's current key-window state according to `capture_mode`.
- `get_window_state`: return a specific window's state by `pid` and `window_id` according to `capture_mode`.
- `click`: click by AX element index first, or by coordinates as fallback.
- `set_value`: assign text/value directly to a writable AX element.
- `perform_secondary_action`: invoke an AX action exposed by an element.
- `type_text`: type literal text into the focused element.
- `type_text_chars`: type text character-by-character; use with `pid` for Chromium/Electron fields when AX value setting is unavailable.
- `press_key`: press a key or shortcut such as `Return`, `Tab`, `super+c`, or `Up`.
- `hotkey`: press a key combination such as `["cmd", "c"]`, preferably with `pid`.
- `double_click`: double-click by element or coordinates.
- `right_click`: right-click by element or coordinates; prefer `perform_secondary_action` with `AXShowMenu` when available.
- `scroll`: scroll an AX element or coordinate target.
- `drag`: drag between element indexes or coordinates.
- `stop`: stop the Computer Use helper.

## Decision Rules

- If the AX tree exposes the target control, use the element index. Prefer `element_index` plus the same `window_id` returned by `get_window_state`; do not switch to coordinates just because coordinates are easier.
- If an AX element exposes a semantic action, prefer `perform_secondary_action` over raw click.
- If a text field is writable through AX, prefer `set_value` over click-and-type.
- If the AX tree is sparse, stale, or only exposes window chrome, use the returned screenshot and keyboard shortcuts before falling back to coordinate clicks. For CEF/WebGL/media surfaces such as Spotify, screenshot-coordinate clicks may be the correct fallback once AX and keyboard paths are unavailable.
- If the app opens a permission dialog, modal sheet, or system confirmation, observe it with `get_app_state` and follow the user's intent; do not bypass user confirmation.
- If an action fails or the UI does not change after verification, re-observe and choose another path. Do not repeat the same click blindly.
- Do not use memory from previous observations after a window moved, resized, changed tabs, changed Space, or changed focus. Re-observe and recalculate the target.

## Coordinate Fallback Rules

Coordinates are allowed, but they are the fallback path:

1. Use coordinates only after checking that AX does not expose a usable target.
2. Use `coordinate_space="screenshot"` only for positions read from the screenshot returned by `get_app_state` for the same app and same observation.
3. Keep coordinate actions small and verify immediately afterward.
4. If the window moves, resizes, or focus changes, discard old coordinates and call `get_app_state` again.
5. Pass the returned screenshot `capture_id` with coordinate actions when available. If a stale `capture_id` is rejected, call `get_app_state` again and retry with the current screenshot.
6. Do not pass coordinates from browser screenshots, Playwright screenshots, full-screen screenshots, screenshots from other tools, or stale screenshots as `coordinate_space="screenshot"`. Use only coordinates from the current `get_app_state` screenshot, or use `coordinate_space="screen"` when you have actual screen coordinates.
7. When debugging coordinate math, pass `debug_image_out` on a pixel `click` to write a PNG with a red crosshair at the coordinate the helper received.

## Completion Standard

A desktop task is complete only when the latest observed state supports it. For example, after starting music playback, verify a visible playing state, changed play/pause control, now-playing indicator, or another reliable UI signal. If the app does not expose enough state to verify confidently, say what you observed and what remains uncertain.
