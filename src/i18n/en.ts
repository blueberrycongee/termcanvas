export const en = {
  // Common
  cancel: "Cancel",
  save: "Save",
  dont_save: "Don't Save",

  // App – CloseDialog
  save_workspace_title: "Save workspace?",
  save_workspace_desc:
    "Save your projects, terminals, and drawings to a file so you can restore them later.",

  // Toolbar / Settings modal
  settings: "Settings",
  reset: "Reset",
  fit: "Fit",
  switch_to_light: "Switch to light",
  switch_to_dark: "Switch to dark",
  language: "Language",
  theme: "Theme",

  // Sidebar
  projects: "Projects",
  add: "+ Add",
  open: "Open",
  no_projects: "No projects",
  status_running: "Running",
  status_active: "Active",
  status_waiting: "Waiting",
  status_completed: "Replied",
  status_done: "Done",
  status_error: "Error",
  status_idle: "Starting",
  error_dir_picker: (err: unknown) => `Failed to open directory picker: ${err}`,
  error_scan: (err: unknown) => `Failed to scan project: ${err}`,
  error_not_git: (path: string) => `"${path}" is not a git repository.`,
  info_added_project: (name: string, count: number) =>
    `Added "${name}" with ${count} worktree${count !== 1 ? "s" : ""}.`,

  // WorktreeContainer
  new_terminal: "New terminal",
  lazygit: "Git (lazygit)",
  new_terminal_btn: "+ New Terminal",

  // ProjectContainer
  project_label: "Project",

  // DiffCard
  diff: "Diff",
  loading: "Loading...",
  no_changes: "No changes",
  binary_label: "binary",
  removed: "Removed",
  file_new: "New",
  added: "Added",
  image_changed: "Image file changed",
  binary_changed: "Binary file changed",
  file_count: (n: number) => `${n} file${n !== 1 ? "s" : ""}`,

  // FileTreeCard / FileCard
  files: "Files",
  file_viewer: "File",
  file_empty_dir: "Empty directory",
  file_too_large: (size: string) => `File too large (${size})`,
  file_binary: "Binary file",
  file_read_error: "Failed to read file",

  // TerminalTile
  terminal_api_unavailable:
    "Terminal API not available. Not running in Electron.",
  failed_create_pty: (title: string, err: unknown) =>
    `Failed to create PTY for "${title}": ${err}`,
  process_exited: (code: number) =>
    `\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`,
  terminal_exited: (title: string, code: number) =>
    `Terminal "${title}" exited with code ${code}.`,
  terminal_copied: "Copied",
  terminal_custom_title_placeholder: "Add marker",
  terminal_star: "Star terminal",
  terminal_unstar: "Unstar terminal",

  // DrawingPanel
  tool_select: "Select",
  tool_pen: "Pen",
  tool_text: "Text",
  tool_rect: "Rect",
  tool_arrow: "Arrow",
  layout_horizontal: "Horizontal layout",
  layout_vertical: "Vertical layout",

  // Toolbar
  tutorial: "Tutorial",

  // ShortcutHints
  shortcut_add_project: "Add project",
  shortcut_toggle_sidebar: "Toggle sidebar",
  shortcut_toggle_right_panel: "Toggle right panel",
  shortcut_new_terminal: "New terminal",
  shortcut_rename_terminal_title: "Rename terminal",
  shortcut_close_focused: "Close focused",
  shortcut_toggle_star_focused: "Star / unstar terminal",
  shortcut_next_starred: "Next starred",
  shortcut_prev_starred: "Prev starred",
  shortcut_next_terminal: "Next terminal",
  shortcut_prev_terminal: "Prev terminal",
  shortcut_clear_focus: "Toggle focus",
  shortcut_span_default: "Default size",
  shortcut_span_wide: "Wide",
  shortcut_span_tall: "Tall",
  shortcut_span_large: "Large",
  shortcut_save_workspace: "Save",
  shortcut_save_workspace_as: "Save As",
  save_as: "Save As",
  save_error: (err: string) => `Save failed: ${err}`,

  // Selection / batch delete
  confirm_delete_projects: (n: number) =>
    `Delete ${n} selected project${n !== 1 ? "s" : ""}? This will close all terminals inside.`,
  confirm_delete_worktrees: (n: number) =>
    `Delete ${n} selected worktree${n !== 1 ? "s" : ""}? This will close all terminals inside.`,
  confirm_delete_mixed: (projects: number, worktrees: number) =>
    `Delete ${projects} project${projects !== 1 ? "s" : ""} and ${worktrees} worktree${worktrees !== 1 ? "s" : ""}? This will close all terminals inside.`,

  // Settings page
  settings_general: "General",
  settings_shortcuts: "Shortcuts",
  theme_dark: "Dark",
  theme_light: "Light",
  terminal_font_size: "Terminal font size",
  terminal_font: "Terminal font",
  font_builtin: "Built-in",
  font_downloaded: "Downloaded",
  font_download: "Download",
  font_downloading: "Downloading\u2026",
  font_download_failed: "Download failed",
  animation_blur: "Focus animation blur",
  minimum_contrast: "Minimum contrast ratio",
  composer_toggle: "Composer input bar",
  composer_toggle_desc: "Experimental. Routes input through a bottom bar with image paste support",
  drawing_toggle: "Drawing tools",
  drawing_toggle_desc: "Experimental. Freehand drawing and annotation on the canvas",
  shortcuts_reset: "Reset to defaults",
  shortcuts_press_hint: "Press shortcut\u2026",
  shortcuts_conflict: "Conflicts with another shortcut",
  add_browser: "Open browser",
  update_checking: "Checking for updates",
  update_downloading: "Downloading update",
  update_ready: "Update ready, click to view",
  update_error: "Update error",

  // CLI
  cli_label: "Command line interface",
  cli_registered: "Registered",
  cli_not_registered: "Not registered",
  cli_registering: "Registering\u2026",

  // CLI Agent Settings
  settings_agents: "Agents",
  agent_status_found: (version: string) => `Found (${version})`,
  agent_status_not_found: "Not found",
  agent_status_checking: "Checking\u2026",
  agent_validate: "Validate",
  agent_command_placeholder: (detectedPath: string) => detectedPath,
  agent_default_hint: "Leave empty to use default",
  cli_launch_error_title: (command: string) =>
    `${command} CLI is not configured or cannot be launched.`,
  cli_launch_error_action: "Open Settings",

  // Composer
  composer_label: "Composer",
  composer_target_label: "Target",
  composer_submit: "Send",
  composer_submitting: "Sending\u2026",
  composer_empty_state: "No terminals available",
  composer_no_target_state: "No terminal selected",
  composer_rename_title_missing_target: "Focus a terminal before renaming it.",
  composer_rename_title_placeholder:
    "Rename the focused terminal marker. Enter saves, Escape cancels.",
  composer_rename_title_note:
    "Rename mode. Enter saves the marker, Escape cancels, empty clears it.",
  composer_rename_title_submit: "Save",
  composer_no_target_placeholder:
    "Select or focus a terminal to enable composer sending.",
  composer_placeholder:
    "Send text to the focused terminal. Paste screenshots here for agent terminals.",
  composer_placeholder_text_only:
    "Send text directly to the focused terminal.",
  composer_no_target_note:
    "Composer only sends to the focused terminal. Select a terminal to enable sending.",
  composer_note:
    "Targets the focused terminal by default. Enter sends, Shift+Enter adds a new line. Agent terminals can also receive pasted images.",
  composer_note_text_only:
    "Targets the focused terminal directly. Enter sends, Shift+Enter adds a new line. Image paste is unavailable for this terminal type.",
  composer_drop_hint: "Drop files here",
  composer_missing_target: "Select or focus a terminal first.",
  composer_empty_submit: "Enter text or paste an image before sending.",
  composer_images_unsupported: (title: string) =>
    `"${title}" does not support image submission.`,
  composer_blocked_status: (title: string, status: string) =>
    `"${title}" is busy (${status}). Wait until the agent is ready.`,
  composer_stage_target: "target resolution",
  composer_stage_validate: "request validation",
  composer_stage_read_images: "image read",
  composer_stage_prepare_images: "image staging",
  composer_stage_paste_image: "image paste",
  composer_stage_paste_text: "text paste",
  composer_stage_submit: "command submit",
  composer_image_read_failed: (title: string, detail: string) =>
    `Failed to read pasted images for "${title}" during image read: ${detail}`,
  composer_submit_failed_with_context: (
    title: string,
    stage: string,
    detail: string,
  ) => `Failed to send to "${title}" during ${stage}: ${detail}`,
  composer_submit_failed: (err: string) => `Composer submit failed: ${err}`,

  // Hierarchy
  hierarchy_agent_tree: "Agent Tree",
  hierarchy_parent: (type: string) => `Parent: ${type}`,
  hierarchy_agents: (n: number) => `${n} agent${n !== 1 ? "s" : ""}`,

  // Usage panel
  usage_title: "Usage",
  usage_monthly: "This month",
  usage_sessions: "Sessions",
  usage_output: "Output",
  usage_timeline: "Timeline",
  usage_projects: "Projects",
  usage_models: "Models",
  usage_input: "Input",
  usage_cache_read: "Cache R",
  usage_cache_create: "Cache W",
  usage_tokens: "Tokens",
  usage_cache_rate: "Cache Rate",
  usage_cache_rate_overall: "Overall",
  usage_no_data: "No usage data",
  usage_today: "Today",
  usage_calls: "calls",
  usage_tokens_label: "tokens",
  usage_cal_weekdays: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as readonly string[],
  usage_cal_months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ] as readonly string[],
  usage_cal_months_short: [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ] as readonly string[],
  usage_heatmap: "Activity",
  usage_heatmap_less: "Less",
  usage_heatmap_more: "More",
  usage_heatmap_loading: "Loading heatmap…",
  usage_heatmap_error: "Failed to load heatmap",
  usage_quota: "Claude Quota",
  usage_quota_5h: "5h",
  usage_quota_7d: "7d",
  usage_quota_resets: "resets",

  // Auth
  auth_login_github: "Login with GitHub",
  auth_logout: "Logout",
  auth_logging_in: "Logging in...",
  auth_opening_browser: "Opening browser...",
  auth_login_failed: "Login failed",
  auth_copy_link: "Copy link",
  auth_this_device: "(this device)",
  auth_devices: "Devices",
  auth_cloud_error: "Cloud data unavailable",

  // Insights
  insights_generate: "Generate Insights",
  insights_select_cli: "Generate for",
  insights_validating: "Validating CLI...",
  insights_scanning: "Scanning sessions...",
  insights_extracting: "Analyzing sessions",
  insights_aggregating: "Aggregating data...",
  insights_analyzing: "Running AI analysis",
  insights_generating: "Generating report...",
  insights_done: "Report generated!",
  insights_open: "Open Report",
  insights_error: "Insights Error",

  // Welcome popup
  welcome_title: "termcanvas",
  welcome_heading: "Welcome to TermCanvas!",
  welcome_desc: "Manage terminals on an infinite canvas.",
  welcome_quick_start: "Quick Start:",
  welcome_step_1: "Click \"Add Project\" to add a project",
  welcome_step_2: "Open terminals in your worktrees",
  welcome_step_3: "Pan & zoom the canvas freely",
  welcome_shortcuts: "Key Shortcuts:",
  welcome_github: "GitHub:",
  welcome_dismiss: "Press Enter to start the interactive tutorial, or Escape to skip.",

  // Onboarding tutorial
  onboarding_dblclick_prompt: "Double-click a terminal title bar to focus it",
  onboarding_focus_prompt: "Press {shortcut} to focus a terminal",
  onboarding_unfocus_prompt: "Press {shortcut} again to unfocus",
  onboarding_switch_prompt: "Press {next} / {prev} to switch terminals",
  onboarding_switch_continue: "Press Enter to continue",
  onboarding_zoom_prompt: "Scroll to zoom, drag to pan",
  onboarding_zoom_continue: "Press Enter to continue",
  onboarding_complete: "Tutorial complete! Close this window, then press {shortcut} to add your first project.",
  onboarding_complete_dismiss: "Press Enter or Escape to close.",
  onboarding_skip: "Escape to skip",
} as const;

export type TranslationKey = keyof typeof en;
