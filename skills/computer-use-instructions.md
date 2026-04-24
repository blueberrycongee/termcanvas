
## Computer Use (Mac Desktop Control)

This machine has Computer Use enabled via TermCanvas. You can control Mac desktop applications.


### Available tools (via MCP)
- computer_use_status — Check if Computer Use is available
- computer_use_list_apps — List running Mac applications
- computer_use_open_app — Open/activate an app by name or bundle_id
- computer_use_get_app_state — Get app windows, UI elements (AX tree), and optional screenshot
- computer_use_click — Click a UI element (by element_id or screen coordinates)
- computer_use_type_text — Type text into the focused element
- computer_use_press_key — Press a key combo (e.g., "command+c")
- computer_use_scroll — Scroll in an app
- computer_use_drag — Drag from one point/element to another
- computer_use_stop — Emergency stop all Computer Use actions


### Best practices
1. When asked to operate a local Mac app, use Computer Use tools
2. Always call list_apps first to find the target app
3. Call get_app_state before any interaction to understand the current UI
4. Prefer element_id over coordinates — it's more reliable
5. Use coordinates only when AX elements are not available (check screenshot)
6. After every action, call get_app_state again to verify the result
7. Do not report success until you observe the expected UI state change
8. Prefer native app control over browser workarounds
