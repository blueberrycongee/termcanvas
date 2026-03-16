export const zh = {
  // Common
  cancel: "取消",
  save: "保存",
  dont_save: "不保存",

  // App – CloseDialog
  save_workspace_title: "保存工作区？",
  save_workspace_desc: "将项目、终端和绘图保存到文件，以便稍后恢复。",

  // Toolbar / Settings modal
  settings: "设置",
  reset: "重置",
  fit: "适合",
  switch_to_light: "切换到浅色",
  switch_to_dark: "切换到深色",
  language: "语言",
  theme: "主题",

  // Sidebar
  projects: "项目",
  add: "+ 添加",
  open: "打开",
  no_projects: "暂无项目",
  status_running: "运行中",
  status_active: "工作中",
  status_waiting: "待关注",
  status_done: "完成",
  status_error: "错误",
  status_idle: "启动中",
  error_dir_picker: (err: unknown) => `打开目录选择器失败：${err}`,
  error_scan: (err: unknown) => `扫描项目失败：${err}`,
  error_not_git: (path: string) => `"${path}" 不是 git 仓库。`,
  info_added_project: (name: string, count: number) =>
    `已添加 "${name}"，共 ${count} 个工作树。`,

  // WorktreeContainer
  new_terminal: "新建终端",
  new_terminal_btn: "+ 新建终端",

  // ProjectContainer
  project_label: "项目",

  // DiffCard
  diff: "变更",
  loading: "加载中...",
  no_changes: "无变更",
  binary_label: "二进制",
  removed: "已删除",
  file_new: "新增",
  added: "已添加",
  image_changed: "图片文件已修改",
  binary_changed: "二进制文件已修改",
  file_count: (n: number) => `${n} 个文件`,

  // FileTreeCard / FileCard
  files: "文件",
  file_viewer: "文件",
  file_empty_dir: "空目录",
  file_too_large: (size: string) => `文件过大 (${size})`,
  file_binary: "二进制文件",
  file_read_error: "读取文件失败",

  // TerminalTile
  terminal_api_unavailable: "终端 API 不可用，未在 Electron 中运行。",
  failed_create_pty: (title: string, err: unknown) =>
    `为 "${title}" 创建 PTY 失败：${err}`,
  process_exited: (code: number) =>
    `\r\n\x1b[33m[进程已退出，退出码 ${code}]\x1b[0m\r\n`,
  terminal_exited: (title: string, code: number) =>
    `终端 "${title}" 已退出，退出码 ${code}。`,

  // DrawingPanel
  tool_select: "选择",
  tool_pen: "画笔",
  tool_text: "文字",
  tool_rect: "矩形",
  tool_arrow: "箭头",
  layout_horizontal: "横向布局",
  layout_vertical: "纵向布局",

  // ShortcutHints
  shortcut_add_project: "添加项目",
  shortcut_toggle_sidebar: "切换侧栏",
  shortcut_new_terminal: "新建终端",
  shortcut_next_terminal: "下一终端",
  shortcut_prev_terminal: "上一终端",
  shortcut_clear_focus: "切换聚焦",
  shortcut_span_default: "默认大小",
  shortcut_span_wide: "宽",
  shortcut_span_tall: "高",
  shortcut_span_large: "大",

  // Selection / batch delete
  confirm_delete_projects: (n: number) =>
    `删除 ${n} 个选中的项目？这将关闭其中所有终端。`,
  confirm_delete_worktrees: (n: number) =>
    `删除 ${n} 个选中的工作树？这将关闭其中所有终端。`,
  confirm_delete_mixed: (projects: number, worktrees: number) =>
    `删除 ${projects} 个项目和 ${worktrees} 个工作树？这将关闭其中所有终端。`,

  // Settings page
  settings_general: "通用",
  settings_shortcuts: "快捷键",
  theme_dark: "深色",
  theme_light: "浅色",
  shortcuts_reset: "恢复默认",
  shortcuts_press_hint: "按下快捷键…",
  shortcuts_conflict: "与其他快捷键冲突",
} as const;
