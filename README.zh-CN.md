# TermCanvas

一个基于无限画布的桌面应用，用于跨 git 项目和 worktree 可视化管理终端。

[English](./README.md)

## 概述

TermCanvas 将你的开发工作流组织在一张空间画布上。不再是藏在侧边栏里的标签页终端，而是将所有项目、worktree 和终端可视化地铺开——自由拖拽、画注释、聚焦你关心的内容。

**Project → Worktree → Terminal** —— 三层层级结构，和你使用 git 的方式完全一致。

## 功能特性

- **无限画布** —— 自由平移、缩放、排列
- **三层层级** —— git 项目包含 worktree，worktree 包含终端
- **实时 worktree 检测** —— 在终端中创建 worktree，UI 自动更新
- **绘图工具** —— 画笔、文字、矩形、箭头，用于标注
- **终端类型** —— Shell、Claude Code、Codex，带运行状态指示
- **侧边栏导航** —— 点击项目名称，画布平滑动画飞到该项目
- **拖拽与缩放** —— 所有容器可拖拽、可调整大小，适配画布缩放比例
- **点击置顶** —— 重叠容器点击自动置顶

## 技术栈

| 层级 | 技术 |
|------|-----|
| 桌面框架 | Electron 41 |
| 前端 | React 19, TypeScript |
| 终端 | xterm.js 6, node-pty |
| 状态管理 | Zustand 5 |
| 样式 | Tailwind CSS 4, Geist 字体 |
| 绘图 | perfect-freehand |
| 构建 | Vite 7 |

## 快速开始

### 前置要求

- Node.js 20+
- npm 10+
- macOS、Linux 或 Windows

### 安装

```bash
git clone https://github.com/blueberrycongee/termcanvas.git
cd termcanvas
npm install
```

### 开发

```bash
npm run dev
```

启动 Vite 开发服务器并打开 Electron 应用，支持热重载。

### 构建

```bash
npm run build
```

## 项目结构

```
termcanvas/
├── electron/              # Electron 主进程
│   ├── main.ts            # 窗口创建、IPC 处理
│   ├── preload.ts         # Context Bridge API
│   ├── pty-manager.ts     # node-pty 生命周期管理
│   ├── project-scanner.ts # Git worktree 扫描与监听
│   └── state-persistence.ts
├── src/                   # React 渲染进程
│   ├── canvas/            # 无限画布、绘图层
│   ├── containers/        # 项目和 worktree 容器
│   ├── terminal/          # 终端组件（xterm.js）
│   ├── toolbar/           # 顶部工具栏
│   ├── components/        # 侧边栏、通知
│   ├── stores/            # Zustand 状态管理
│   ├── hooks/             # 拖拽、缩放 hooks
│   └── types/             # TypeScript 类型定义
├── vite.config.ts
└── package.json
```

## 架构

```
┌─────────────────────────────────────────┐
│  Electron 主进程                         │
│  ┌──────────┐ ┌────────────────────┐    │
│  │ PtyManager│ │ ProjectScanner     │    │
│  │ (node-pty)│ │ (fs.watch + git)   │    │
│  └──────────┘ └────────────────────┘    │
│        ↕ IPC            ↕ IPC           │
├─────────────────────────────────────────┤
│  渲染进程                                │
│  ┌────────────────────────────────────┐ │
│  │ Canvas (transform: translate/scale)│ │
│  │  ├── DrawingLayer (SVG)            │ │
│  │  ├── ProjectContainer (absolute)   │ │
│  │  │    └── WorktreeContainer        │ │
│  │  │         └── TerminalTile        │ │
│  │  │              └── xterm.js       │ │
│  └────────────────────────────────────┘ │
│  Zustand: canvasStore, projectStore,    │
│           drawingStore, notificationStore│
└─────────────────────────────────────────┘
```

## 参与贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/your-feature`)
3. 提交更改 (`git commit -m "feat: add something"`)
4. 推送到分支 (`git push origin feat/your-feature`)
5. 发起 Pull Request

## 许可证

[MIT](LICENSE)
