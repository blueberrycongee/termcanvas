<div align="center">

<img src="docs/icon.png" width="128" alt="TermCanvas 应用图标" />

# TermCanvas

**你的终端，铺在无限画布上。**

[![GitHub release](https://img.shields.io/github/v/release/blueberrycongee/termcanvas)](https://github.com/blueberrycongee/termcanvas/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)]()
[![Website](https://img.shields.io/badge/website-termcanvas-e8b840)](https://website-ten-mu-37.vercel.app)

<br>

<img src="docs/image.png" alt="TermCanvas 演示 — 多个 AI agent 在无限画布上协作" />

</div>

<br>

TermCanvas 把你所有的终端铺在一张无限空间画布上——不再有标签页，不再有分屏。自由拖拽、放大聚焦、缩小俯瞰。

它以 **Project → Worktree → Terminal** 三层结构来组织一切，和你使用 git 的方式完全一致。添加一个项目，TermCanvas 自动检测它的 worktree；在终端里新建一个 worktree，画布上立刻出现。

<p align="right"><a href="./README.md">English →</a></p>

---

## 快速开始

**下载** —— 从 [GitHub Releases](https://github.com/blueberrycongee/termcanvas/releases) 获取最新构建。

> [!WARNING]
> **macOS 未签名应用提示**
> 如果 macOS 提示 TermCanvas“已损坏”，或因为应用未签名而阻止启动，先清除 quarantine 属性再重试：
>
> ```bash
> xattr -cr /Applications/TermCanvas.app
> ```
>
> 如果你把应用装在别的位置，把上面的路径改成实际的 `.app` 路径即可。

**从源码构建：**

```bash
git clone https://github.com/blueberrycongee/termcanvas.git
cd termcanvas
npm install
npm run dev
```

**安装命令行工具** —— 启动应用后，进入 设置 → 通用 → 命令行工具，点击注册。这会将 `termcanvas` 和 `hydra` 添加到你的 PATH。

---

## 功能特性

### 画布

无限画布——自由平移、缩放、排列终端。三层层级：项目包含 worktree，worktree 包含终端。新建 worktree 时自动出现在画布上。

双击终端标题栏缩放适配。拖拽排序。框选多个终端。将完整布局保存为 `.termcanvas` 文件。

### AI 编程 Agent

原生支持 **Claude Code**、**Codex**、**Kimi**、**Gemini**、**OpenCode**。

- **实时状态与完成闪光** —— 一眼看到 agent 正在工作、等待还是已完成
- **Telemetry 真相层** —— 实时 turn 状态、工具活动、进度追踪；卡顿检测、状态徽章、结构化快照，同时服务 UI 和 Hydra
- **会话恢复** —— 关闭并重新打开 agent 终端，不丢失上下文
- **内联 diff 卡片** —— 不离开画布就能审查 agent 的代码变更

### Git

左侧栏内置 Git 面板——commit 历史、diff 查看器、git 状态一目了然，无需离开画布。

### 终端

Shell、lazygit、tmux 与 AI agent 共存于同一画布。星标重要终端，用 <kbd>⌘</kbd> <kbd>J</kbd> / <kbd>K</kbd> 快速切换。四种尺寸预设、自定义标题、逐 agent CLI 路径覆盖。

### 用量追踪

Token 用量与成本看板——总花费、按项目和按模型分布。每小时 token 热力图、24 小时成本趋势图、缓存命中率。5 小时与 7 天速率限制配额监控。登录后跨设备同步用量。

### 设置

6 款可下载等宽字体 · 深色/浅色主题 · 自定义键盘快捷键 · 最小对比度无障碍设置 · 中英文自动检测 · 应用内自动更新与更新日志。

---

## 命令行工具

两个 CLI 都随应用打包。在设置中注册后即可在任意终端使用。

### termcanvas

<details>
<summary>完整命令参考</summary>

```
用法: termcanvas <project|terminal|diff|state> <command> [args]

Usage: termcanvas <project|terminal|telemetry|diff|state> <command> [args]

项目命令:
  project add <path>                          添加项目到画布
  project list                                列出所有项目
  project remove <id>                         移除项目
  project rescan <id>                         重新扫描项目的 worktree

终端命令:
  terminal create --worktree <path> --type <type>   创建终端
          [--prompt <text>] [--parent-terminal <id>] [--auto-approve]
  terminal list [--worktree <path>]            列出终端
  terminal status <id>                         获取终端状态
  terminal input <id> <text>                   向终端发送文本输入
  terminal output <id> [--lines N]             读取终端输出（默认 50 行）
  terminal destroy <id>                        销毁终端

Telemetry 命令:
  telemetry get --terminal <id>                获取终端 telemetry 快照
  telemetry get --workflow <id> [--repo <p>]   获取 workflow telemetry 快照
  telemetry events --terminal <id>             列出最近的终端 telemetry 事件

其他命令:
  diff <worktree-path> [--summary]             查看 worktree 的 git diff
  state                                        导出完整画布状态为 JSON

标志:
  --json    以 JSON 格式输出
```

</details>

```bash
termcanvas project add ~/my-repo
termcanvas terminal create --worktree ~/my-repo --type claude
termcanvas terminal status <id>
termcanvas telemetry get --terminal <id>
termcanvas diff ~/my-repo --summary
```

<br>

<div align="center">
<img src="docs/hydra-icon.png" width="80" alt="Hydra icon" />

### hydra
</div>

<br>

Hydra 是 TermCanvas 的终端编排框架，用于多 agent 工作流。它将 AI agent（Claude、Codex、Kimi、Gemini）分发到**隔离的 git worktree** 中，通过**文件契约交接**协调它们，并通过 **telemetry 真相层**监控进度——同时不干预每个 agent 会话内部的行为。

**设计理念：** 每个 agent 在自己的终端中运行，拥有全新的上下文和完全的自主权。Agent 之间不共享对话历史——它们共享的是 **worktree**（磁盘上的代码）和**结构化文件契约**（`handoff.json`、`task.md`、`result.json`、`done`）。终端输出不具权威性，经过验证的文件才是唯一的事实来源。如果 workflow 失败，丢弃 worktree 重新开始。

这一设计受到 [Anthropic 关于长时间运行 agent 编排的 harness 设计研究](https://www.anthropic.com/engineering/harness-design-long-running-apps)的启发，并针对终端 agent（每个进程天然隔离）做了适配。

#### 开始使用

在项目中运行 `hydra init`（或在 worktree 标题栏点击**启用 Hydra**），让你的 AI agent 学会使用 Hydra。然后直接和 agent 对话：

> *先写好 PRD 或清晰地描述需求，然后告诉 agent：*
>
> *”读一下 Hydra skill。我希望你自己选择合适的模式，根据 `docs/prd/auth-redesign.md` 中的 PRD 自主完成这个任务。”*

Agent 会读取项目 `CLAUDE.md` 中的 Hydra 指令，对任务进行分类，并选择最轻量的路径：

- **留在当前 agent** —— 简单或局部任务，无编排开销
- **`hydra spawn`** —— 任务清晰且自包含时，创建一个隔离 worker
- **`hydra run --template single-step`** —— 单个 implementer + 文件契约门禁和证据
- **`hydra run`**（默认）—— planner → implementer → evaluator 流水线，支持 evaluator 到 implementer 的回环

每个角色可以指定不同的 provider（`--planner-type claude --implementer-type codex`），也可以继承当前终端类型。

```bash
hydra init    # 一次性设置：将 Hydra 指令写入 CLAUDE.md 和 AGENTS.md
```

<details>
<summary>完整命令参考</summary>

```
用法: hydra <run|tick|watch|status|retry|spawn|list|cleanup|init> [options]

Workflow 命令:
  run      创建并启动文件契约 workflow
           --task <desc>              任务描述（必填）
           --repo <path>              仓库路径（必填）
           --template <name>          single-step | planner-implementer-evaluator（默认）
           --all-type <type>          所有角色使用同一 agent 类型
           --planner-type <type>      Planner agent 类型
           --implementer-type <type>  Implementer agent 类型
           --evaluator-type <type>    Evaluator agent 类型
           --timeout-minutes <num>    每次 handoff 超时（默认 30）
           --max-retries <num>        自动重试上限（默认 1）
           --auto-approve             子 agent 以 auto-approve 模式运行

  tick     推进一个 workflow tick（收集结果、派发下一个 handoff）
  watch    轮询 workflow 直到达到终态
  status   显示结构化 workflow 状态 + telemetry 建议
  retry    重试失败或超时的 workflow

Worker 命令:
  spawn    创建一个隔离 worker 终端
           --task <desc>              任务描述（必填）
           --repo <path>              仓库路径（必填）
           --worker-type <type>       Worker agent 类型
           --base-branch <branch>     新 worktree 的基础分支

管理命令:
  list     列出所有已创建的 agent
  cleanup  清理 agent worktree 和终端
  init     向项目添加 Hydra 指令（CLAUDE.md / AGENTS.md）
```

</details>

<details>
<summary>命令示例</summary>

```bash
# 完整 workflow（planner → implementer → evaluator）
hydra run --task “fix the login bug” --repo .

# 按角色混合 provider
hydra run --task “implement auth” --repo . \
  --planner-type claude --implementer-type codex --evaluator-type claude

# 单步（一个 implementer + 文件门禁）
hydra run --task “implement the API change” --repo . --template single-step

# 直接隔离 worker
hydra spawn --task “investigate the flaky CI failure” --repo .

# 编排操作
hydra watch --repo . --workflow <workflow-id>
hydra status --repo . --workflow <workflow-id>
hydra retry --repo . --workflow <workflow-id>

# 清理
hydra cleanup --workflow <workflow-id> --repo . --force
hydra cleanup <agent-id> --force
```

</details>

Workflow 在 `.hydra/workflows/` 中通过 `result.json` + `done` 的验证后才会前进。Telemetry 真相层提供实时 `turn_state`、`last_meaningful_progress_at` 和 `derived_status`——同时服务于 UI（徽章、建议视图）和 Hydra 自身（卡顿检测、重试决策）。

**典型工作流：** 编写 PRD → 启用 Hydra → 让主脑 agent 自主选择模式并编排执行 → 通过 `hydra watch` 或画布 UI 监控 → 审查 diff 并合并。更多架构、故障排查和反模式，见 [Hydra 编排指南](docs/hydra-orchestration.md)。所有模式、状态机和系统组件的可视化全景，见 [Hydra 全景流程图](docs/hydra-panorama-flow-zh.md)。

---

## 快捷键

所有快捷键均可在 设置 → 快捷键 中自定义。Windows/Linux 上用 <kbd>Ctrl</kbd> 替换 <kbd>⌘</kbd>。

| 快捷键 | 功能 |
|--------|------|
| <kbd>⌘</kbd> <kbd>O</kbd> | 添加项目 |
| <kbd>⌘</kbd> <kbd>B</kbd> | 切换侧边栏 |
| <kbd>⌘</kbd> <kbd>/</kbd> | 切换右侧面板（用量） |
| <kbd>⌘</kbd> <kbd>T</kbd> | 新建终端 |
| <kbd>⌘</kbd> <kbd>D</kbd> | 关闭聚焦的终端 |
| <kbd>⌘</kbd> <kbd>;</kbd> | 重命名终端标题 |
| <kbd>⌘</kbd> <kbd>]</kbd> | 下一个终端 |
| <kbd>⌘</kbd> <kbd>[</kbd> | 上一个终端 |
| <kbd>⌘</kbd> <kbd>E</kbd> | 取消聚焦 / 恢复上次聚焦 |
| <kbd>⌘</kbd> <kbd>F</kbd> | 星标 / 取消星标聚焦的终端 |
| <kbd>⌘</kbd> <kbd>J</kbd> | 下一个星标终端 |
| <kbd>⌘</kbd> <kbd>K</kbd> | 上一个星标终端 |
| <kbd>⌘</kbd> <kbd>S</kbd> | 保存工作区 |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>S</kbd> | 工作区另存为 |
| <kbd>⌘</kbd> <kbd>1</kbd>–<kbd>4</kbd> | 终端尺寸：默认 / 宽 / 高 / 大 |

---

<table>
<tr><td><b>桌面框架</b></td><td>Electron</td></tr>
<tr><td><b>前端</b></td><td>React · TypeScript</td></tr>
<tr><td><b>终端</b></td><td>xterm.js (WebGL) · node-pty</td></tr>
<tr><td><b>状态管理</b></td><td>Zustand</td></tr>
<tr><td><b>样式</b></td><td>Tailwind CSS · Geist</td></tr>
<tr><td><b>认证与同步</b></td><td>Supabase</td></tr>
<tr><td><b>构建</b></td><td>Vite · esbuild</td></tr>
</table>

<br>

**致谢** —— [lazygit](https://github.com/jesseduffield/lazygit) 作为内置终端类型集成，在画布上提供可视化的 git 管理。

---

## 路线图

TermCanvas 正在从本地桌面工具演进为**云原生 AI 开发平台**。以下是未来方向：

### 云端 Runtime

将任务执行从本地迁移到云端。在远程 runtime 上启动 AI agent——任务运行在托管环境中，具备完整的 git、工具链和依赖支持，而画布始终是你的统一控制面。

- **托管 agent 执行** —— 将 Claude、Codex 等 agent 任务委派给云端 worker，按需调度算力
- **持久远程会话** —— 合上笔记本，回来时 agent 仍在运行
- **并行云端 worker** —— 将 Hydra workflow 扩展到多个云实例，而非受限于本地终端

### 自动化 Vibe 流水线

基于云端 runtime，实现从想法到代码上线的端到端自动化：

- **意图 → 规划 → 实现 → 审查 → 合并** —— 全自动流水线，你描述需求，系统完成其余一切
- **持续 vibe 循环** —— agent 自主规划、实现、自审查、迭代，直到结果满足验收标准
- **流水线即代码** —— 为常见任务（bug 分类、功能实现、迁移、重构）定义可复用的 workflow 模板
- **人工审批检查点** —— 在任意阶段配置审批门禁，需要掌控时随时介入

### 愿景

目标很简单：**你描述意图，TermCanvas 搞定一切。** 画布成为自主 AI 开发的任务控制中心——监控进度、审查结果、需要时介入，让云端承担繁重工作。

---

**参与贡献** —— Fork、创建分支、发起 PR。基于 [MIT](LICENSE) 许可。
