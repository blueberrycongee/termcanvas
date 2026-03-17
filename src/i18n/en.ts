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

  // DrawingPanel
  tool_select: "Select",
  tool_pen: "Pen",
  tool_text: "Text",
  tool_rect: "Rect",
  tool_arrow: "Arrow",
  layout_horizontal: "Horizontal layout",
  layout_vertical: "Vertical layout",

  // ShortcutHints
  shortcut_add_project: "Add project",
  shortcut_toggle_sidebar: "Toggle sidebar",
  shortcut_new_terminal: "New terminal",
  shortcut_next_terminal: "Next terminal",
  shortcut_prev_terminal: "Prev terminal",
  shortcut_clear_focus: "Toggle focus",
  shortcut_span_default: "Default size",
  shortcut_span_wide: "Wide",
  shortcut_span_tall: "Tall",
  shortcut_span_large: "Large",

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
  animation_blur: "Focus animation blur",
  shortcuts_reset: "Reset to defaults",
  shortcuts_press_hint: "Press shortcut\u2026",
  shortcuts_conflict: "Conflicts with another shortcut",
  add_browser: "Open browser",

  // CLI
  cli_label: "Command line interface",
  cli_registered: "Registered",
  cli_not_registered: "Not registered",

  // Hydra Skill
  skill_label: "Hydra skill for Claude Code",
  skill_installed: "Installed",
  skill_not_installed: "Not installed",
} as const;

export type TranslationKey = keyof typeof en;
