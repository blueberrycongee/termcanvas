# TermCanvas 记忆层设计

## 问题

当前 LLM agent 的记忆系统（以 Claude Code 为代表）本质上是笔记系统——写入后固化，不会自动演化、不会自然衰减、不会互相关联。用户的实际体验是：

- 不知道记忆里有什么，管不了
- Auto-memory 判断质量差，记的东西经常不是你想要的
- 召回不透明，无法确认记忆是否被使用
- 手写 CLAUDE.md / skills 效果远好于自动记忆，但维护负担在人身上
- 记忆会过时，但没有任何自然淘汰机制

## 定位

**不做另一套记忆系统。** 记忆的写入和维护完全交给 Claude/Codex 自身的机制，TermCanvas 只做两件事：

1. **观察** — 读取和监听现有记忆文件的状态
2. **可视化** — 在左侧栏以图谱形式呈现，支持点击编辑

不写新记忆、不改文件格式、不干预 agent 的 Dream Mode 或自动记忆流程。纯增强层。

## 设计原则

### Bitter Lesson 兼容

底层存储是 Markdown 文件，操作原语是 Read/Write/Edit。模型升级时零摩擦，不引入模型能力之外的复杂检索基础设施。

### 不侵入

不修改 Claude Code 的记忆文件格式、不添加额外 frontmatter 字段、不写入 agent 的 memory/ 目录。索引和元数据是 TermCanvas 侧的附加数据。

### 自然机制

不设计评分公式、不手动打标签。所有排序信号来自已经发生的事实：文件的 mtime、创建时间、内容中的链接关系。

## 数据来源

### Claude Code 记忆目录

```
~/.claude/projects/{project-id}/memory/
├── MEMORY.md              # 索引（单链，指向各记忆文件）
├── feedback_xxx.md        # 记忆文件
├── user_xxx.md
├── project_xxx.md
└── reference_xxx.md
```

Project ID 由 worktree 路径生成：`/Users/foo/bar` → `-Users-foo-bar`

### 路径推导

从 TermCanvas 的 `WorktreeData.path`（绝对路径）推导 Claude Code 记忆路径：

```typescript
function getMemoryDir(worktreePath: string): string {
  const homeDir = os.homedir();
  // Claude Code 的 project-id 规则：路径中 / 替换为 -
  const projectId = worktreePath.replace(/\//g, '-');
  return path.join(homeDir, '.claude', 'projects', projectId, 'memory');
}
```

### 记忆文件格式（只读，不修改）

```markdown
---
name: 描述性名称
description: 一行摘要
type: user | feedback | project | reference
---

正文内容...
```

## 图谱模型

### 节点

每个记忆文件是一个节点。属性来自文件本身：

- `name` — 从 frontmatter
- `description` — 从 frontmatter
- `type` — user / feedback / project / reference
- `mtime` — 文件最后修改时间（自然信号）
- `ctime` — 文件创建时间

### 边

边从 MEMORY.md 的单链结构中提取：

- MEMORY.md 中的 `[Title](file.md)` → MEMORY.md 到 file.md 的引用边
- 记忆文件正文中的 `[text](other.md)` 或 `[[other]]` → 文件间的引用边

MEMORY.md 作为中心节点，单链射出到各记忆文件。如果记忆文件之间有互相引用（目前没有，但 agent 未来可能会写），自动解析为边。

### 视觉映射

| 属性 | 视觉表现 |
|------|---------|
| type | 节点颜色（user=蓝, feedback=绿, project=橙, reference=紫）|
| mtime 新近度 | 节点亮度/不透明度（最近修改的更亮）|
| MEMORY.md 中心节点 | 特殊样式，始终居中 |
| 引用边 | 连线 |

## UI 集成

### 位置：左侧栏新 Tab

在现有的 Files / Diff / Git / Preview 之外新增 **Memory** tab。

```
LeftPanel
├── Files
├── Diff
├── Git
├── Preview
└── Memory  ← 新增
```

### 跟随聚焦语义

与其他 tab 一致，Memory tab 的内容跟随当前 focused worktree：

```
用户聚焦 worktree
  ↓
LeftPanel 获取 effectiveWorktreePath
  ↓
推导 Claude Code memory/ 目录路径
  ↓
读取 MEMORY.md + 扫描目录下所有 .md 文件
  ↓
解析 frontmatter + 提取链接关系
  ↓
渲染图谱
```

切换 worktree 时，Memory tab 自动切换到对应项目的记忆。

### 交互

- **点击节点** → 右侧展开文件内容，可编辑（复用现有的 Preview 机制或内联编辑器）
- **悬停节点** → tooltip 显示 description + type + 最后修改时间
- **图谱布局** — MEMORY.md 居中，记忆文件环绕，力导向布局
- **空状态** — 如果 memory/ 目录不存在或为空，显示说明文字

### 文件监听

通过 fs.watch 或 chokidar 监听 memory/ 目录变化：

- 新增文件 → 图谱增加节点
- 文件修改 → 节点亮度刷新
- 文件删除 → 节点移除
- MEMORY.md 变化 → 重新解析边

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  LeftPanel (renderer)                                       │
│  ├── MemoryContent.tsx        — Memory tab 主组件           │
│  │   ├── MemoryGraph.tsx      — 图谱可视化（力导向）        │
│  │   └── MemoryEditor.tsx     — 文件内容查看/编辑           │
│  └── memoryStore.ts           — 图谱状态管理 (Zustand)      │
└──────────────────┬──────────────────────────────────────────┘
                   │ IPC
┌──────────────────▼──────────────────────────────────────────┐
│  Electron Main Process                                      │
│  └── memory-service.ts                                      │
│      ├── 扫描 memory/ 目录                                  │
│      ├── 解析 MEMORY.md + 各文件 frontmatter                │
│      ├── 提取链接关系                                       │
│      ├── fs.watch 监听变化                                   │
│      └── 读写文件内容（编辑功能）                            │
└─────────────────────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│  ~/.claude/projects/{project-id}/memory/                    │
│  ├── MEMORY.md                                              │
│  ├── feedback_xxx.md                                        │
│  └── ...                                                    │
└─────────────────────────────────────────────────────────────┘
```

## 自然信号（MVP 后续迭代）

MVP 先只用文件系统自身的信号（mtime/ctime）。后续可迭代：

### 来自 Agent 行为的信号

- 从 session JSONL 解析 agent 对记忆文件的 Read/Write 行为
- 一次会话中多个记忆文件被一起 Read → 共现关系 → 隐式边
- 创建后从未被 Read → 标记为可能的噪声

### 增强索引

生成一个带自然信号的增强版 MEMORY.md，注入到会话开头：

```markdown
- [Hydra auto-watch](feedback_hydra_watch.md) — always poll after dispatch
  related: feedback_hydra_auto_approve.md | last used: 2d ago | active
- [Hydra auto-approve](feedback_hydra_auto_approve.md) — spawned CLIs need --auto-approve
  related: feedback_hydra_watch.md | last used: 2d ago | active
```

## 不做的事情

- 不建向量数据库
- 不做 LLM 驱动的自动记忆提取
- 不硬编码评分公式
- 不做云端同步
- 不修改 Claude Code 的记忆文件格式
- 不替代 agent 的记忆管理机制
- 不设计三层加载机制——模型自己有 Read 工具，沿着链接导航即可

## MVP 范围

1. **memory-service.ts**（Electron main）— 扫描目录、解析文件、监听变化
2. **memoryStore.ts**（renderer）— 图谱数据的 Zustand store
3. **MemoryContent.tsx** — 左侧栏 Memory tab 容器
4. **MemoryGraph.tsx** — 力导向图谱可视化
5. **MemoryEditor.tsx** — 点击节点后的内容查看/编辑
6. **LeftPanel.tsx 改动** — 新增 Memory tab
7. **canvasStore 改动** — 新增 `"memory"` tab 类型
