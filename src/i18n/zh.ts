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
  status_completed: "已回复",
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
  lazygit: "Git (lazygit)",
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
  terminal_copied: "已复制",
  terminal_custom_title_placeholder: "未命名标题",
  terminal_star: "剪藏终端",
  terminal_unstar: "取消剪藏",

  // DrawingPanel
  tool_select: "选择",
  tool_pen: "画笔",
  tool_text: "文字",
  tool_rect: "矩形",
  tool_arrow: "箭头",
  layout_horizontal: "横向布局",
  layout_vertical: "纵向布局",

  // Toolbar
  tutorial: "教程",

  // ShortcutHints
  shortcut_add_project: "添加项目",
  shortcut_toggle_sidebar: "切换侧栏",
  shortcut_toggle_right_panel: "切换右侧面板",
  shortcut_new_terminal: "新建终端",
  shortcut_rename_terminal_title: "重命名终端",
  shortcut_close_focused: "关闭当前",
  shortcut_toggle_star_focused: "收藏 / 取消收藏",
  shortcut_next_starred: "下一收藏",
  shortcut_prev_starred: "上一收藏",
  shortcut_next_terminal: "下一终端",
  shortcut_prev_terminal: "上一终端",
  shortcut_clear_focus: "切换聚焦",
  shortcut_span_default: "默认大小",
  shortcut_span_wide: "宽",
  shortcut_span_tall: "高",
  shortcut_span_large: "大",
  shortcut_save_workspace: "保存",
  shortcut_save_workspace_as: "另存为",
  save_as: "另存为",
  save_error: (err: string) => `保存失败：${err}`,

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
  terminal_font_size: "终端字体大小",
  terminal_font: "终端字体",
  font_builtin: "内置",
  font_downloaded: "已下载",
  font_download: "下载",
  font_downloading: "下载中…",
  font_download_failed: "下载失败",
  animation_blur: "聚焦动画模糊",
  composer_toggle: "Composer 输入栏",
  composer_toggle_desc: "实验性功能。开启后通过底部输入栏发送内容到终端，支持图片粘贴",
  drawing_toggle: "画板工具",
  drawing_toggle_desc: "实验性功能。在画布上进行自由绘图和标注",
  shortcuts_reset: "恢复默认",
  shortcuts_press_hint: "按下快捷键…",
  shortcuts_conflict: "与其他快捷键冲突",
  add_browser: "打开浏览器",
  update_checking: "正在检查更新",
  update_downloading: "正在下载更新",
  update_ready: "更新已就绪，点击查看",
  update_error: "更新出错",

  // CLI
  cli_label: "命令行工具",
  cli_registered: "已注册",
  cli_not_registered: "未注册",
  cli_registering: "注册中…",

  // CLI Agent Settings
  settings_agents: "Agent",
  agent_status_found: (version: string) => `已找到 (${version})`,
  agent_status_not_found: "未找到",
  agent_status_checking: "检测中…",
  agent_validate: "验证",
  agent_command_placeholder: (detectedPath: string) => detectedPath,
  agent_default_hint: "留空使用默认值",
  cli_launch_error_title: (command: string) =>
    `${command} CLI 未配置或无法启动。`,
  cli_launch_error_action: "打开设置",

  // Composer
  composer_label: "Composer",
  composer_target_label: "目标",
  composer_submit: "发送",
  composer_submitting: "发送中…",
  composer_empty_state: "当前没有可用终端",
  composer_no_target_state: "当前未选中终端",
  composer_rename_title_missing_target: "请先聚焦一个终端，再修改标题。",
  composer_rename_title_placeholder:
    "修改当前聚焦终端的标题。Enter 保存，Escape 取消。",
  composer_rename_title_note:
    "标题编辑模式。Enter 保存标题，Escape 取消，留空会清除标题。",
  composer_rename_title_submit: "保存",
  composer_no_target_placeholder:
    "请先选择或聚焦一个终端，然后再通过 composer 发送。",
  composer_placeholder:
    "发送到当前聚焦终端。对于 agent 终端，也可以直接粘贴截图。",
  composer_placeholder_text_only:
    "直接发送文本到当前聚焦终端。",
  composer_no_target_note:
    "Composer 只会发送到当前聚焦终端。请先选择一个终端以启用发送。",
  composer_note:
    "默认发送到当前聚焦终端。Enter 发送，Shift+Enter 换行。Agent 终端也支持图片输入。",
  composer_note_text_only:
    "默认发送到当前聚焦终端。Enter 发送，Shift+Enter 换行。当前终端类型不支持图片输入。",
  composer_drop_hint: "拖放文件到此处",
  composer_missing_target: "请先选择或聚焦一个终端。",
  composer_empty_submit: "发送前请输入文本或粘贴图片。",
  composer_images_unsupported: (title: string) =>
    `终端 "${title}" 不支持图片输入。`,
  composer_blocked_status: (title: string, status: string) =>
    `终端 "${title}" 当前正忙 (${status})，请稍后再试。`,
  composer_stage_target: "目标解析",
  composer_stage_validate: "请求校验",
  composer_stage_read_images: "图片读取",
  composer_stage_prepare_images: "图片暂存",
  composer_stage_paste_image: "图片粘贴",
  composer_stage_paste_text: "文本粘贴",
  composer_stage_submit: "提交回车",
  composer_image_read_failed: (title: string, detail: string) =>
    `终端 "${title}" 在图片读取阶段失败：${detail}`,
  composer_submit_failed_with_context: (
    title: string,
    stage: string,
    detail: string,
  ) => `发送到终端 "${title}" 时在${stage}阶段失败：${detail}`,
  composer_submit_failed: (err: string) => `发送失败：${err}`,

  // Hierarchy
  hierarchy_agent_tree: "代理树",
  hierarchy_parent: (type: string) => `父级：${type}`,
  hierarchy_agents: (n: number) => `${n} 个代理`,

  // Usage panel
  usage_title: "用量",
  usage_monthly: "本月累计",
  usage_sessions: "会话",
  usage_output: "输出",
  usage_timeline: "时段",
  usage_projects: "项目",
  usage_models: "模型",
  usage_input: "输入",
  usage_cache_read: "缓存读",
  usage_cache_create: "缓存写",
  usage_tokens: "Tokens",
  usage_cache_rate: "缓存率",
  usage_cache_rate_overall: "整体",
  usage_no_data: "暂无用量数据",
  usage_today: "今天",
  usage_calls: "次调用",
  usage_tokens_label: "tokens",
  usage_cal_weekdays: ["日", "一", "二", "三", "四", "五", "六"] as readonly string[],
  usage_cal_months: [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月",
  ] as readonly string[],
  usage_cal_months_short: [
    "1月", "2月", "3月", "4月", "5月", "6月",
    "7月", "8月", "9月", "10月", "11月", "12月",
  ] as readonly string[],
  usage_heatmap: "活跃度",
  usage_heatmap_less: "少",
  usage_heatmap_more: "多",
  usage_heatmap_loading: "加载热力图…",
  usage_heatmap_error: "热力图加载失败",

  // Auth
  auth_login_github: "使用 GitHub 登录",
  auth_logout: "退出登录",
  auth_logging_in: "登录中...",
  auth_this_device: "(本机)",
  auth_devices: "设备",
  auth_cloud_error: "云端数据不可用",

  // Insights
  insights_generate: "生成洞察报告",
  insights_select_cli: "使用",
  insights_validating: "验证 CLI...",
  insights_scanning: "扫描会话...",
  insights_extracting: "分析会话",
  insights_aggregating: "汇总数据...",
  insights_analyzing: "AI 分析中",
  insights_generating: "生成报告...",
  insights_done: "报告已生成！",
  insights_open: "打开报告",
  insights_error: "洞察报告错误",

  // Welcome popup
  welcome_title: "termcanvas",
  welcome_heading: "欢迎使用 TermCanvas！",
  welcome_desc: "在无限画布上管理终端。",
  welcome_quick_start: "快速开始：",
  welcome_step_1: "点击「Add Project」添加项目",
  welcome_step_2: "在工作树中打开终端",
  welcome_step_3: "自由平移和缩放画布",
  welcome_shortcuts: "快捷键：",
  welcome_github: "GitHub:",
  welcome_dismiss: "按 Enter 进入交互教程，按 Escape 跳过。",

  // Onboarding tutorial
  onboarding_dblclick_prompt: "双击终端标题栏聚焦",
  onboarding_focus_prompt: "按 {shortcut} 聚焦终端",
  onboarding_unfocus_prompt: "再按 {shortcut} 取消聚焦",
  onboarding_switch_prompt: "按 {next} / {prev} 切换终端",
  onboarding_switch_continue: "按 Enter 继续",
  onboarding_zoom_prompt: "滚轮缩放，拖拽平移",
  onboarding_zoom_continue: "按 Enter 继续",
  onboarding_complete: "教程完成！关闭此窗口后，按 {shortcut} 添加你的第一个项目。",
  onboarding_complete_dismiss: "按 Enter 或 Escape 关闭。",
  onboarding_skip: "Escape 跳过",
} as const;
