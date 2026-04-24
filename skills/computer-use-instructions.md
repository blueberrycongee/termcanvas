# TermCanvas Computer Use

TermCanvas provides AX-first Computer Use through MCP tools. Use it when the user asks you to operate a local Mac desktop application such as Spotify, NetEase Cloud Music, Finder, System Settings, or another GUI app.

## Tool Routing

- Use TermCanvas Computer Use for local macOS desktop apps and system UI. This includes Spotify, NetEase Cloud Music, Finder, System Settings, Activity Monitor, desktop chat apps, editors, and other GUI apps.
- Do not use browser automation, Playwright, or browser screenshots for macOS desktop apps. Browser tools are only for web pages inside a browser.
- Shell commands may supplement diagnosis or provide non-GUI data, but they do not replace desktop control when the user asked you to operate an app, unless the app cannot be controlled or the user accepts the fallback.

## Operating Protocol

1. Call `status` first. If the helper is not healthy or macOS Accessibility / Screen Recording permissions are missing, call `setup` and wait for the user to approve the macOS permission flow.
2. After permission approval, call `status` again. Do not continue app-control attempts while either permission is false.
3. Call `list_apps` to identify the target. Prefer the returned `bundle_id` or `pid` for follow-up calls. Use localized display names exactly as returned by `list_apps`; do not guess English app names on a non-English system.
4. Call `open_app` with a bundle ID when available. If only a display name is available, call `open_app` with that exact name. Then call `get_app_state`.
5. Before every desktop interaction, call `get_app_state` for the target app. Treat the returned AX tree and returned window screenshot as the source of truth for that app's current UI.
6. If `get_app_state` returns no windows, no screenshot, or an unexpectedly sparse tree, do not immediately conclude the app is inaccessible. Re-activate with `open_app`, retry with the `bundle_id` or `pid` from `list_apps`, and observe again. Increase `max_depth` when deeper controls are needed.
7. Choose actions in this order: direct AX action/value, AX element click/scroll/drag, keyboard navigation/input, screenshot-coordinate fallback.
8. Prefer direct AX operations over simulated input. Use `set_value` for writable text fields and `perform_secondary_action` for exposed actions such as `AXPress`, `AXShowMenu`, or other actions listed on the element.
9. Use keyboard input when AX exposes focusable controls but not a direct action: focus the target field/control first, then use `type_text` or `press_key`.
10. Use screenshots to understand visual state. Use screenshot coordinates only as the last resort for canvas-rendered or non-AX UI. When using coordinates read from the returned `get_app_state` screenshot, set `coordinate_space="screenshot"`.
11. After every action, call `get_app_state` again and verify the expected UI state changed. Do not say the task is complete until the latest observed state supports it.
12. Ask the user before destructive or privacy-sensitive actions, purchases, sending messages, sharing data, changing security settings, or anything that could have real-world side effects beyond ordinary navigation/playback.

## Action Hierarchy

- Use `perform_secondary_action` when the target element exposes a semantic action that matches the intent.
- Use `set_value` when the target is a writable text field or value control.
- Use `click` with an AX element index when the target is visible in the AX tree but has no better semantic action.
- Use `scroll` or `drag` with AX element indexes when the scrollable or draggable target is represented in AX.
- Use `press_key` and `type_text` when keyboard navigation is the natural app workflow or AX only exposes focus.
- Use coordinate clicks, drags, or scrolls only when AX and keyboard paths are unavailable or unsuitable.

## Observation Rules

- Observe the target app, not the terminal or browser you are running from.
- Prefer `bundle_id` or `pid` from `list_apps` when there is any ambiguity, localization, duplicate app name, helper process, or launcher process.
- Sparse AX trees are common in custom-rendered apps, Electron/Chromium apps, media apps, games, and canvases. Use the screenshot to understand state, but still use AX for any controls that are exposed.
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
- `list_apps`: list running Mac apps with names, bundle IDs, PIDs, and frontmost state.
- `open_app`: launch or activate an app.
- `get_app_state`: return the app's current key-window AX tree and screenshot.
- `click`: click by AX element index first, or by coordinates as fallback.
- `set_value`: assign text/value directly to a writable AX element.
- `perform_secondary_action`: invoke an AX action exposed by an element.
- `type_text`: type literal text into the focused element.
- `press_key`: press a key or shortcut such as `Return`, `Tab`, `super+c`, or `Up`.
- `scroll`: scroll an AX element or coordinate target.
- `drag`: drag between element indexes or coordinates.
- `stop`: stop the Computer Use helper.

## Decision Rules

- If the AX tree exposes the target control, use the element index. Do not switch to coordinates just because coordinates are easier.
- If an AX element exposes a semantic action, prefer `perform_secondary_action` over raw click.
- If a text field is writable through AX, prefer `set_value` over click-and-type.
- If the AX tree is sparse, stale, or only exposes window chrome, use the returned screenshot and keyboard shortcuts before falling back to coordinate clicks.
- If the app opens a permission dialog, modal sheet, or system confirmation, observe it with `get_app_state` and follow the user's intent; do not bypass user confirmation.
- If an action fails or the UI does not change after verification, re-observe and choose another path. Do not repeat the same click blindly.
- Do not use memory from previous observations after a window moved, resized, changed tabs, changed Space, or changed focus. Re-observe and recalculate the target.

## Coordinate Fallback Rules

Coordinates are allowed, but they are the fallback path:

1. Use coordinates only after checking that AX does not expose a usable target.
2. Use `coordinate_space="screenshot"` only for positions read from the screenshot returned by `get_app_state` for the same app and same observation.
3. Keep coordinate actions small and verify immediately afterward.
4. If the window moves, resizes, or focus changes, discard old coordinates and call `get_app_state` again.
5. Do not pass coordinates from browser screenshots, Playwright screenshots, full-screen screenshots, screenshots from other tools, or stale screenshots as `coordinate_space="screenshot"`. Use only coordinates from the current `get_app_state` screenshot, or use `coordinate_space="screen"` when you have actual screen coordinates.

## Completion Standard

A desktop task is complete only when the latest observed state supports it. For example, after starting music playback, verify a visible playing state, changed play/pause control, now-playing indicator, or another reliable UI signal. If the app does not expose enough state to verify confidently, say what you observed and what remains uncertain.
