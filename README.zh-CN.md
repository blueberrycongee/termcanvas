<div align="center">

<img src="docs/icon.png" width="128" alt="TermCanvas 应用图标" />

# TermCanvas

**你的终端，铺在无限画布上。**

[![GitHub release](https://img.shields.io/github/v/release/blueberrycongee/termcanvas)](https://github.com/blueberrycongee/termcanvas/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)]()

</div>

[English](./README.md)

## 什么是 TermCanvas

TermCanvas 把你所有的终端铺在一张无限空间画布上——不再有标签页，不再有分屏。自由拖拽、放大聚焦、缩小俯瞰，还能用手绘工具做标注。

它以 **Project → Worktree → Terminal** 三层结构来组织一切，和你使用 git 的方式完全一致。添加一个项目，TermCanvas 自动检测它的 worktree；在终端里新建一个 worktree，画布上立刻出现。

## 功能特性

**画布**
- 无限画布——自由平移、缩放、排列终端
- 三层层级——项目包含 worktree，worktree 包含终端
- 实时 worktree 检测——新建 worktree 自动出现
- 双击终端标题栏缩放至适合视口
- 拖拽排序 worktree 内的终端
- 绘图工具——画笔、文字、矩形、箭头标注
- 工作区存档——将完整布局保存为文件

**AI 编程 Agent**
- 原生支持 Claude Code、Codex、Kimi、Gemini、OpenCode
- Composer——统一输入栏，向聚焦的 agent 发送提示，支持粘贴图片
- 实时会话状态——一眼看到 agent 正在工作、等待还是已完成
- 会话恢复——关闭并重新打开 agent 终端，不丢失上下文
- 内联 diff 卡片——不离开画布就能审查 agent 的代码变更

**通用终端**
- Shell、lazygit、tmux 与 AI agent 共存于同一画布

**用量追踪**
- Token 用量与成本看板——总花费、按项目分布、按模型分布
- 24 小时成本趋势图与缓存命中率统计

**设置与国际化**
- 支持中文和英文（自动检测系统语言）
- 可调终端字号（6–24 px）
- 应用内自动更新并显示更新日志

**命令行工具**
- `termcanvas` —— 从终端控制画布：添加项目、创建终端、读取输出、查看 diff
- `hydra` —— 在隔离的 git worktree 中派生 AI 子 agent，然后审查并合并它们的工作

## 快速开始

**下载** —— 从 [GitHub Releases](https://github.com/blueberrycongee/termcanvas/releases) 获取最新构建。

**从源码构建：**

```bash
git clone https://github.com/blueberrycongee/termcanvas.git
cd termcanvas
npm install
npm run dev
```

**安装命令行工具** —— 启动应用后，进入 设置 → 通用 → 命令行工具，点击注册。这会将 `termcanvas` 和 `hydra` 添加到你的 PATH，并把 Hydra skill 安装到 Claude Code 与 Codex 的 skill 目录。

## 命令行工具

两个 CLI 都随应用打包。在设置中注册后即可在任意终端使用。

### termcanvas

```bash
termcanvas project add ~/my-repo     # 添加项目到画布
termcanvas project list              # 列出项目
termcanvas terminal create --worktree ~/my-repo --type claude
termcanvas terminal status <id>      # 检查终端状态
termcanvas diff ~/my-repo --summary  # 查看 worktree diff
```

### hydra

Hydra 让你把大任务拆成小块，分派给不同的 AI agent——Claude、Codex、Kimi、Gemini 或 OpenCode。每个 agent 拥有独立的 git worktree 和画布上的独立终端，你可以同时观察它们并行工作，随时介入。

**派生 agent：**

```bash
hydra spawn --task "fix the login bug" --type claude --repo .
# → 返回 JSON: { agentId, terminalId, worktreePath, branch, resultFile }
```

这会创建一个新的 worktree + 分支，在画布上打开终端，并将任务发送给 agent。agent 在完全隔离的环境中工作——只能修改自己 worktree 内的文件。

传入 `--auto-approve` 可继承父 agent 的权限级别（Claude 映射为 `--dangerously-skip-permissions`，Codex 映射为 `--dangerously-bypass-approvals-and-sandbox`）。

**只读任务**（代码审查、分析）可以指向已有的 worktree，不创建新分支：

```bash
hydra spawn --task "审查 auth 模块的安全漏洞" --type claude --repo . --worktree ./my-worktree
```

**监控、审查与合并：**

```bash
hydra list                              # 查看所有 agent 及其状态
termcanvas terminal status <id>         # 检查 agent 是否完成
termcanvas diff <worktree> --summary    # 审查 agent 的变更
cat <resultFile>                        # 读取 agent 的总结报告
git merge <branch>                      # 采纳变更
hydra cleanup <agent-id>                # 清理 worktree 和终端
```

**初始化：**

```bash
hydra init    # 将 Hydra 使用说明添加到项目的 CLAUDE.md 和 AGENTS.md
```

这会教会你的主 AI agent 在合适的时机自动派生子 agent。

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `⌘ O` | 添加项目 |
| `⌘ B` | 切换侧边栏 |
| `⌘ T` | 新建终端 |
| `⌘ ]` | 下一个终端 |
| `⌘ [` | 上一个终端 |
| `⌘ E` | 取消聚焦 / 恢复上次聚焦 |
| `⌘ 1` | 终端尺寸：默认 |
| `⌘ 2` | 终端尺寸：宽 |
| `⌘ 3` | 终端尺寸：高 |
| `⌘ 4` | 终端尺寸：大 |

> Windows/Linux 上用 `Ctrl` 替换 `⌘`。

## 技术栈

| 层级 | 技术 |
|------|-----|
| 桌面框架 | Electron |
| 前端 | React, TypeScript |
| 终端 | xterm.js, node-pty |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS, Geist 字体 |
| 绘图 | perfect-freehand |
| 构建 | Vite |

## 参与贡献 & 许可证

欢迎贡献——Fork、创建分支、发起 PR。基于 [MIT](LICENSE) 许可。
