# 研究报告：Composer 完全接管终端对话框后的快捷键系统设计

## 目录

1. [主流终端工具快捷键对比分析](#1-主流终端工具快捷键对比分析)
2. [Composer 作为统一入口的快捷键设计](#2-composer-作为统一入口的快捷键设计)
3. [创新快捷键交互](#3-创新快捷键交互)
4. [具体设计建议](#4-具体设计建议)

---

## 1. 主流终端工具快捷键对比分析

### 1.1 快捷键架构模型分类

通过对 9 个主流终端工具的深度研究，可以归纳出 4 种核心架构模型：

| 架构模型 | 代表工具 | 核心机制 | 冲突解决方式 |
|---------|---------|---------|------------|
| **前缀键 (Prefix Key)** | tmux, iTerm2 Leader | 按前缀键→进入命令空间→按操作键 | 前缀键天然隔离 |
| **模态 (Modal)** | Zellij, Vim | 切换到特定模式→按键含义改变 | 模式隔离 + locked 模式 |
| **分层直接绑定 (Layered)** | VS Code, iTerm2 | when 子句/Profile 决定按键归属 | 上下文条件评估 |
| **终端接管编辑 (Terminal-Owned Editor)** | Warp | 终端内置编辑器拦截所有输入 | 不存在 shell 层冲突 |

### 1.2 各工具快捷键系统详解

#### tmux — 前缀键 + 键表

- **默认前缀键**: `Ctrl+B`，按下后释放，再按命令键
- **四张键表**: `prefix`（前缀后可用）、`root`（无需前缀）、`copy-mode`、`copy-mode-vi`
- **键链支持**: 通过 `switch-client -T` 创建自定义键表实现 `Ctrl+X x` 式多键序列
- **可重复绑定**: `-r` 标志使按一次前缀后可连续操作（如连续调整面板大小）
- **发现性**: `Ctrl+B ?` 列出所有绑定，支持搜索

| 维度 | 评价 |
|-----|------|
| 冲突避免 | 极好——前缀键隔离了几乎所有冲突 |
| 操作效率 | 中等——每次操作需额外按前缀键 |
| 发现性 | 差——`list-keys` 输出密集，无动态提示 |
| 学习曲线 | 陡峭——需要记忆大量前缀+键的组合 |

#### Zellij — 模态系统

- **13 个模式**: normal、locked、pane、tab、resize、move、scroll、search、session 等
- **两种预设**:
  - 默认：`Ctrl+P` 进入 pane 模式、`Ctrl+T` 进入 tab 模式（快速但与 shell 冲突）
  - 解锁优先：先按 `Ctrl+G` "解锁"，再用单字符进入模式（零冲突但多一步）
- **状态栏实时提示**: 切换模式后底部自动显示该模式下所有可用操作——**发现性最佳**
- **locked 模式**: 除 `Ctrl+G` 外所有按键透传给终端程序

| 维度 | 评价 |
|-----|------|
| 冲突避免 | 好——locked 模式彻底、解锁优先完全避免 |
| 操作效率 | 高（默认预设）/中等（解锁优先） |
| 发现性 | 最佳——状态栏上下文感知提示 |
| 学习曲线 | 平缓——模式+单键操作+即时提示 |

#### kitty — 键盘协议 + 条件映射

- **默认修饰符**: `Ctrl+Shift`（`kitty_mod`），与终端程序极少冲突
- **Kitty Keyboard Protocol**: 革命性的终端键盘协议，解决了几十年的按键歧义（如 Tab 与 Ctrl+I 不可区分），已被 WezTerm、Ghostty、Windows Terminal 采纳
- **多键序列**: `map ctrl+f>2 set_font_size 20`
- **模态映射**: `--new-mode` 创建自定义模式，完全替换默认快捷键
- **条件映射**: `--when-focus-on` 根据当前运行程序动态改变按键行为

| 维度 | 评价 |
|-----|------|
| 冲突避免 | 好——Ctrl+Shift 修饰极少冲突 |
| 灵活性 | 最高——多键序列 + 模态 + 条件映射 |
| 发现性 | 差——无内建帮助界面 |
| 创新性 | 最强——键盘协议是终端领域的重大突破 |

#### iTerm2 — 层级直接绑定 + 全局热键

- **三层架构**: 系统热键（RegisterEventHotKey）→ 全局键映射 → Profile 级键映射
- **Profile 覆盖**: 不同 Profile 可有不同快捷键，适合多场景切换
- **动作类型丰富**: Send Hex Code、Send Escape Sequence、Bypass Terminal、Sequence（串联多个动作）等
- **Quake 风格热键窗口**: 系统级热键召唤专属终端窗口

| 维度 | 评价 |
|-----|------|
| 冲突避免 | 中等——依赖修饰符重映射 |
| macOS 集成 | 最好——完全遵循 macOS 约定 |
| 发现性 | 好——菜单栏标注 + GUI 设置 |
| 跨平台 | 无——仅 macOS |

#### Warp — 终端接管输入编辑

- **核心创新**: 终端内置 Rust 原生编辑器，拦截所有输入，完整的编辑在终端层完成，仅在按回车时将完整命令发送给 shell
- **三层处理**: 输入编辑器 → 应用级命令 → Shell 执行
- **Block 模型**: 命令-输出按 block 组织，`Cmd+Up/Down` 在 block 间导航
- **AI 集成**: `Cmd+I` / `Ctrl+I` 切换 Agent Mode

```
传统终端：键盘 → 终端(透传) → PTY → Shell(readline 编辑) → 回显
Warp：    键盘 → Warp编辑器(完整编辑) → [回车] → PTY → Shell(仅执行)
```

| 维度 | 评价 |
|-----|------|
| 冲突避免 | 最好——从架构上消除了 shell 层的冲突 |
| 编辑体验 | 最好——IDE 级别 |
| 传统兼容 | 差——高度定制的 shell 配置可能不兼容 |

#### VS Code 集成终端 — when 子句系统

- **四层架构**: 默认键绑定 → 扩展贡献 → 用户 keybindings.json → 终端 Shell
- **when 子句**: `"when": "terminalFocus && !terminalTextSelected"` 精确控制任何上下文下的键绑定
- **commandsToSkipShell**: 指定哪些命令的快捷键跳过 shell（默认 ~118 个命令），支持增量修改（`-` 前缀移除）
- **调试工具**: `Developer: Toggle Keyboard Shortcuts Troubleshooting` 实时显示按键分派过程

| 维度 | 评价 |
|-----|------|
| 灵活性 | 极高——when 子句可表达任意上下文条件 |
| 冲突解决 | 最精细——但 commandsToSkipShell 与 sendKeybindingsToShell 交互有 bug |
| 发现性 | 好——快捷键编辑器 + 调试工具 |
| 学习曲线 | 陡峭——需理解 when 子句语法 |

#### Claude Code CLI — 上下文 + 和弦

- **17 个上下文**: Global、Chat、Autocomplete、Confirmation、Task、DiffDialog 等
- **和弦序列**: 支持 `ctrl+k ctrl+s` 式多键序列
- **Vim 模式**: `/vim` 启用，双层架构（Vim 层处理文本编辑，Keybinding 层处理应用动作）
- **完全可配置**: `~/.claude/keybindings.json`，JSON Schema 支持编辑器补全，热加载
- **诊断工具**: `/doctor` 命令诊断快捷键冲突

#### OpenCode — Leader Key

- **默认 Leader**: `Ctrl+X`，所有应用级命令需先按 Leader
- **示例**: `<leader>n` 新会话、`<leader>l` 会话列表、`<leader>b` 切换侧边栏
- **冲突策略**: Leader Key 天然避免与终端程序冲突
- **Shell 模式**: `!` 前缀进入临时 Shell 模式

#### Codex CLI — 硬编码

- **无自定义**: 所有快捷键硬编码在 React+Ink UI 中
- **基本操作**: Enter 提交、`Ctrl+J` 换行、`Ctrl+G` 外部编辑器
- **特殊前缀**: `!` shell 命令、`@` 文件搜索、`/` 斜杠命令

### 1.3 横向对比总结

| 工具 | 架构 | 冲突避免 | 发现性 | 定制 | 创新点 |
|------|------|---------|--------|------|--------|
| tmux | 前缀键+键表 | ★★★★★ | ★★☆ | 高 | 自定义键表/键链 |
| Zellij | 模态 | ★★★★☆ | ★★★★★ | 高 | 状态栏实时提示 |
| kitty | 直接绑定+协议 | ★★★★☆ | ★☆☆ | 最高 | 键盘协议 |
| iTerm2 | 层级直接绑定 | ★★★☆☆ | ★★★★☆ | 中 | Quake 热键窗口 |
| Warp | 终端接管编辑 | ★★★★★ | ★★★☆☆ | 中 | 内置编辑器 |
| VS Code | when 子句 | ★★★★☆ | ★★★★☆ | 最高 | 上下文条件系统 |
| Claude Code | 上下文+和弦 | ★★★★☆ | ★★★☆☆ | 高 | Vim 模式双层架构 |
| OpenCode | Leader Key | ★★★★★ | ★★☆ | 中 | Leader 避冲突 |
| Codex CLI | 硬编码 | ★☆☆ | ★☆☆ | 无 | — |

---

## 2. Composer 作为统一入口的快捷键设计

### 2.1 TermCanvas 当前架构分析

当前 TermCanvas 的键盘事件处理分为三层：

```
第1层：useKeyboardShortcuts() — App 级全局 keydown 监听
  ↓ 检查 shouldIgnoreShortcutTarget()（在 textarea/input 中时忽略非修饰键快捷键）
第2层：ComposerBar onKeyDown — Composer 组件内的按键处理
  ↓ 决定截获 vs 转发到 PTY
第3层：PTY（xterm.js） — 终端模拟器
```

**当前快捷键清单**:
- `Mod+O` — 添加项目
- `Mod+B` — 切换侧边栏
- `Mod+T` — 新建终端
- `Mod+]` / `Mod+[` — 下/上一个终端
- `Mod+E` — 取消/恢复焦点
- `Mod+1/2/3/4` — 尺寸预设

**Composer 当前按键处理**:
- `Enter` — 提交命令
- `Shift+Enter` — 换行
- `Escape` — 转发 PTY
- `Ctrl+C` — 转发 PTY（无选区时）
- `Shift+Tab` — 转发 PTY（Claude Code 模式循环）
- 方向键 — 空草稿时转发 PTY

### 2.2 核心挑战：截获 vs 透传

当 Composer 完全接管终端对话框职能后，必须精确决定每个按键的归属：

```
键盘事件 → Composer 处理？ → 是：执行 Composer/App 命令
                          → 否：透传给 PTY（终端程序）
```

**三类按键的不同处理策略**：

| 按键类别 | 示例 | 策略 |
|---------|------|------|
| **应用快捷键** | Mod+T, Mod+B, Mod+E | 始终由 App 层截获 |
| **Composer 操作键** | Enter, Escape, Tab | Composer 处理，但需考虑上下文 |
| **终端控制键** | Ctrl+C, Ctrl+D, Ctrl+Z | 需要智能分流——有时 Composer 需要（如 Ctrl+C 复制），有时 PTY 需要（如 Ctrl+C 中断） |
| **文本输入键** | 字母、数字、符号 | 默认进入 Composer 文本缓冲区 |
| **终端程序特有键** | Shift+Tab（Claude Code 模式切换）| 根据目标终端类型智能路由 |

### 2.3 关键设计决策

#### 决策 1：快捷键路由策略

**方案 A：Warp 模式——Composer 优先**
- Composer 捕获所有输入，仅在提交时发送到 PTY
- 类似 Warp 的架构：编辑在前端完成，PTY 仅负责执行
- **优点**: 编辑体验一致，无冲突
- **缺点**: 交互式程序（vim, top, htop）无法正常工作；必须有"直通模式"

**方案 B：VS Code 模式——上下文路由**
- 定义 when 子句规则决定按键归属
- 例如：`Ctrl+C` when `composerHasSelection` → 复制；否则 → 转发 PTY
- **优点**: 精细控制，适应各种场景
- **缺点**: 规则复杂，用户难以预测行为

**方案 C：tmux 模式——前缀键隔离（推荐作为基础）**
- 保留现有 `Mod+` 快捷键给应用层
- Composer 日常输入正常编辑
- 终端控制键通过明确的路由规则转发
- **优点**: 用户心智模型简单——"Mod+X 是 App 的，其他的看上下文"

**推荐: 方案 C 为基础，融合方案 B 的上下文感知**。

#### 决策 2：模式切换 vs 无模式

**有模式方案（类 Zellij）**:
- 定义几个模式：编辑模式（默认）、终端直通模式、命令模式
- 优点：每个模式内快捷键简单无冲突
- 缺点：用户需要记住当前模式

**无模式方案（类 Warp）**:
- Composer 始终处于编辑状态
- 通过修饰键区分意图
- 优点：不需要模式感知
- 缺点：可用快捷键空间受限

**推荐: 以无模式为默认体验，但提供可选的终端直通模式**（类似 Zellij 的 locked 模式）。用户可以通过特定快捷键临时将所有按键直通到 PTY，用于交互式终端程序。

#### 决策 3：Prefix Key 可行性

对于 TermCanvas 的场景，**纯 prefix key 方案不推荐**：

原因：
1. TermCanvas 是 Electron 桌面应用，拥有完整的 `Cmd/Ctrl+字母` 修饰键空间——这比终端复用器（tmux/Zellij 在终端内运行，`Ctrl+字母` 大量被 shell 占用）有更大的快捷键空间
2. 用户期望 Electron 应用遵循桌面应用惯例（`Cmd+T` 新建标签、`Cmd+W` 关闭等），而非终端复用器惯例
3. 前缀键增加了每次操作的按键次数，对桌面应用来说不必要

但 **prefix key 可以作为"高级命令入口"的补充**——类似 VS Code 的 `Ctrl+K` 和弦前缀，扩展快捷键命名空间。

### 2.4 终端类型感知路由

TermCanvas 支持 8 种终端类型，不同类型的按键需求差异很大：

| 终端类型 | 特殊按键需求 | Composer 应透传的键 |
|---------|------------|-------------------|
| shell | readline 快捷键 | Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L |
| claude | 模式切换、确认 | Escape, Shift+Tab, Y/N（确认时） |
| codex | 换行、取消 | Ctrl+J, Escape |
| opencode | Leader Key 命令 | Ctrl+X → 后续键 |
| lazygit | 全键盘 TUI | 几乎所有非修饰键 |
| tmux | 前缀键序列 | Ctrl+B → 后续键 |
| kimi / gemini | 类似 claude | Escape, Ctrl+C |

**关键洞察**: lazygit 和 tmux 是**全键盘 TUI 程序**，它们需要几乎所有按键的控制权。对于这些终端类型，Composer 应该自动进入"直通模式"，或至少大幅减少截获的按键。

---

## 3. 创新快捷键交互

### 3.1 三层快捷键分层模型

基于研究，为 TermCanvas 提出一个三层分层模型：

```
┌─────────────────────────────────────────┐
│  第1层：全局层 (Global)                   │
│  Mod+T, Mod+B, Mod+E, Mod+O ...        │
│  → 始终可用，不受焦点/模式影响              │
├─────────────────────────────────────────┤
│  第2层：Composer 层 (Composer)            │
│  Enter, Escape, Tab, Ctrl+K 和弦 ...    │
│  → Composer 有焦点时可用                  │
│  → 上下文感知（根据终端类型调整行为）        │
├─────────────────────────────────────────┤
│  第3层：终端层 (Terminal)                  │
│  Ctrl+C, Ctrl+D, 方向键, 字母键 ...       │
│  → 透传给 PTY 的按键                      │
│  → 根据终端类型和 Composer 状态决定         │
└─────────────────────────────────────────┘
```

**按键路由决策流程**:

```
KeyEvent →
  1. 是 Mod+X 组合？ → 全局层处理
  2. Composer 有焦点？
     2a. 是文本输入键？ → Composer 编辑
     2b. 是 Composer 操作键？ → Composer 处理
     2c. 是终端控制键？ → 查看路由规则 → Composer 处理 or 透传 PTY
  3. 终端直通模式？ → 全部透传 PTY（除 Mod+E 退出直通）
```

### 3.2 上下文感知快捷键

借鉴 VS Code 的 when 子句和 Claude Code 的上下文系统，定义 TermCanvas 特有的上下文：

```typescript
interface ShortcutContext {
  // 焦点状态
  composerFocused: boolean;        // Composer 输入框有焦点
  terminalFocused: boolean;        // 某个终端获得焦点（直通模式）
  sidebarFocused: boolean;         // 侧边栏有焦点

  // Composer 状态
  composerEmpty: boolean;          // 输入框为空
  composerHasSelection: boolean;   // 有文本选区
  composerMultiline: boolean;      // 多行模式

  // 终端类型
  targetTerminalType: TerminalType; // 目标终端类型
  targetTerminalRunning: boolean;   // 终端程序是否在运行中

  // 应用状态
  sidebarVisible: boolean;         // 侧边栏是否可见
  dialogOpen: boolean;             // 是否有对话框打开
}
```

**上下文感知示例**:

| 按键 | 上下文条件 | 行为 |
|------|----------|------|
| `Escape` | composerEmpty && targetType == "claude" | 转发 PTY（取消 Claude Code 操作） |
| `Escape` | !composerEmpty | 清除 Composer 输入 |
| `Escape` | dialogOpen | 关闭对话框 |
| `Ctrl+C` | composerHasSelection | 复制选区 |
| `Ctrl+C` | !composerHasSelection | 转发 PTY（中断程序） |
| `Tab` | targetType == "shell" && composerEmpty | 转发 PTY（shell 补全） |
| `Enter` | targetType == "lazygit" | 转发 PTY（lazygit 确认操作） |

### 3.3 和弦快捷键命名空间

参考 VS Code 的 `Ctrl+K` 和弦和 Spacemacs 的助记分组，为 TermCanvas 设计一个和弦前缀：

**推荐和弦前缀: `Mod+K`**（与 VS Code 一致，用户已有肌肉记忆）

```
Mod+K → 进入"等待第二个键"状态（底部状态栏提示"Mod+K ..."）

Mod+K, T  → 终端相关操作子菜单
Mod+K, S  → 会话/分组操作
Mod+K, L  → 布局操作
Mod+K, P  → 项目操作
```

**具体映射示例**:

```
终端 (T):
  Mod+K, T → 列出终端类型选择器（新建特定类型终端）
  Mod+K, R → 重命名当前终端
  Mod+K, X → 关闭当前终端

布局 (L):
  Mod+K, 1/2/3/4 → 尺寸预设（替代当前 Mod+1/2/3/4，释放数字键）
  Mod+K, L → 循环布局模式

会话 (S):
  Mod+K, S → 保存会话
  Mod+K, O → 打开已保存会话
```

### 3.4 Which-Key 式弹窗提示

借鉴 which-key.nvim 和 Zellij 的状态栏，在 Composer 底部实现**上下文感知的快捷键提示**：

**设计要求**:
1. 按下和弦前缀（如 `Mod+K`）后 300ms，如果未按后续键，显示弹窗列出所有可用操作
2. 弹窗按类别分组（终端、布局、项目），每个操作有简短描述
3. 弹窗不阻塞——继续按键直接执行，按 `Escape` 取消
4. 高级用户可配置 `timeout` 或完全禁用弹窗

**弹窗示例**:

```
┌─ Mod+K ─────────────────────────────┐
│ T  新终端类型选择    R  重命名终端     │
│ X  关闭终端         S  保存会话       │
│ 1  默认尺寸         2  宽屏          │
│ 3  高屏            4  全屏          │
│ /  命令面板                          │
└──────────────────────────────────────┘
```

### 3.5 命令面板

为 TermCanvas 增加命令面板（类似 VS Code `Cmd+Shift+P`），作为**快捷键的可搜索补充**：

**建议触发方式**: `Mod+Shift+P` 或 `Mod+K, /`

**功能**:
- 模糊搜索所有可用命令
- 每个命令右侧显示对应快捷键（被动学习机制）
- 支持前缀过滤：`>` 执行命令、`@` 跳转到终端、`#` 搜索历史
- 最近使用的命令排在前面
- 上下文感知：只显示当前状态下可用的命令

### 3.6 终端直通模式

针对 lazygit、tmux、vim 等需要全键盘控制的终端程序：

**触发方式**: `Mod+E` 的增强版——当前 `Mod+E` 已用于 "unfocus/refocus"，可以扩展为三态循环：

```
状态 1: Composer 焦点（默认） — 按键优先进入 Composer
  ↓ Mod+E
状态 2: 终端直通模式 — 除 Mod+E 外所有按键透传 PTY
  ↓ Mod+E
状态 3: 无焦点 — 快捷键全部走全局层
  ↓ Mod+E
回到状态 1
```

**自动检测**: 当目标终端类型为 lazygit 或 tmux 时，自动进入直通模式。

### 3.7 快捷键可定制化

参考 Claude Code 的 keybindings.json 和 VS Code 的 keybindings 系统：

```jsonc
// termcanvas-keybindings.json
{
  "shortcuts": {
    // 全局层
    "global.newTerminal": "mod+t",
    "global.toggleSidebar": "mod+b",
    "global.addProject": "mod+o",
    "global.nextTerminal": "mod+]",
    "global.prevTerminal": "mod+[",
    "global.cycleFocus": "mod+e",
    "global.commandPalette": "mod+shift+p",

    // 和弦
    "chord.prefix": "mod+k",
    "chord.renameTerminal": "mod+k r",
    "chord.closeTerminal": "mod+k x",
    "chord.sizePreset1": "mod+k 1",

    // Composer 层
    "composer.submit": "enter",
    "composer.newline": "shift+enter",
    "composer.clear": "escape",
    "composer.pasteImage": "mod+v"
  }
}
```

---

## 4. 具体设计建议

### 4.1 完整快捷键方案

#### 第1层：全局快捷键（始终可用）

| 快捷键 | 动作 | 备注 |
|--------|------|------|
| `Mod+T` | 新建终端 | 保持不变 |
| `Mod+W` | 关闭当前终端 | 新增，符合桌面应用惯例 |
| `Mod+B` | 切换侧边栏 | 保持不变 |
| `Mod+O` | 添加项目 | 保持不变 |
| `Mod+]` | 下一个终端 | 保持不变 |
| `Mod+[` | 上一个终端 | 保持不变 |
| `Mod+1~9` | 切换到第 N 个终端 | 新增，快速切换（释放尺寸预设到和弦层） |
| `Mod+E` | 循环焦点模式 | 保持，扩展为三态 |
| `Mod+Shift+P` | 命令面板 | 新增 |
| `Mod+K` | 和弦前缀 | 新增 |
| `Mod+,` | 打开设置 | 新增，符合 macOS 惯例 |

#### 第2层：Composer 快捷键（Composer 有焦点时）

| 快捷键 | 动作 | 上下文条件 |
|--------|------|----------|
| `Enter` | 提交命令 | — |
| `Shift+Enter` | 插入换行 | — |
| `Escape` | 清除输入 / 转发 PTY | 有内容→清除；空→转发 |
| `Ctrl+C` | 复制 / 中断 PTY | 有选区→复制；无→转发 |
| `Ctrl+L` | 清除终端屏幕 | 转发 PTY |
| `Tab` | 补全 / 转发 PTY | 有补全建议→接受；否则→转发 |
| `Shift+Tab` | 转发 PTY | Claude Code 模式循环 |
| `Up/Down` | 历史 / 转发 PTY | 有草稿→历史导航；空→转发 |
| `Ctrl+A` | 移到行首 | Composer 编辑 |
| `Ctrl+E` | 移到行尾 | Composer 编辑 |
| `Ctrl+K` | 删除到行尾 | Composer 编辑（注意与和弦前缀区分——Mod+K 是和弦，Ctrl+K 是编辑） |
| `Ctrl+U` | 删除到行首 | Composer 编辑 |
| `Ctrl+W` | 删除前一个词 | Composer 编辑 |

#### 第3层：和弦快捷键（Mod+K 后）

| 和弦序列 | 动作 |
|---------|------|
| `Mod+K, T` | 终端类型选择器（新建指定类型终端） |
| `Mod+K, R` | 重命名当前终端 |
| `Mod+K, X` | 关闭当前终端 |
| `Mod+K, 1` | 尺寸预设 1×1 |
| `Mod+K, 2` | 尺寸预设 2×1 |
| `Mod+K, 3` | 尺寸预设 1×2 |
| `Mod+K, 4` | 尺寸预设 2×2 |
| `Mod+K, S` | 保存工作区/会话 |
| `Mod+K, /` | 命令面板（替代入口） |
| `Mod+K, ?` | 快捷键帮助 |

### 4.2 按键路由实现建议

```typescript
// 按键路由优先级处理
function handleKeyEvent(event: KeyboardEvent): 'handled' | 'passthrough' {
  const ctx = getCurrentContext();

  // 第1优先级：全局快捷键（始终截获）
  if (matchGlobalShortcut(event)) {
    executeGlobalAction(event);
    return 'handled';
  }

  // 第2优先级：终端直通模式（除全局快捷键外全部透传）
  if (ctx.passthroughMode) {
    forwardToPTY(event);
    return 'passthrough';
  }

  // 第3优先级：和弦序列（等待第二个键）
  if (isChordPrefix(event) || isInChordWait()) {
    handleChord(event);
    return 'handled';
  }

  // 第4优先级：对话框/弹窗（如果有打开的 UI 组件）
  if (ctx.dialogOpen) {
    handleDialogKey(event);
    return 'handled';
  }

  // 第5优先级：Composer 上下文路由
  if (ctx.composerFocused) {
    const rule = findRoutingRule(event, ctx);
    if (rule.target === 'composer') {
      handleComposerKey(event);
      return 'handled';
    }
    if (rule.target === 'pty') {
      forwardToPTY(event);
      return 'passthrough';
    }
  }

  // 默认：透传
  return 'passthrough';
}
```

### 4.3 终端类型感知路由规则

```typescript
// 基于终端类型的路由规则
const terminalRouting: Record<TerminalType, RoutingConfig> = {
  shell: {
    autoPassthrough: false,
    forwardKeys: ['Ctrl+C', 'Ctrl+D', 'Ctrl+Z', 'Ctrl+L'],
    forwardWhenEmpty: ['Tab', 'Up', 'Down'],
  },
  claude: {
    autoPassthrough: false,
    forwardKeys: ['Ctrl+C', 'Escape', 'Shift+Tab'],
    // Claude Code 确认对话框时需要转发 Y/N
    forwardWhenEmpty: ['Up', 'Down'],
  },
  codex: {
    autoPassthrough: false,
    forwardKeys: ['Ctrl+C', 'Escape', 'Ctrl+J'],
    forwardWhenEmpty: ['Up', 'Down'],
  },
  opencode: {
    autoPassthrough: false,
    // OpenCode 自身使用 Ctrl+X 作为 Leader Key
    forwardKeys: ['Ctrl+C', 'Escape', 'Ctrl+X'],
    forwardWhenEmpty: ['Up', 'Down'],
  },
  lazygit: {
    autoPassthrough: true,  // TUI 程序，自动进入直通模式
    passthroughExceptions: [], // 无例外，所有非全局键都透传
  },
  tmux: {
    autoPassthrough: true,  // 终端复用器，自动直通
    passthroughExceptions: [],
  },
  kimi: {
    autoPassthrough: false,
    forwardKeys: ['Ctrl+C', 'Escape'],
    forwardWhenEmpty: ['Up', 'Down'],
  },
  gemini: {
    autoPassthrough: false,
    forwardKeys: ['Ctrl+C', 'Escape'],
    forwardWhenEmpty: ['Up', 'Down'],
  },
};
```

### 4.4 发现性设计建议

**四层发现性机制**（从新手到高级用户）:

1. **命令面板** (`Mod+Shift+P`)
   - 新手首选入口，可搜索所有命令
   - 每个命令右侧显示快捷键
   - 首次打开显示"最常用命令"

2. **Which-Key 弹窗** (`Mod+K` 后 300ms 无操作时)
   - 中级用户的渐进学习工具
   - 显示当前和弦前缀下所有可用操作
   - 不阻塞正常使用

3. **Composer 状态栏提示**
   - 底部轻量提示当前模式和关键快捷键
   - 终端直通模式时显示 `[直通模式] Mod+E 退出`
   - 和弦等待时显示 `Mod+K ...`

4. **快捷键参考面板** (`Mod+K, ?`)
   - 完整的快捷键列表，按类别分组
   - 标记哪些快捷键已被自定义
   - 支持搜索

### 4.5 肌肉记忆兼容性

**保留的肌肉记忆**:
- `Mod+T` 新标签/终端（浏览器/IDE 通用）
- `Mod+W` 关闭标签（浏览器/IDE 通用）
- `Mod+B` 切换侧边栏（VS Code）
- `Mod+Shift+P` 命令面板（VS Code）
- `Mod+K` 和弦前缀（VS Code）
- `Mod+1~9` 切换标签（浏览器/VS Code）
- `Mod+]` / `Mod+[` 切换标签（Chrome/VS Code）
- `Enter` 提交、`Shift+Enter` 换行（聊天应用通用）
- `Ctrl+A/E/K/U/W` readline 编辑（终端通用）
- `Ctrl+C/D/Z` 终端信号（Unix 通用）

**从当前方案的迁移**:
- `Mod+1/2/3/4` 从尺寸预设 → 改为终端切换。尺寸预设迁移到 `Mod+K, 1/2/3/4`。
  - 理由：终端切换是高频操作（每分钟多次），尺寸调整是低频操作（偶尔一次）。高频操作应该用最快的快捷键。
- `Mod+E` 保持"焦点切换"语义，但扩展为三态循环。

### 4.6 跨平台考虑

| 维度 | macOS | Windows/Linux |
|------|-------|---------------|
| `Mod` 映射 | `Cmd` | `Ctrl` |
| 快捷键显示 | ⌘⇧⌥⌃ 符号 | Ctrl+Shift+Alt 文字 |
| 系统快捷键冲突 | `Cmd+H`(隐藏)、`Cmd+M`(最小化)、`Cmd+Q`(退出) | `Ctrl+Alt+Del`、`Win+L` |
| 避免占用 | 不要绑定 `Cmd+H/M/Q/Tab` | 不要绑定 `Ctrl+Alt+Del` |
| Option/Alt 键 | macOS 的 Option 用于输入特殊字符，避免用 Option+字母 | Alt 可自由使用 |

**已有方案兼容性**:
- 当前 `matchesShortcut()` 已正确处理 `mod` → 平台修饰符的映射
- `formatShortcut()` 已处理符号显示
- 新增快捷键应继续使用 `mod+` 前缀

### 4.7 可扩展性设计

**未来可能需要的扩展点**:

1. **用户自定义快捷键**: 参考 Claude Code 的 `keybindings.json`，在 `~/.termcanvas/keybindings.json` 中允许覆盖所有默认绑定

2. **终端类型插件**: 新增终端类型时，只需在路由规则中添加该类型的配置

3. **宏/序列录制**: 将多个操作录制为一个快捷键（参考 vim 的 `q` 宏录制和 iTerm2 的 Sequence 动作）

4. **条件路由扩展**: 支持用户定义自定义路由规则：
```jsonc
{
  "routing": [
    {
      "key": "Ctrl+P",
      "when": "targetTerminalType == 'shell' && composerEmpty",
      "action": "forwardToPTY"
    }
  ]
}
```

### 4.8 推荐的实施优先级

| 阶段 | 内容 | 价值 |
|------|------|------|
| **P0** | 上下文感知路由（基于终端类型的透传规则） | 解决现有冲突问题 |
| **P0** | 终端直通模式（`Mod+E` 三态） | lazygit/tmux 可用性 |
| **P1** | `Mod+1~9` 终端切换 + 尺寸预设迁移到和弦 | 提升高频操作效率 |
| **P1** | `Mod+K` 和弦前缀 + Which-Key 弹窗 | 扩展快捷键空间 + 发现性 |
| **P2** | 命令面板 (`Mod+Shift+P`) | 新手友好入口 |
| **P2** | 快捷键自定义 (keybindings.json) | 高级用户需求 |
| **P3** | Composer 状态栏提示 | 完善发现性体验 |
| **P3** | 快捷键参考面板 | 文档和学习 |

---

## 附录 A：研究来源

### 终端复用器/模拟器
- tmux: 前缀键 + 键表系统，`bind-key`、`switch-client -T`、key table 架构
- Zellij: 模态系统（13 种模式）、解锁优先预设、状态栏实时提示
- kitty: Kitty Keyboard Protocol、条件映射 (`--when-focus-on`)、模态映射 (`--new-mode`)
- iTerm2: Profile 级键映射、Quake 热键窗口、修饰符重映射
- Alacritty: TOML 配置、Vi/Search 模式系统

### AI CLI 工具
- Claude Code: 17 个上下文、和弦序列、Vim 模式双层架构、keybindings.json
- Codex CLI: 硬编码 React+Ink、`Ctrl+J` 换行
- OpenCode: `Ctrl+X` Leader Key、Go BubbleTea TUI
- Gemini CLI: VS Code 风格 keybindings.json、Shell 模式
- Aider: prompt-toolkit Emacs/Vi 风格、`--vim` 标志
- Kiro CLI: settings 命令配置少量按键

### 现代终端应用
- Warp: Rust 原生编辑器接管输入、Block 模型、Agent Mode
- VS Code Terminal: when 子句系统、commandsToSkipShell、四层键绑定架构
- Hyper: Electron + Redux、插件扩展热键

### 交互设计模式
- Vim 模态编辑: 操作符 + 动作组合语法、Operator-pending 模式
- Helix/Kakoune: selection-first 模式——先选后操作
- which-key.nvim: 超时弹窗提示、Hydra 持续模式
- VS Code 和弦: `Ctrl+K` 前缀命名空间
- Spacemacs/Doom Emacs: 助记层级组织（`SPC f s` = File Save）
- 命令面板: 模糊搜索、被动学习（显示快捷键）、前缀过滤
