# Claude Code 按键行为逆向分析

> 基于 Claude Code v2.1.78 (`cli.js` 12.2MB bundle) 逆向提取。
> 逆向日期：2026-03-18

## 架构

5 层输入处理管线：

1. **早期 stdin 捕获** — UI 加载前拦截 `Ctrl+C` / `Ctrl+D`
2. **终端按键解析** — 原始 keypress → 标准化 `{key, ctrl, shift, meta, alt}` 对象
3. **Ink useInput** — React 层输入钩子
4. **Action 绑定系统** — 18 个 context × 73+ 个 action，支持 chord 组合键
5. **Inquirer 提示** — 独立的交互式选择键处理

---

## Context（上下文）

系统定义了 18 个互斥上下文，决定当前激活哪组绑定：

| Context | 说明 |
|---|---|
| Global | 全局生效，无论焦点在哪 |
| Chat | 聊天输入框获焦 |
| Autocomplete | 自动补全菜单可见 |
| Confirmation | 确认/权限对话框 |
| Help | 帮助覆盖层 |
| Transcript | 对话记录查看器 |
| HistorySearch | 历史搜索模式（Ctrl+R 进入） |
| Task | 前台运行 agent 时 |
| ThemePicker | 主题选择器 |
| Settings | 设置菜单 |
| Tabs | Tab 导航 |
| Attachments | 附件栏获焦 |
| Footer | 页脚指示器获焦 |
| MessageSelector | 消息选择/回退 |
| DiffDialog | Diff 对话框 |
| ModelPicker | 模型选择器 |
| Select | 通用列表选择 |
| Plugin | 插件对话框 |

---

## Action（动作）

完整枚举（73 个）：

```
app:interrupt, app:exit, app:toggleTodos, app:toggleTranscript, app:toggleBrief,
app:toggleTeammatePreview, app:toggleTerminal, app:globalSearch, app:quickOpen,
history:search, history:previous, history:next,
chat:cancel, chat:cycleMode, chat:modelPicker, chat:thinkingToggle, chat:submit,
chat:newline, chat:undo, chat:externalEditor, chat:stash, chat:imagePaste,
chat:killAgents, chat:fastMode,
autocomplete:accept, autocomplete:dismiss, autocomplete:previous, autocomplete:next,
confirm:yes, confirm:no, confirm:previous, confirm:next, confirm:nextField,
confirm:previousField, confirm:cycleMode, confirm:toggle, confirm:toggleExplanation,
tabs:next, tabs:previous,
transcript:toggleShowAll, transcript:exit,
historySearch:next, historySearch:accept, historySearch:cancel, historySearch:execute,
task:background,
theme:toggleSyntaxHighlighting,
help:dismiss,
attachments:next, attachments:previous, attachments:remove, attachments:exit,
footer:next, footer:previous, footer:openSelected, footer:clearSelection,
messageSelector:up, messageSelector:down, messageSelector:top, messageSelector:bottom,
messageSelector:select,
diff:dismiss, diff:previousSource, diff:nextSource, diff:back, diff:viewDetails,
diff:previousFile, diff:nextFile,
modelPicker:decreaseEffort, modelPicker:increaseEffort,
select:next, select:previous, select:accept, select:cancel,
plugin:toggle, plugin:install,
permission:toggleDebug,
settings:search, settings:retry, settings:close,
voice:pushToTalk
```

另外 `command:<name>` 可绑定任意斜杠命令，仅在 Chat 上下文生效。

---

## 默认快捷键映射

### Global

| 按键 | Action | 行为 |
|---|---|---|
| `Ctrl+C` | `app:interrupt` | 中断当前操作。800ms 内双击退出程序 |
| `Ctrl+D` | `app:exit` | 输入为空时退出。双击强制退出 |
| `Ctrl+T` | `app:toggleTodos` | 切换 TODO 面板 |
| `Ctrl+O` | `app:toggleTranscript` | 切换完整对话记录 |
| `Ctrl+Shift+B` | `app:toggleBrief` | 切换简洁模式 |
| `Ctrl+Shift+O` | `app:toggleTeammatePreview` | 切换 Teammate 消息预览 |
| `Ctrl+R` | `history:search` | 进入历史搜索模式 |

### Chat

| 按键 | Action | 行为 |
|---|---|---|
| `Enter` | `chat:submit` | 提交消息 |
| `Escape` | `chat:cancel` | 取消。双击清空输入 |
| `Up` | `history:previous` | 上一条历史消息 |
| `Down` | `history:next` | 下一条历史消息 |
| `Shift+Tab` / `Meta+M` | `chat:cycleMode` | 切换 auto-accept 模式 [1] |
| `Alt+P` | `chat:modelPicker` | 打开模型选择器 |
| `Alt+O` | `chat:fastMode` | 切换快速模式 |
| `Alt+T` | `chat:thinkingToggle` | 切换思考模式 |
| `Ctrl+F` | `chat:killAgents` | 终止运行中的子 agent |
| `Ctrl+G` | `chat:externalEditor` | 用 `$EDITOR` 打开外部编辑器 |
| `Ctrl+S` | `chat:stash` | 暂存当前输入 |
| `Ctrl+V` (Mac/Linux) / `Alt+V` (Win) | `chat:imagePaste` | 粘贴图片 |
| `Ctrl+_` / `Ctrl+Shift+-` | `chat:undo` | 撤销 |
| `Space` | `voice:pushToTalk` | 按住说话（语音模式下） |

> [1] `Shift+Tab` 需要 Node ≥ 22.17 / 24.2 或 Bun ≥ 1.2.23 才能被终端正确识别，否则 fallback 到 `Meta+M`。

### Autocomplete

| 按键 | Action | 行为 |
|---|---|---|
| `Tab` | `autocomplete:accept` | 接受补全 |
| `Escape` | `autocomplete:dismiss` | 关闭补全菜单 |
| `Up` | `autocomplete:previous` | 上一项 |
| `Down` | `autocomplete:next` | 下一项 |

### Confirmation（权限/确认对话框）

| 按键 | Action | 行为 |
|---|---|---|
| `Y` | `confirm:yes` | 允许 |
| `N` | `confirm:no` | 拒绝 |
| `Enter` | `confirm:yes` | 允许 |
| `Escape` | `confirm:no` | 拒绝 |
| `Up` | `confirm:previous` | 切换到上一个选项 |
| `Down` | `confirm:next` | 切换到下一个选项 |
| `Tab` | `confirm:nextField` | 下一个字段 |
| `Space` | `confirm:toggle` | 切换选中状态 |
| `Shift+Tab` | `confirm:cycleMode` | 循环确认模式 |
| `Ctrl+E` | `confirm:toggleExplanation` | 显示/隐藏命令解释 |
| `Ctrl+D` | `permission:toggleDebug` | 权限调试模式 |

### HistorySearch

| 按键 | Action | 行为 |
|---|---|---|
| `Ctrl+R` | `historySearch:next` | 下一个匹配结果 |
| `Escape` / `Tab` | `historySearch:accept` | 采纳结果填入输入框 |
| `Enter` | `historySearch:execute` | 直接执行 |
| `Ctrl+C` | `historySearch:cancel` | 取消搜索 |

### MessageSelector

| 按键 | Action | 行为 |
|---|---|---|
| `Up` / `K` / `Ctrl+P` | `messageSelector:up` | 上移 |
| `Down` / `J` / `Ctrl+N` | `messageSelector:down` | 下移 |
| `Ctrl+Up` / `Shift+Up` / `Meta+Up` / `Shift+K` | `messageSelector:top` | 跳到顶部 |
| `Ctrl+Down` / `Shift+Down` / `Meta+Down` / `Shift+J` | `messageSelector:bottom` | 跳到底部 |
| `Enter` | `messageSelector:select` | 选中当前消息 |

### DiffDialog

| 按键 | Action | 行为 |
|---|---|---|
| `Escape` | `diff:dismiss` | 关闭对话框 |
| `Left` | `diff:previousSource` | 前一个来源 |
| `Right` | `diff:nextSource` | 后一个来源 |
| `Up` | `diff:previousFile` | 前一个文件 |
| `Down` | `diff:nextFile` | 后一个文件 |
| `Enter` | `diff:viewDetails` | 查看详情 |

### ModelPicker

| 按键 | Action | 行为 |
|---|---|---|
| `Left` | `modelPicker:decreaseEffort` | 降低 effort |
| `Right` | `modelPicker:increaseEffort` | 提高 effort |

### Settings

| 按键 | Action | 行为 |
|---|---|---|
| `Escape` | `confirm:no` | 关闭设置 |
| `Up` / `K` / `Ctrl+P` | `select:previous` | 上一项 |
| `Down` / `J` / `Ctrl+N` | `select:next` | 下一项 |
| `Space` | `select:accept` | 选择 |
| `Enter` | `settings:close` | 关闭 |
| `/` | `settings:search` | 搜索 |
| `R` | `settings:retry` | 重试 |

### Select（通用列表）

| 按键 | Action | 行为 |
|---|---|---|
| `Up` / `K` / `Ctrl+P` | `select:previous` | 上一项 |
| `Down` / `J` / `Ctrl+N` | `select:next` | 下一项 |
| `Enter` | `select:accept` | 确认 |
| `Escape` | `select:cancel` | 取消 |

### Tabs

| 按键 | Action |
|---|---|
| `Tab` / `Right` | `tabs:next` |
| `Shift+Tab` / `Left` | `tabs:previous` |

### Transcript

| 按键 | Action |
|---|---|
| `Ctrl+E` | `transcript:toggleShowAll` |
| `Ctrl+C` / `Escape` / `Q` | `transcript:exit` |

### Task

| 按键 | Action | 行为 |
|---|---|---|
| `Ctrl+B` | `task:background` | 将 agent 放到后台运行 |

### ThemePicker

| 按键 | Action |
|---|---|
| `Ctrl+T` | `theme:toggleSyntaxHighlighting` |

### Help

| 按键 | Action |
|---|---|
| `Escape` | `help:dismiss` |

### Attachments

| 按键 | Action | 行为 |
|---|---|---|
| `Left` / `Right` | `attachments:previous/next` | 切换附件 |
| `Backspace` / `Delete` | `attachments:remove` | 删除附件 |
| `Down` / `Escape` | `attachments:exit` | 退出附件栏 |

### Footer

| 按键 | Action | 行为 |
|---|---|---|
| `Left` / `Right` | `footer:previous/next` | 切换项 |
| `Enter` | `footer:openSelected` | 打开选中 |
| `Escape` | `footer:clearSelection` | 清除选择 |

### Plugin

| 按键 | Action |
|---|---|
| `Space` | `plugin:toggle` |
| `I` | `plugin:install` |

---

## Emacs 风格文本编辑（Chat 输入框内硬编码）

这些快捷键不走 Action 绑定系统，直接在输入框内部硬编码处理。

### 光标移动

| 按键 | 行为 |
|---|---|
| `Ctrl+A` | 行首 |
| `Ctrl+E` | 行尾 |
| `Ctrl+B` | 左移一字符 |
| `Ctrl+F` | 右移一字符 |
| `Ctrl+P` | 上移一行 |
| `Ctrl+N` | 下移一行 |
| `Alt+B` | 前一个单词 |
| `Alt+F` | 后一个单词 |
| `Ctrl+Left` / `Meta+Left` | 跳到前一个单词 |
| `Ctrl+Right` / `Meta+Right` | 跳到后一个单词 |
| `Home` / `PageUp` | 行首 |
| `End` / `PageDown` | 行尾 |

### 文本删改

| 按键 | 行为 |
|---|---|
| `Ctrl+K` | 剪切到行尾 |
| `Ctrl+U` | 剪切到行首 |
| `Ctrl+W` | 删除前一个单词 |
| `Ctrl+H` | 删除前一个 token |
| `Ctrl+L` | 清空所有输入 |
| `Alt+D` | 删除后一个单词 |
| `Meta+Backspace` / `Ctrl+Backspace` | 删除前一个单词 |
| `Meta+Delete` | 剪切到行尾 |

### Kill Ring

| 按键 | 行为 |
|---|---|
| `Ctrl+Y` | 粘贴 (yank) |
| `Alt+Y` | 循环 kill ring |

### 换行

| 按键 | 行为 |
|---|---|
| `Shift+Enter` / `Meta+Enter` | 插入换行（不提交） |

---

## 特殊输入前缀

在 Chat 输入框中，以下前缀字符触发特殊行为：

| 前缀 | 功能 |
|---|---|
| `!` | Bash 模式——直接执行 shell 命令 |
| `/` | 斜杠命令——触发补全菜单 |
| `@` | 文件路径引用 |
| `&` | 后台任务 |

---

## 保留键（不可重绑定）

### 硬编码保留

| 按键 | 原因 |
|---|---|
| `Ctrl+C` | 硬编码中断/退出 |
| `Ctrl+D` | 硬编码退出 |
| `Ctrl+M` | 终端中等同 Enter（都发送 CR 字节） |

### 终端保留

| 按键 | 原因 | 严重性 |
|---|---|---|
| `Ctrl+Z` | Unix 进程挂起 (SIGTSTP) | warning |
| `Ctrl+\` | 终端退出信号 (SIGQUIT) | error |

### macOS 系统保留

| 按键 | 原因 |
|---|---|
| `Cmd+C/V/X` | 系统复制/粘贴/剪切 |
| `Cmd+Q` | 退出应用 |
| `Cmd+W` | 关闭窗口/标签 |
| `Cmd+Tab` | 应用切换 |
| `Cmd+Space` | Spotlight |

---

## 双击确认机制

`app:interrupt`（Ctrl+C）和 `app:exit`（Ctrl+D）使用 800ms 双击确认：第一次按下进入 pending 状态并显示提示，800ms 内再次按下才真正执行。

---

## 自定义

配置文件：`~/.claude/keybindings.json`

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+e": "chat:externalEditor",
        "ctrl+k ctrl+s": "chat:stash"
      }
    },
    {
      "context": "Global",
      "bindings": {
        "ctrl+t": null
      }
    }
  ]
}
```

### 规则

- 用户绑定**叠加**在默认绑定之后，匹配时倒序遍历，用户绑定优先
- 设为 `null` 解绑默认键
- Chord 组合键用空格分隔（如 `ctrl+k ctrl+s`），1 秒超时窗口，`Escape` 取消
- 文件修改后 500ms 自动热重载（chokidar），无需重启
- `command:<name>` 绑定斜杠命令，仅 Chat 上下文生效
- `/doctor` 命令包含 Keybinding Configuration Issues 验证

### 键名语法

**修饰键**（`+` 组合）：`ctrl`（别名 `control`）、`alt`（别名 `opt`/`option`）、`shift`、`meta`（别名 `cmd`/`command`）

**特殊键**：`escape`/`esc`、`enter`/`return`、`tab`、`space`、`backspace`、`delete`、`up`、`down`、`left`、`right`、`pageup`、`pagedown`、`home`、`end`

> 在终端环境中 `alt` 和 `meta` 等价。`super` 对应 `cmd`/`command`/`win`。
