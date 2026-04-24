# TermCanvas Computer Use

TermCanvas provides Computer Use through MCP tools. Use it when the user asks you to operate a local Mac desktop application such as Spotify, NetEase Cloud Music, Finder, System Settings, or another GUI app.

## Operating Protocol

1. Start with `status`. If the helper is not healthy or macOS Accessibility / Screen Recording permissions are missing, call `setup` to start Computer Use and trigger the permission flow.
2. If macOS shows permission prompts or System Settings panes, the user must approve them. After approval, call `status` again before continuing.
3. Use `list_apps` to find running apps. Use `open_app` to launch or activate the target app by display name or bundle ID.
4. Before every desktop interaction, call `get_app_state` for the target app. Treat the returned AX tree and screenshot as the source of truth for the current UI.
5. Prefer AX-first actions. Use the integer element indexes returned by `get_app_state` with `click`, `set_value`, `perform_secondary_action`, `scroll`, or `drag` when the target control is represented in Accessibility.
6. Prefer direct AX operations over simulated input. Use `set_value` for writable text fields and `perform_secondary_action` for exposed actions such as `AXPress` or `AXShowMenu`.
7. Use keyboard input as the second path when AX exposes focusable controls but not a direct action: focus the target field/control, then use `type_text` or `press_key`.
8. Use screenshots to understand visual state. Use screenshot coordinates only as the last resort for canvas-rendered or non-AX UI. When using coordinates read from the returned screenshot, set `coordinate_space="screenshot"`.
9. After every action, call `get_app_state` again and verify the expected UI state changed. Do not say the task is complete until you observe the result.
10. Ask the user before destructive or privacy-sensitive actions, purchases, sending messages, sharing data, changing security settings, or anything that could have real-world side effects beyond ordinary navigation/playback.

## Tool Map

- `status`: check helper health and macOS permissions.
- `setup`: start Computer Use through TermCanvas and request required macOS permissions.
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
- If the AX tree is sparse, stale, or only exposes window chrome, use the screenshot and keyboard shortcuts before falling back to coordinate clicks.
- If the app opens a permission dialog, modal sheet, or system confirmation, observe it with `get_app_state` and follow the user's intent; do not bypass user confirmation.
- If an action fails or the UI does not change after verification, re-observe and choose another path. Do not repeat the same click blindly.

## Coordinate Fallback Rules

Coordinates are allowed, but they are the fallback path:

1. Use coordinates only after checking that AX does not expose a usable target.
2. Use `coordinate_space="screenshot"` for positions read from the screenshot returned by `get_app_state`.
3. Keep coordinate actions small and verify immediately afterward.
4. If the window moves, resizes, or focus changes, discard old coordinates and call `get_app_state` again.

## Completion Standard

A desktop task is complete only when the latest observed state supports it. For example, after starting music playback, verify a visible playing state, changed play/pause control, now-playing indicator, or another reliable UI signal. If the app does not expose enough state to verify confidently, say what you observed and what remains uncertain.
