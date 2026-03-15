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
} as const;

export type TranslationKey = keyof typeof en;
