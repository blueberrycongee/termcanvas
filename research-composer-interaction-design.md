# 终端应用中 Composer 的交互设计研究报告

> 研究背景：TermCanvas 是一个基于 Electron 的无限画布终端管理器，拥有统一输入入口 Composer，可向 AI CLI 终端和普通终端发送输入。本报告对 Composer 的交互逻辑及与终端创新结合方式进行深入研究。

---

## 一、Composer 在终端场景中的核心价值定位

### 1.1 为什么需要 Composer？

终端本质上是一个字节流管道（byte pipe）。传统终端输入存在根本性限制：

| 限制 | 说明 |
|------|------|
| 无原生文本编辑 | Cmd+A 全选、点击定位光标、拖拽选择等 OS 原生操作均不可用 |
| 多行编辑困难 | 依赖 shell 的 readline 能力，arrow keys 常触发历史导航而非文本导航 |
| 无 Undo/Redo | 误删长命令无法撤回 |
| 无富媒体输入 | 无法直接粘贴图片、附加文件 |
| 输入与输出混杂 | prompt 和 output 在同一文本流中，复杂场景下难以区分 |

**Composer 的核心价值在于将「编辑面」从「终端仿真层」中剥离出来**，提供原生 OS 级别的文本编辑体验。

这一模式已被多个产品验证：
- **iTerm2 Composer Window**：浮动的 macOS 原生文本编辑区，用 Cmd+Return 将编辑好的文本发送到 shell
- **iTerm2 Auto Composer**：更激进地直接替换 shell prompt 为原生文本控件
- **Warp Terminal**：将输入区重新设计为 IDE 风格的编辑器，与输出区物理分离
- **Fig/Amazon Q**：在现有终端上叠加原生自动补全 UI

### 1.2 Composer 对 TermCanvas 的特殊价值

TermCanvas 作为多终端画布管理器，Composer 还承担了超出单终端场景的职责：

| 价值维度 | 说明 |
|----------|------|
| **统一输入路由** | 一个入口向多种终端类型（AI CLI / shell / tmux）发送输入，屏蔽底层差异 |
| **输入模式适配** | 自动处理 type（直接键入）vs paste（剪贴板粘贴）的差异，用户无需关心 |
| **富媒体传输** | 支持图片粘贴并通过剪贴板中转发送给 AI CLI |
| **编辑 → 发送 解耦** | 多行 prompt 可以在发送前充分编辑，避免在 AI CLI 中误提交半成品 |
| **画布级操作中枢** | 在无限画布场景中提供稳定的输入锚点，避免用户在多终端间迷失 |

### 1.3 Composer 的劣势与风险

| 风险 | 说明 | 缓解策略 |
|------|------|----------|
| **间接性** | 多了一层中介，增加认知负担 | 保持透明：显示目标终端、输入模式 |
| **焦点竞争** | Composer 和终端抢夺键盘焦点 | 明确的焦点切换模型（见第三节） |
| **延迟感** | paste 模式需要剪贴板操作，有感知延迟 | 优化 paste 流程，减少 delay |
| **上下文断裂** | 用户在 Composer 编辑时看不到终端的最新输出 | Composer 半透明或 overlay 模式 |

### 1.4 最有价值的场景排序

1. **AI CLI 交互**（最高价值）— 多行 prompt 构建、图片附加、模板复用
2. **复杂命令编辑** — 长管道命令、多行脚本、需要反复修改的命令
3. **多终端广播** — 同一命令发送到多个终端（运维场景）
4. **快速终端切换输入** — 不需要点击终端再打字，直接在 Composer 中切换目标

---

## 二、Composer 与终端的创新结合方式

### 2.1 业界模式对比

| 产品 | 模式 | 输入位置 | AI 接入方式 | 核心理念 |
|------|------|----------|-------------|----------|
| **Warp** | 输入区即终端输入（重新设计） | 底部/顶部/经典（三种可选） | 同一输入区，`#` 前缀触发 AI | 重新定义终端本身 |
| **VS Code** | AI 叠加在标准终端之上 | 终端 prompt 位置不变 | Ctrl+I 浮层、@terminal 聊天、Agent 模式 | 兼容优先，多层接入 |
| **Cursor** | AI 面板编排终端作为工具 | Composer 面板（侧边栏/浮窗） | Composer 是主界面，终端是被调用的工具 | 编排优先 |
| **iTerm2** | 独立编辑窗口 + 终端 | 浮动窗口或替换 prompt | Auto Composer 可接入 AI 补全 | 编辑体验优先 |

### 2.2 TermCanvas 可借鉴的创新方向

#### 方向 A：Warp 式「输入位置可配置」

Warp 提供三种输入位置：底部固定（默认，类似聊天应用）、顶部固定（符合阅读习惯）、经典模式（随输出流动）。

**对 TermCanvas 的启发**：
- Composer 当前固定在底部，可以考虑支持**停靠到 focused 终端附近**（而非全局底部）
- 在画布场景中，Composer 可以作为**浮动窗口**跟随终端移动
- 或提供「内联模式」，将 Composer 嵌入终端 tile 的底部

#### 方向 B：VS Code 式「多层次 AI 接入」

VS Code 提供三个不同深度的 AI 接入面：
1. **Inline Chat**（Ctrl+I）— 终端上的浮层，快速命令查找
2. **Chat Participant**（@terminal）— 侧边栏深度对话
3. **Agent Mode** — 自动执行终端命令

**对 TermCanvas 的启发**：
- 当前 Composer 是单一层次。可以分化为：
  - **快速模式**：简单命令，Enter 直接发送（类似 Warp 的 `#` 前缀）
  - **编辑模式**：多行编辑，Cmd+Enter 发送（当前模式）
  - **Agent 模式**：AI 自动执行命令序列，显示审批按钮

#### 方向 C：Cursor 式「Composer 作为指挥中心」

Cursor 的 Composer 不仅发送终端命令，还编排代码编辑、文件搜索等。Terminal 是 Composer 可调用的工具之一。

**对 TermCanvas 的启发**：
- Composer 可以不仅发送文本，还可以**触发画布操作**：
  - `/split` — 分割终端
  - `/new claude` — 创建新 Claude 终端
  - `/broadcast on` — 开启广播模式
  - `@terminal-name` — 切换目标终端
- 这将 Composer 从「输入框」升级为「命令中枢」

#### 方向 D：iTerm2 式「Auto Composer 替换 prompt」

iTerm2 的 Auto Composer 直接用原生文本控件替换 shell prompt，依赖 shell integration 检测 prompt 位置。

**对 TermCanvas 的启发**：
- 对于支持 shell integration 的终端，可以在 xterm 渲染区直接叠加原生输入控件
- 这消除了 Composer 与终端的距离感，但实现复杂度高

### 2.3 推荐的组合策略

```
┌─────────────────────────────────────────────────────┐
│                    TermCanvas 画布                     │
│                                                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│  │ Terminal  │   │ Claude   │   │ Shell    │         │
│  │   Tile    │   │   Tile   │   │  Tile    │         │
│  │          │   │  (focus) │   │          │         │
│  └──────────┘   └──────────┘   └──────────┘         │
│                       ▲                               │
│                       │ 输入路由                       │
│  ┌────────────────────┴──────────────────────────┐   │
│  │              Composer Bar                      │   │
│  │  [@claude] > 请帮我重构这个函数...              │   │
│  │  [图片预览] [模板] [历史]        [Cmd+Enter ▶] │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**核心建议**：保持当前底部 Composer 作为默认模式，同时增加：
1. **`@` 提及切换目标** — 不需要先点击终端再打字
2. **`/` 命令** — 触发画布操作
3. **快捷键模式切换** — 单行快速模式 vs 多行编辑模式
4. **浮动定位选项** — 可选将 Composer 停靠到 focused tile 旁边

---

## 三、输入路由和焦点管理的最佳实践

### 3.1 当前 TermCanvas 焦点模型分析

当前实现：
- 单终端 focus 模型，任何时刻最多一个终端 `focused: true`
- 点击终端 → `setFocusedTerminal(id)` → 取消其他终端焦点
- Composer 根据 `terminal.focused === true` 确定目标
- 键盘快捷键（Ctrl+`、Ctrl+Shift+`）可循环切换焦点

**问题**：Composer 和终端存在焦点竞争 — 当用户在 Composer 中输入时，浏览器焦点在 Composer 的 textarea 上，而非 xterm 的隐藏 textarea 上。当用户点击终端时，焦点转移到 xterm，Composer 失去焦点。

### 3.2 业界焦点管理模式

#### Slack 的 FocusTransitionManager（黄金标准）

Slack 构建了集中式的 `FocusTransitionManager`，关键设计：

- **唯一焦点键**：每个组件注册 `focusKey` 标识符
- **双向协商**：`transitionFocusTo()` 请求焦点，`shouldTransitionFocus()` 确认就绪
- **强制焦点**：Composer 使用 `forceFocus: true`，因为打字是最可能的下一步操作
- **键盘用户检测**：仅对键盘用户触发焦点转移，鼠标用户不受干扰
- **并发控制**：优先处理进行中的焦点请求，忽略后续请求

#### VS Code 的条件命令路由

同一快捷键根据焦点上下文触发不同命令：

```json
{ "key": "ctrl+`", "command": "terminal.focus", "when": "!terminalFocus" }
{ "key": "ctrl+`", "command": "editor.focus", "when": "terminalFocus" }
```

上下文变量（`terminalFocus`、`editorFocus`、`panelFocus`）决定可用命令。

#### tldraw 的应用级焦点状态机

tldraw 维护独立于浏览器焦点的内部焦点状态：
- `editor.focus()` / `editor.blur()` 控制是否响应键盘
- 原因：浏览器焦点对 iframe、portalled menu 不可靠
- 同页面多个编辑器实例需要手动管理 `autoFocus={false}`

### 3.3 TermCanvas 焦点模型改进建议

#### 建议 1：建立三层焦点模型

```
Layer 1: Canvas Focus（画布级）
  - 画布是否是活跃窗口
  - 影响全局快捷键是否生效

Layer 2: Region Focus（区域级）
  - Composer / Terminal Tile / Canvas Background
  - 决定键盘输入路由到哪个区域

Layer 3: Target Focus（目标级）
  - 哪个终端是 Composer 的目标
  - 独立于 Region Focus — 即使焦点在 Composer 上，目标终端仍有视觉指示
```

**关键区分**：「Composer 拥有键盘焦点」和「Terminal X 是 Composer 的目标」是两个独立状态。当前实现将它们混合在 `terminal.focused` 中。

#### 建议 2：焦点指示必须多信号

| 信号类型 | 实现 |
|----------|------|
| 边框颜色 | focused terminal 有 accent 色边框（当前已有） |
| 透明度 | 非 focused 终端降低不透明度（参考 Ghostty） |
| 光标状态 | focused 终端显示活跃光标，其他显示空心光标 |
| Composer 指示器 | Composer 内显示目标终端名称和颜色标识 |

#### 建议 3：确定性焦点移动

```
Escape        → 从 Composer 转移焦点到目标终端
/ 或直接打字  → 从终端转移焦点到 Composer
Ctrl+`        → 在终端之间循环
Tab           → 在 Composer 和终端之间切换（参考 F6 模式）
```

#### 建议 4：防止焦点偷窃

- 终端状态更新（输出刷新、状态变化）不应抢夺焦点
- 新终端创建应设为 focused，但不应从 Composer 抢走键盘焦点
- 参考 Wayland 的激活令牌机制：只有用户动作（点击、快捷键）才能触发焦点变化

### 3.4 Broadcast 模式设计

#### 业界 Broadcast 模式对比

| 产品 | 激活方式 | 范围 | 视觉指示 | 选择性 |
|------|----------|------|----------|--------|
| **iTerm2** | Cmd+Shift+I | 所有标签/当前标签 | Tab 图标 + 边框高亮 | API 支持非对称广播 |
| **tmux** | `setw synchronize-panes` | 当前 window | 需手动配置 | 仅 window 级别 |
| **Terminator** | Alt+O/A/G | Off/All/Group | 红/蓝/灰 三色标题栏 | 命名分组 |
| **Kitty** | 自定义快捷键 | 正则匹配 | 单独广播窗口 | 强大的 match 表达式 |

#### TermCanvas Broadcast 建议

```
┌─ Broadcast 模式设计 ─────────────────────────────┐
│                                                    │
│  激活：Composer 工具栏中的 broadcast 按钮           │
│       或 /broadcast 命令                           │
│                                                    │
│  三级范围：                                        │
│  1. Off（默认）— 仅发送到 focused 终端             │
│  2. Group — 发送到选中的终端组                     │
│  3. All — 发送到所有同类型终端                     │
│                                                    │
│  视觉指示：                                        │
│  - Composer 栏变色（amber/orange 警告色）           │
│  - 目标终端 tile 边框变为广播色                     │
│  - 非目标终端保持默认外观                          │
│  - Composer 内显示 "Broadcasting to N terminals"   │
│                                                    │
│  安全措施：                                        │
│  - 默认范围为当前画布视口内终端                     │
│  - 跨项目广播需要二次确认                          │
│  - 提供 preview 模式：显示将收到输入的终端列表      │
│  - Ctrl+C 等危险操作在广播模式下需要确认            │
└──────────────────────────────────────────────────┘
```

---

## 四、多行编辑和 Prompt 构建的交互设计

### 4.1 多行编辑

#### 当前实现
- 4 行高 textarea
- Shift+Enter 换行，Enter 提交
- 支持文本和图片

#### 改进建议

| 特性 | 说明 | 优先级 |
|------|------|--------|
| **自适应高度** | 根据内容自动扩展，设置 min-height（2行）和 max-height（50% 视口）| 高 |
| **语法高亮** | 对 shell 命令进行基础语法着色（使用 CodeMirror 或类似方案） | 中 |
| **括号匹配** | 高亮匹配的 `()` `{}` `[]` | 中 |
| **行号** | 多行模式下显示行号 | 低 |
| **代码折叠** | 超长 prompt 可折叠部分 | 低 |

参考 Warp 的输入区设计：
- 最小高度 48px，最大高度 200px
- 支持点击定位光标
- 支持 Word 级导航（Option+Arrow）
- 支持多光标（Option+Click）
- 完整的 Undo/Redo

### 4.2 模板/Snippet 系统

#### 设计建议

```
┌─ Prompt 模板系统 ────────────────────────────────┐
│                                                    │
│  触发方式：                                        │
│  - 输入 / 显示命令面板                             │
│  - Ctrl+Shift+P 打开模板选择器                     │
│  - 右键菜单 → "Insert Template"                   │
│                                                    │
│  模板类型：                                        │
│  1. 用户自定义模板                                 │
│     - 保存常用 prompt 为模板                       │
│     - 支持变量占位符：${filename}, ${selection}     │
│     - 支持分类和标签                               │
│                                                    │
│  2. 上下文模板                                     │
│     - 根据目标终端类型自动推荐                     │
│     - Claude → AI prompt 模板                     │
│     - Shell → 常用命令模板                        │
│                                                    │
│  3. 参数化模板（参考 Warp Workflows）              │
│     - 模板中的参数以表单形式填写                   │
│     - 例：deploy ${env} ${version}                │
│     - 填写后生成最终命令                           │
│                                                    │
│  存储：                                            │
│  - ~/.termcanvas/templates/                        │
│  - 项目级 .termcanvas/templates/                   │
│  - 支持导入/导出（JSON 格式）                      │
└──────────────────────────────────────────────────┘
```

### 4.3 历史记录

#### 设计建议

```
┌─ 历史记录系统 ──────────────────────────────────┐
│                                                    │
│  触发方式：                                        │
│  - ↑/↓ 箭头键（当 Composer 为空或光标在首/末行）    │
│  - Ctrl+R 打开历史搜索面板                         │
│                                                    │
│  历史维度：                                        │
│  1. 全局历史 — 所有输入记录，按时间排序             │
│  2. 终端类型历史 — 按 Claude/Shell/etc 分类        │
│  3. 项目历史 — 按 worktree 分组                   │
│                                                    │
│  搜索：                                            │
│  - 模糊匹配（类似 fzf）                           │
│  - 支持按终端类型筛选                              │
│  - 显示时间戳和目标终端                            │
│                                                    │
│  特殊行为：                                        │
│  - AI CLI 历史不包含 AI 回复，只保留用户 prompt     │
│  - 敏感命令（含密码/token）可标记为不保存          │
│  - 历史条目可收藏为模板                            │
└──────────────────────────────────────────────────┘
```

### 4.4 补全系统

#### 设计建议

参考 Fig/Amazon Q 的补全架构：

```
┌─ 补全系统 ──────────────────────────────────────┐
│                                                    │
│  层次：                                            │
│  1. 目标终端补全                                   │
│     - @terminal-name — 切换目标终端                │
│     - 模糊匹配终端名称                            │
│                                                    │
│  2. 命令补全（/commands）                          │
│     - /broadcast, /split, /new, /template 等       │
│     - 带描述和参数提示                             │
│                                                    │
│  3. 模板补全                                       │
│     - 基于输入前缀匹配模板名称                     │
│                                                    │
│  4. 历史补全                                       │
│     - ghost text（灰色文本预览）                   │
│     - Tab 接受，继续输入忽略                       │
│                                                    │
│  UI：                                              │
│  - 浮动面板，在 Composer 上方显示                   │
│  - 最多显示 5-8 条建议                             │
│  - 箭头键导航，Tab/Enter 选择                      │
│  - Escape 关闭                                     │
└──────────────────────────────────────────────────┘
```

---

## 五、综合设计建议与优先级

### 5.1 短期改进（低成本高收益）

| # | 改进 | 理由 |
|---|------|------|
| 1 | **自适应 Composer 高度** | 当前固定 4 行，浪费空间或不够用。参考 Warp 的 48-200px 方案 |
| 2 | **增强焦点视觉指示** | 添加非 focused 终端的透明度降低（opacity: 0.7），强化目标感知 |
| 3 | **Escape 键焦点切换** | Composer 中按 Escape → 焦点到终端；终端中开始打字 → 焦点到 Composer |
| 4 | **历史记录（↑/↓）** | 基础但高频需求，参考 shell history 的 ↑/↓ 导航 |
| 5 | **Composer 显示目标终端类型图标** | 让用户在输入前确认目标 |

### 5.2 中期增强（架构性改进）

| # | 改进 | 理由 |
|---|------|------|
| 6 | **三层焦点模型** | 分离 Region Focus 和 Target Focus，解决焦点竞争 |
| 7 | **`@` 提及切换目标** | 不用点击终端就能切换 Composer 目标 |
| 8 | **`/` 命令系统** | 将 Composer 升级为命令中枢 |
| 9 | **模板/Snippet 系统** | 复用常见 prompt，提高效率 |
| 10 | **Broadcast 基础版** | 支持向同类型终端广播输入 |

### 5.3 长期创新（差异化功能）

| # | 改进 | 理由 |
|---|------|------|
| 11 | **Composer 浮动/内联模式** | 可选将 Composer 停靠到 focused tile 附近 |
| 12 | **多层次 AI 接入** | 快速模式/编辑模式/Agent 模式三级分化 |
| 13 | **参数化模板（Workflows）** | 参考 Warp Workflows，模板中的变量以表单填写 |
| 14 | **上下文感知补全** | 根据目标终端类型和当前 CWD 提供智能补全 |
| 15 | **Broadcast 分组管理** | 参考 Terminator 的命名分组系统 |

### 5.4 设计原则总结

1. **Composer 是指挥中心，不仅是输入框** — 它应该能路由输入、切换目标、触发画布操作
2. **焦点状态透明可预测** — 用户任何时刻都应知道：键盘输入去哪里？Composer 目标是谁？
3. **渐进式复杂度** — 默认行为简单（Enter 发送到 focused 终端），高级功能通过 `@` `/ ` 前缀触发
4. **输入模式差异对用户不可见** — type vs paste 是实现细节，Composer 应完全屏蔽
5. **安全第一的广播** — 广播模式必须有明显视觉提示和安全边界

---

## 附录：竞品功能矩阵

| 功能 | Warp | VS Code | Cursor | iTerm2 | Zellij | TermCanvas（当前） | TermCanvas（建议） |
|------|------|---------|--------|--------|--------|-------------------|-------------------|
| 分离的输入区 | ✅ IDE 风格 | ❌ 标准 prompt | ✅ Composer 面板 | ✅ Composer Window | ❌ | ✅ | ✅ 增强 |
| 多行编辑 | ✅ Shift+Enter | ❌ 反斜杠续行 | ✅ | ✅ 原生编辑 | ❌ | ✅ 4行 | ✅ 自适应高度 |
| 输入位置可配置 | ✅ 底/顶/经典 | ❌ | ✅ 侧边/浮窗/全屏 | ✅ 浮窗 | ❌ | ❌ 固定底部 | ✅ 底部/浮动/内联 |
| AI 集成 | ✅ `#` 前缀 | ✅ Ctrl+I / @terminal | ✅ Agent 模式 | ✅ Auto Composer AI | ❌ | 间接（AI CLI） | ✅ 多层次 |
| 广播输入 | ❌ | ❌ | ❌ | ✅ Cmd+Shift+I | ❌ | ❌ | ✅ 分组广播 |
| 模板/Snippet | ✅ Workflows | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 参数化模板 |
| 历史记录 | ✅ | shell 原生 | ✅ | shell 原生 | shell 原生 | ❌ | ✅ 跨终端历史 |
| 命令补全 | ✅ Fig 式 | ✅ Copilot | ✅ AI | ❌ | ❌ | ❌ | ✅ 上下文补全 |
| 图片输入 | ❌ | ❌ | ✅ 有限 | ❌ | ❌ | ✅ | ✅ |
| 焦点管理 | 单终端 | 条件路由 | 面板间切换 | 标准 | 模态系统 | 单焦点 | 三层焦点模型 |

---

*报告完成于 2026-03-18*
*基于对 Warp、VS Code、Cursor、iTerm2、Zellij、Rio、WezTerm、Fig/Amazon Q、tmux、Terminator、Kitty、Ghostty、Slack、tldraw、Excalidraw、Figma 等产品的综合研究*
