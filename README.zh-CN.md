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

TermCanvas 把你所有的终端铺在一张无限空间画布上——不再有标签页，不再有分屏。自由拖拽、放大聚焦、缩小俯瞰，还能用手绘工具做标注。

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

双击终端标题栏缩放适配。拖拽排序。框选多个终端。用画笔、文字、矩形、箭头做标注。将完整布局保存为 `.termcanvas` 文件。

### AI 编程 Agent

原生支持 **Claude Code**、**Codex**、**Kimi**、**Gemini**、**OpenCode**。

- **Composer** —— 统一输入栏，向聚焦的 agent 发送提示，支持粘贴图片
- **实时状态与完成闪光** —— 一眼看到 agent 正在工作、等待还是已完成
- **会话恢复** —— 关闭并重新打开 agent 终端，不丢失上下文
- **内联 diff 卡片** —— 不离开画布就能审查 agent 的代码变更

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
termcanvas diff ~/my-repo --summary
```

<br>

<div align="center">
<img src="docs/hydra-icon.png" width="80" alt="Hydra icon" />

### hydra
</div>

<br>

Hydra 让你把大任务拆成小块，分派给不同的 AI agent，每个 agent 在独立的 git worktree 中工作。所有 agent 都有自己的画布终端，你可以同时观察它们并行推进。

**最简单的用法是直接告诉你的 AI agent。** 在项目中运行 `hydra init` 之后，只需对 agent 说：

> *"用 Hydra 把这次重构拆成子任务，并行执行。"*

Agent 已经知道如何调用 Hydra workflow、监控进度、合并结果——你不需要记住所有 CLI 参数。

```bash
hydra init    # 教会 Claude Code / Codex 在这个项目中使用 Hydra
```

<details>
<summary>手动使用</summary>

```bash
hydra run --task "fix the login bug" --repo .
hydra watch --repo . --workflow <workflow-id>
hydra status --repo . --workflow <workflow-id>
hydra cleanup --workflow <workflow-id> --repo . --force
```

`hydra run` 现在默认使用 planner → implementer → evaluator 工作流。更小、更直接的任务可显式传 `--template single-step`。Hydra workflow 会在 `.hydra/workflows` 下创建任务包，通过 create-only prompt 启动真实 Claude/Codex 终端，并且只在 `result.json` + `done` 通过校验后推进。更多架构边界、故障排查、反模式和本地验收流程，见 [Hydra Orchestration Guide](docs/hydra-orchestration.md)。

</details>

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
<tr><td><b>绘图</b></td><td>perfect-freehand</td></tr>
<tr><td><b>认证与同步</b></td><td>Supabase</td></tr>
<tr><td><b>构建</b></td><td>Vite · esbuild</td></tr>
</table>

<br>

**致谢** —— [lazygit](https://github.com/jesseduffield/lazygit) 作为内置终端类型集成，在画布上提供可视化的 git 管理。

**参与贡献** —— Fork、创建分支、发起 PR。基于 [MIT](LICENSE) 许可。
