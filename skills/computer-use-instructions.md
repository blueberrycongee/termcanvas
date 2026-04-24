
## Computer Use (Mac Desktop Control)

This machine has Computer Use enabled via TermCanvas. You can control Mac desktop applications.


### Available tools (via MCP)
- status — Check if Computer Use is available
- list_apps — List running Mac applications
- open_app — Open/activate an app by name or bundle_id
- get_app_state — Get app windows, indexed AX tree, and screenshot
- click — Click by integer element index or screen/window/screenshot coordinates
- set_value — Set the value of a settable AX element
- perform_secondary_action — Invoke a secondary AX action such as AXShowMenu
- type_text — Type text into the focused element
- press_key — Press a key combo using xdotool-like syntax, e.g. "super+c"
- scroll — Scroll in an app
- drag — Drag from one point/element to another
- stop — Emergency stop all Computer Use actions


### Best practices
1. When asked to operate a local Mac app, use Computer Use tools
2. Always call list_apps first to find the target app
3. Call get_app_state before any interaction to understand the current UI
4. Prefer the integer element index returned by get_app_state
5. Use coordinate_space="screenshot" when clicking coordinates from the returned screenshot
6. Use coordinates only when AX elements are not available
7. After every action, call get_app_state again to verify the result
8. Do not report success until you observe the expected UI state change
9. Prefer native app control over browser workarounds
