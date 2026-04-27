# TermCanvas 用户指南

**一份实战手册:从 app 长什么样、到那些不告诉你就永远发现不了的交互、到所有值得记的快捷键。**

默认你已经装好了 TermCanvas。下载链接和 `termcanvas` / `hydra` 的 CLI 注册见 [README.zh-CN](../README.zh-CN.md) 的"快速开始"。

- English → [`user-guide.md`](./user-guide.md)

---

## 目录

1. [TermCanvas 是什么](#termcanvas-是什么)
2. [前 5 分钟](#前-5-分钟)
3. [三栏布局](#三栏布局)
4. [在 canvas 上移动](#在-canvas-上移动)
5. [和 terminal 打交道](#和-terminal-打交道)
6. [读代码和编辑代码](#读代码和编辑代码)
7. [浏览会话历史](#浏览会话历史)
8. [盯着花的钱(Usage)](#盯着花的钱usage)
9. [找东西 — 搜索、命令面板、Hub](#找东西--搜索命令面板hub)
10. [Composer 和快捷操作](#composer-和快捷操作)
11. [stash / 取回 terminal](#stash--取回-terminal)
12. [多画布、waypoint、快照历史](#多画布waypoint快照历史)
13. [Pin — 把以后再办的事先记下来](#pin--把以后再办的事先记下来)
14. [登录跨设备同步](#登录跨设备同步)
15. [设置 — 每个开关到底干嘛](#设置--每个开关到底干嘛)
16. [进阶功能](#进阶功能)
17. [快捷键速查表](#快捷键速查表)
18. [常见问题](#常见问题)

macOS 用 `⌘`,Linux / Windows 上所有 `⌘` 自动换成 `Ctrl` —— 每个快捷键绑的都是平台修饰键。

---

## TermCanvas 是什么

TermCanvas 是一个**专门为 AI agent 做的无限画布**。canvas 上每个 tile 都是真正的 PTY —— 通常是 `claude`、`codex`、`gemini`、`lazygit` 或者 shell —— 你像贴便签条一样把它们摆在画板上。可以同时在十几个 worktree 里跑十几个 Claude 会话,缩小一眼扫全景,放大到正在驱动的那个,随时翻出任何历史会话像翻聊天记录一样回看。

周围那些 UI 就是为了让你不用离开 canvas 干杂事:

- **左栏** — 项目管理 + 会话历史
- **右栏** — 当前 worktree 的 Files / Diff / Git / Memory
- **Monaco 编辑器抽屉** — 全屏代码编辑器,点文件时从右边滑出,盖住 canvas
- **Usage 面板** — Claude 和 Codex 的真实花费 + quota 追踪
- **会话回放抽屉** — 逐步重放任何过往对话,一键续接

---

## 前 5 分钟

1. **加第一个项目**。左栏默认收成一条窄边。点它顶部的 **`+`**(或按 `⌘O`),弹出系统文件夹选择器,选一个 git 仓库。左栏展开,显示这个项目和它的 `main` worktree。

2. **启动第一个 agent**。把鼠标悬在 worktree 行上 —— 右边会冒出一个小 `+`。点它展开 "New terminal" 菜单,或者右键 canvas 空白处选 `Claude` / `Codex` / `Shell`。新 tile 落在点击处(或在聚焦 terminal 旁边),下面的 PTY 会自动启动对应的 CLI。

3. **续接一个历史会话**(可选)。如果之前在这个目录用过 `claude` 或 `codex`,左栏的 **History** 区已经列好了那些会话。点任意一行 —— replay 抽屉滑出,右上角 **Continue** 按钮会新开一个 terminal 继续那场对话。

4. **缩小看全貌**。按 **`⌘E`**。canvas 自动缩放到能看到所有 terminal。再按 `⌘E` 回到刚才聚焦的那个。

5. **打开本指南 / 调设置**。`⌘,` 打开设置。`⌘K` 打开全局搜索 —— 可以搜文件、terminal、会话、git 历史、动作。

---

## 三栏布局

TermCanvas 的形状永远是这样:

```
┌───────────┬────────────────────────────┬───────────┐
│  左栏     │                            │  右栏     │
│           │      CANVAS                │           │
│           │                            │           │
│  项目     │      terminal tiles        │  Files    │
│  +        │      平移 / 缩放 / 聚焦    │  Diff     │
│  历史     │                            │  Git      │
│           │                            │  Memory   │
└───────────┴────────────────────────────┴───────────┘
```

两栏可以各自折叠:

- **左栏** —— 点内边缘的 chevron 折叠 / 展开。折叠后只剩 **`+`** 按钮,加项目仍然一键可达。
- **右栏** —— `⌘/` 折叠 / 展开。折叠态是 4 个 tab 图标;点任意一个直接展开到那个 tab。

**拖动任一栏的内边缘可以改宽度** —— canvas 自动重绘填满剩下的空间,聚焦 terminal 自动重新居中。

---

## 在 canvas 上移动

### 平移和缩放

- **双指滚动**(触摸板)或鼠标滚轮:**平移**,四方向都行,不用按修饰键。
- **`⌘`+滚动**(非 Mac 是 `Ctrl`+滚动):**缩放**,向光标所在位置缩。
- **双指捏合**:故意禁用了 —— 之前和 macOS 的后退手势冲突太狠。用 `⌘`+滚动。

### 聚焦模式(⌘E 连环)

`⌘E` 在不同状态下表现不一样 —— 这是 app 里最值得记的一招:

| 按 `⌘E` 时的状态            | 结果                                           |
| --------------------------- | ---------------------------------------------- |
| 没聚焦任何 terminal         | 聚焦第一个 terminal 并近距离放大              |
| 聚焦了一个 terminal         | 缩小到能看到所有 terminal;记住原来聚焦的那个  |
| 缩小态 + 有记忆的聚焦目标   | 放大回那个聚焦 terminal                        |

缩小态下(也叫 **overview 模式**):

- **单击** terminal → 聚焦它但不放大,立刻可以输入。
- **双击** terminal → 放大到它身上。这就是欢迎 demo 教的那招。
- **点击 canvas 空白** → 清除聚焦和选择。

正常(放大)态下:

- **双击 terminal 的标题栏** → canvas 平移到把那个 tile 居中。
- **拖拽 terminal** → 移动位置。tile 会吸附到 `10 × 10` 网格,而且会把邻居推开而不是重叠。

### 在 terminal 之间切换

`⌘]` / `⌘[` 按**空间顺序**(左到右、上到下)走。如果有 terminal 被加星,只在加星的之间循环 —— 12 个 agent 里只关心 3 个时很好用。

`⌘G` 切换聚焦**层级** —— terminal → worktree → 加星。到 worktree 模式时,`⌘]` 变成在 worktree 之间跳,而不是 terminal。

### 框选多个 terminal

按住 `Shift` 在 canvas 空白处拖拽,画出选择矩形。框住的全选中。`Backspace` / `Delete` 一次关掉所有选中的。

---

## 和 terminal 打交道

### 新建 terminal

四种方法,随手哪种用哪种:

- **`⌘T`** — 在当前聚焦的 worktree 里新建 shell。
- **worktree 行的 `+`**(左栏)— 同上,但能从下拉里选 Claude / Codex / Shell。
- **右键 canvas 空白** — 弹菜单列出所有配置过的 provider,tile 落在点击处。
- **拖文件到 terminal** — 粘贴引号包裹的文件路径作为输入。把文件"递"给正在运行的 Claude 时特别好用。

### terminal tile 本身

每个 tile 有:

- **状态点** — 红(需要注意)、琥珀(运行中)、绿(思考中)、灰(空闲)、蓝(完成但没看过)。
- **标题栏** — provider + 标题。双击进入重命名,Enter 保存,Esc 取消。
- **星标 (☆)** — `⌘F` 或点一下。加星后可以用 `⌘G` 进入只在加星之间循环的焦点模式。
- **最小化 (–)** — tile 塌成只剩标题。下面的 PTY 照跑。
- **关闭 (✕)** — 关掉。焦点自动转到同一 worktree 里空间上在左边的邻居。

### 右键菜单

terminal **标题栏**右键:

- **Stash** — tile 收进 stash box([见下](#stash--取回-terminal))。
- **Tags…** — 给 terminal 打标签。
- **Summarize**(仅 Claude / Codex) — 调用当前 agent 做一次总结。

左栏 **worktree 行**右键,激活那个 worktree(聚焦它最近的 terminal),但**不触发**展开/折叠。

**canvas 空白**右键,弹出 "New …" 菜单,按你配置的所有 agent 列出,tile 落在点击处。

---

## 读代码和编辑代码

右栏有 4 个 tab。折叠态是一条窄图标列,点哪个就展开到那个 tab。

- **Files** — 当前 worktree 的文件树。点文件 → **全屏 Monaco 编辑器抽屉**从右侧滑入,盖住 canvas 和右栏但保留左栏,这样边看代码边切会话不用关抽屉。
- **Diff** — 当前 worktree 未提交改动的统一 diff。点任意 hunk 会在 Monaco 里打开到对应行。hunk 按添加 / 删除 / 修改分别染绿 / 红 / 琥珀。
- **Git** — 分支切换、stash 列表、commit 图、操作行(`stage all`、`commit`、`amend`、`push` 等)。
- **Memory** — `CLAUDE.md` / `AGENTS.md` 这类自动注入到 agent 上下文的文件。在这里编辑就是改真实文件,Claude / Codex 下一轮会看到改动。

### Monaco 编辑器抽屉

- **点任何文件**(Files tab / 全局搜索结果 / diff hunk)—— 抽屉以默认宽度滑入。
- **最大化**(头部按钮,或 `⌘/` 收起右栏)—— 抽屉铺满左右栏之间的空间。左栏全程可见,切文件永远不用关抽屉。
- **`⌘S`** —— 保存。
- **未保存指示器** —— 文件名旁边一个彩色小点。有未保存改动时关抽屉会先问一句。
- **`Esc`** —— 关抽屉;有未保存改动的话会先问。

---

## 浏览会话历史

左栏的 **History** 区列出当前 canvas 范围内(所有你加过的项目)所有 Claude + Codex 过往会话。每行带第一条 prompt 的预览、provider、上次活跃时间。

- **点一行** → **会话回放抽屉**从左栏边缘滑出。抽屉的几何和编辑器抽屉镜像,只不过装的是聊天记录而不是代码。
- **Spacebar** 或播放按钮 → 按真实速度播放。抽屉里有速度选项。
- **`←` / `→`** —— 一次一个事件地步进。
- **点回放里任何 prompt / 回复 / 工具胶囊** → 跳到那一步。
- **工具胶囊**(那些折叠的小块)→ 点展开输入 + 输出。
- **Continue 按钮**(回放右上)→ 新建一个 terminal 通过 `claude --resume <id>` 或 `codex resume <id>` 续接对话。回放抽屉立刻关闭让新 terminal 在 canvas 上可见。

两件事要知道:

- 如果 CLI 那头已经把会话清掉了(Claude 的会话缓存有 TTL),续接 terminal 会打印 `[Session expired, starting fresh...]` 然后自动启动一个全新会话。不是你的错,就是原来那场太老了。
- Claude 和 Codex 在 `~/.claude/projects/…` 和 `~/.codex/sessions/…` 下用不同格式存会话。TermCanvas 读两边并合并成一条统一时间线。

---

## 盯着花的钱(Usage)

`⌘⇧U` 打开 Usage 仪表盘。它**不是** modal —— 它在左右栏之间的 canvas 间隙里渲染,两栏始终可见。再按 `⌘⇧U` 或按 `Esc` 关掉。

仪表盘有 5 行,全部是真实数据(读自 `~/.claude/projects/*/usage-*.json` 和 Codex 的 telemetry 流):

1. **Stat 条** — Today / MTD / Daily avg / Projected 月底预估。预估用的是你当前的日均乘以月剩余天数。
2. **两张图** — 今日 24 小时 sparkline + 30 天日趋势。
3. **三列 bar 列表** — 缓存率(Overall / Claude / Codex)、项目(你用得最多的)、模型(opus / sonnet / haiku / codex,各自用规范配色)。
4. **Quota** — Claude 5 小时 + 7 天 + Codex 5 小时用量条。50% 以下绿,50–80% 琥珀,80% 以上红。右边是下次重置倒计时。
5. **Heatmap** — 整年日历网格。每格是一天,色深随那天 token 数。

如果你把两栏拖得很宽,中间留给 Usage 的空间不够,仪表盘会静默让出。缩回任一栏它立刻回来。

---

## 找东西 — 搜索、命令面板、Hub

三个互补的入口,故意有重叠 —— 总有一个就在你手边。

### 全局搜索 — `⌘K`

`⌘K` 打开搜索面板。索引 7 类:

- **Actions** — app 命令(切换面板、打开设置、加项目等)。
- **Terminals** — 所有活的 tile,按标题 / provider 搜。
- **Files** — 当前 worktree 内的全文搜索(底层用 ripgrep)。输入满 3 字符触发。
- **Git 分支** — 本地任一分支切换器。
- **Git commits** — commit 信息 + hash 模糊搜。
- **Sessions** — 和左栏一样的历史,但能按 prompt 内容搜。
- **Memory** — `CLAUDE.md` / `AGENTS.md` 的符号 + 内容。

全键盘交互:

- `↑` / `↓` — 在结果间移动。
- `Enter` — 执行 / 打开。文件会在 Monaco 抽屉里定位到对应行。会话会打开回放抽屉并跳到匹配事件。
- `Esc` — 关闭。焦点回到之前的位置。
- **Scope 切换** — 面板顶部有个分段控件在 "All canvas" 和 "Current project" 之间切换,后者只在聚焦 worktree 里搜。

### 命令面板 — `⌘P`

形态和搜索不同:搜索是「找一个东西」,面板是「执行一个动作」。这里列出 TermCanvas 能做的所有动作 —— 切换面板、换主题、派发 Hydra 任务、打开本指南、注册 CLI 等等。打字过滤,`Enter` 执行,`Esc` 关闭。如果你不记得某个动作的快捷键,从这里找最快。

### Hub — `⌘⇧J`

从右边滑出的常驻抽屉,是 canvas 的指挥中心。四列实时数据:

- **Active terminals** — 正在跑 agent 的终端,带输出 sparkline。
- **Recent activity** — 最近发生的事按时间倒序(状态变化、工具调用、完成)。和热力图是同一份数据,只是这边按时间线呈现。
- **Waypoints** — 当前项目的 9 个命名视口,点一下就跳过去。
- **Pinned items** — 你 pin 过的东西(会话、终端、文件)。

什么时候用 Hub:想用纵向列表观察活动,而不是 pan/zoom canvas。长跑 agent 时一边干别的一边瞄 Hub 就够。

### 状态摘要 — `⌘⇧/`

不是抽屉、不是模态框,是一个浮动小窗。列出画布上当下 3–5 个最值得看的信号:刚完成的、卡住的、忙的、聚焦的、被 pin 的。看一眼就知道「现在最该关注什么」,然后一键 dismiss。

---

## Composer 和快捷操作

**`⌘;`** 打开 composer —— 一个悬浮输入框,可以把 prompt 分发给聚焦 agent terminal。适合:想输入长 prompt 但又不想跟 terminal 自己的输入焦点抢,或者想把同一个 prompt 同时发给多个 agent(选中它们,输入一次)。

Composer 功能:

- **多行输入** — `Enter` 发送,`Shift+Enter` 换行。
- **斜杠命令** — `/clear`、`/compact`、`/tokens` 等路由到对应 agent CLI 的等价命令。
- **拖文件** — 从系统或 Files tab 拖文件进来,路径以转义字符串插入。
- **目标选择** — 如果选中了多个 terminal,prompt 同时发给所有。

如果 composer 没开(设置 → 通用 → Composer),`⌘;` 退化成对聚焦 terminal 的标题做内联重命名。

---

## stash / 取回 terminal

有时想让 terminal 消失但不杀掉。stash 登场:

- **右键 terminal 标题 → Stash** — tile 收进 stash box,PTY 照跑但 tile 不在 canvas 上。
- **把 tile 拖到 stash box**(右下角)— 同效果。拖过时 box 会放大以示可落。
- **点 stash box** — 展开 stash 列表。每张卡片有:
  - **Restore** — tile 回到 canvas 原位置。
  - **Destroy** — 关 PTY 同时删条目。
- **Clear All** — stash box 头部,一键把所有 stashed terminal 关完。

stash 状态**跨 workspace 保存持久化**,重启后 stashed terminal 还在。

---

## 多画布、waypoint、快照历史

一屏 canvas 不够用时,这三样工具一起上。

### 多个命名画布

TermCanvas 的「画布」不只是视口 —— 每个画布都有自己的项目、视口、waypoint。像切换桌面一样切画布:

- `⌘⇧]` / `⌘⇧[` —— 下一个 / 上一个画布。
- `⌘⇧N` —— 打开画布管理器:重命名、排序、新建、删除。

用画布把不同关注点分开:一个「auth 重构」、一个「探索」、一个「翻基础设施」。切换瞬时完成,什么都不用重新加载。

### 空间 waypoint

每个项目最多 9 个视口快照。把当前 pan + zoom 存到一个槽,以后一键召回:

- `⌘⇧1` … `⌘⇧9` —— 把当前视口存到 1–9 号槽。
- `⌥1` … `⌥9` —— 平滑飞到对应 waypoint。

canvas 底部正中有一条小点,显示哪些槽已经填了。布局铺得很大、又总是回到那固定的几片区域时(agent 集群、diff 抽屉那块、Hydra workbench 那块),waypoint 救命。

### 快照历史 — `⌘⇧T`

`⌘S` 是手动保存当前状态。快照历史是反向操作:列出 TermCanvas 自动捕获的最近 20 个快照(每次有意义的布局变化都会存一份),逐一预览,选一个把整个画布回滚到那时候。Diff 模式高亮恢复后会变什么。一通乱拖之后想反悔时用。

---

## Pin — 把以后再办的事先记下来

Pin 是持久化的「这事先记下,以后办」清单。每条 pin 有标题、描述、可选外链(比如 GitHub issue)。重启不丢、按 repo 分组。

CLI 是 `termcanvas pin`(在 设置 → CLI 里和 `termcanvas` 一起注册):

```bash
termcanvas pin add --title "修一下 OAuth refresh 边界情况" --body "请求中途 token 过期..."
termcanvas pin add --title "看一下这个 issue" --link https://github.com/.../issues/42 --link-type github_issue
termcanvas pin list
termcanvas pin update <id> --status done
```

App 内的 Pin 抽屉读取同一份存储,带一键状态切换。看到什么但不想中断手头的事,先 pin 一下。

---

## 登录跨设备同步

点右上工具栏的头像 / 登录按钮。会在浏览器里跑 GitHub OAuth。登录后:

- **Usage** 数据跨设备同步(笔记本和台式上看到一样的仪表盘)。
- **会话历史** 把其他登录设备的条目也显示到左栏 History。
- **Device 分解** 出现在 Usage 仪表盘底部 —— 看每台机器各花了多少。

登录**完全可选**,不登录也能完整离线使用。

---

## 设置 — 每个开关到底干嘛

`⌘,` 打开。三个 tab:

### General(通用)

- **Font** — 6 个可下载的 Geist 字体变体 + 系统回退。实时生效。
- **Font size** — 只影响 terminal 文字(不影响 chrome)。
- **Blur / Contrast** — 浮层的背景样式。
- **Language** — 英文 / 简体中文(部分 label 还在混着,覆盖率在补)。
- **Theme** — Dark / Light。切换会同时重染 Monaco 编辑器。
- **Animation** — canvas + overlay 的动效开关。默认尊重 `prefers-reduced-motion`。
- **Composer** — 开启 `⌘;` composer 条。默认关。
- **Drawing** — 开启 canvas 上的涂鸦层。按住 `D` 进入画画模式;`E` 擦除;`C` 清空。
- **Browser** — 开启 canvas 内置浏览器卡片(嵌入 web view)。
- **Summary** — 开启后 live terminal 空闲时自动做一次总结。
- **Pet** — 开启水豚吉祥物。它会响应 telemetry 事件(工作中 / 等待 / 完成 / 卡住)。默认关。
- **CLI registration** — 把 `termcanvas` 和 `hydra` shim 装进 `$PATH`。移动过 app 位置的话点一下重新注册。
- **Check for Updates** — 手动触发一次自动更新检查。

### Shortcuts(快捷键)

每个快捷键都可以重绑。点当前绑定,按新键组合,Enter 保存。TermCanvas 会标记冲突(比如两个动作绑同一个键)并拒绝保存直到解决。

### Agents

- **Provider 选择** — 选默认 agent(Claude / Codex / Kimi / Gemini / OpenCode)。
- **API key** — 需要的 provider 填一下。
- **Per-agent CLI 覆盖** — 如果你要 TermCanvas 用 `claude-beta` 而不是 `claude`,或者一个自定义包装脚本,在这里设置。命令 + 参数会跑一次 `--version` 探测验证。

---

## 进阶功能

这些是给重度用户的,基础玩熟再看。

- **Hydra orchestration** — Lead agent 在多个平行 worktree 里把子任务分发给 worker agent。在 worktree 头部 "Enable Hydra" 按钮启用,会把编排指令写进项目的 `CLAUDE.md` / `AGENTS.md`,让 agent 知道怎么用 `hydra dispatch / watch / merge`。`hydra` CLI 和 app 分离 —— 在 agent terminal 里调,不在 UI 里。完整设计见 [`docs/hydra-orchestration.md`](./hydra-orchestration.md)。
- **活动热力图(`⌘⇧A`)** — 每个 tile 上画一条 5 分钟输出量 sparkline,扫一眼 canvas 就知道哪些 agent 现在在干活。开关式。
- **飞向最近活动(`⌥` + `` ` ``)** — 把镜头飞到最近有 PTY 输出的终端。重复按等于在最近活跃集合里 LRU 循环,Alt-Tab 风格。
- **Computer Use(仅 Claude)** — TermCanvas 可以动态把一个 Computer Use MCP server 注入 Claude / Codex 终端,让 agent 操作 macOS 应用。macOS 权限授权流程已经自动化,agent 自己跑 `status` → `setup` → `get_instructions`。相关 `termcanvas computer-use` 命令见 README 的 CLI 段。
- **Telemetry** — 每个 terminal 都发生命周期事件(awaiting-input / tool-running / stall / completion)。这些驱动 pet、状态点、注意力队列、Hub、`⌘K` 会话搜索。设置 → 通用 里可以整体关掉。
- **Headless 模式** — `termcanvas headless` 把整个栈跑成 HTTP/SSE 服务,不开 Electron 窗口。CI 或者别的 app 驱动 TermCanvas 时用。详见 [`docs/headless-cloud-deployment.md`](./headless-cloud-deployment.md)。
- **Workspace 文件** — `⌘S` / `⌘⇧S` 把画布存成一个 `.termcanvas` JSON 文件。重开它会恢复所有项目、worktree、terminal、涂鸦、stashed tile、视口。(自动状态历史 + 回滚见上面的「快照历史」。)

---

## 快捷键速查表

所有快捷键在 **macOS 用 `⌘`**,**Linux / Windows 用 `Ctrl`**。每个都可重绑(设置 → Shortcuts)。

### Canvas 导航

| 键             | 动作                                           |
| -------------- | ---------------------------------------------- |
| `⌘E`           | 切换聚焦 — 放大到聚焦的 / 缩小到全看            |
| `⌘0` · `⌘1` · `⌘=` · `⌘-` | 缩放:适配 · 100% · 放大 · 缩小    |
| `⌘]` / `⌘[`    | 下一个 / 上一个 terminal(空间顺序)            |
| `⌘G`           | 切换聚焦层级(terminal → worktree → 加星)     |
| `⌘F`           | 给聚焦 terminal 加星 / 取消加星                 |
| `⌘⇧1`–`9`      | 把当前视口存到 1–9 号 waypoint 槽               |
| `⌥1`–`9`       | 召回对应 waypoint                                |
| `` ⌥` ``       | 飞到最近有输出的终端                             |
| `V` · `H` · `Space`(按住) | 选择 · 抓手 · 临时平移              |
| 滚动           | 平移 canvas                                     |
| `⌘`+滚动       | 向光标缩放                                       |
| 双击(overview) | 放大到那个 terminal                             |
| Shift+拖       | 框选多个 terminal                                |
| Backspace      | 关闭选中的 terminal                              |

### 多画布

| 键              | 动作                         |
| --------------- | ---------------------------- |
| `⌘⇧]` / `⌘⇧[`   | 下一个 / 上一个画布           |
| `⌘⇧N`           | 打开画布管理器                |

### Terminals

| 键     | 动作                                        |
| ------ | ------------------------------------------- |
| `⌘T`   | 在聚焦 worktree 里新建 terminal             |
| `⌘D`   | 关闭聚焦 terminal                            |
| `⌘;`   | 打开 composer(没开则内联重命名)             |

### 发现层、面板、浮层

| 键        | 动作                                              |
| --------- | ------------------------------------------------- |
| `⌘K`      | 全局搜索                                          |
| `⌘P`      | 命令面板                                          |
| `⌘⇧J`     | Hub                                               |
| `⌘⇧/`     | 状态摘要                                          |
| `⌘/`      | 切换右栏(Files / Diff / Git / Memory)           |
| `⌘⇧U`     | Usage 仪表盘                                      |
| `⌘⇧H`     | Sessions 浮层                                     |
| `⌘⇧T`     | 快照历史                                          |
| `⌘⇧A`     | 活动热力图                                        |
| `Esc`     | 关最上面的浮层                                    |

### Workspace

| 键        | 动作                       |
| --------- | -------------------------- |
| `⌘O`      | 加项目                      |
| `⌘S` · `⌘⇧S` | 保存 / 另存为 workspace |
| `⌘,`      | 设置                        |

### 菜单栏(macOS 风格,跨平台)

`File` → 打开文件夹 · 关闭窗口 · 退出
`Edit` → 撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选
`View` → 重置缩放 · 放大 · 缩小 · 全屏

---

## 常见问题

**Resume 打印了 `[Session expired, starting fresh...]`。** CLI 自己的会话存储已经把这场对话清了(Claude 的有 TTL,Codex 的时间够久也会掉)。terminal 还在工作 —— 只是起了一个新的而不是续接。

**Claude 回放的 "Continue" 按钮灰着。** 会话记录的 `cwd` 和当前 canvas 上的任一 worktree 都对不上。要么把那个项目加到 canvas 上,要么在 terminal 里直接 `claude --resume <id>`。

**Usage 仪表盘空白。** 检查 `~/.claude/projects/*/usage-*.json` 是不是存在(用过 Claude 才有)。Codex 要 telemetry 流在跑 —— 去 `设置 → Agents` 看你的 Codex CLI 覆盖(如果有设)是不是 work。

**新 terminal 开在屏外。** 大概率是画布缩得很小又平移得远。按 `⌘E` 缩小到全看,再点那个 terminal 聚焦。

**Pet 没出现。** 默认关。`设置 → 通用 → Pet` 开启。

**`⌘K` 文件结果不出来。** 文件搜索需要系统装了 ripgrep。`brew install ripgrep` 或 `apt install ripgrep`。其他类别不依赖 ripgrep,正常工作。

---

反馈和 bug 在 [github.com/blueberrycongee/termcanvas/issues](https://github.com/blueberrycongee/termcanvas/issues) 提。
