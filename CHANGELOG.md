# Changelog

All notable changes to TermCanvas will be documented in this file.

## [0.37.0] - 2026-04-26

### Added
- **Collapsible project groups**: history panel groups sessions by project with expand/collapse chevrons.
- **Per-project show-more**: each project defaults to 7 rows; clicking "N more" reveals one batch at a time without affecting other groups.

### Changed
- **Permanent hide**: two-step hide (eye-slash → armed red → execute) is now permanent — hidden sessions have no restore path.
- **Pin placement**: pin indicator moved to left side of session row for clearer semantics.
- **History visual density**: row height, font size, indentation, and hover style aligned with the left panel project tree.

### Fixed
- Show-more fetches full per-project session list from server when local cache is exhausted.
- Canvas dot grid overlay removed (was rendering a duplicate fixed layer).
- Port file now guarded with PID to survive crashes without stale lock.

## [0.36.0] - 2026-04-26

### Added
- **Pin sessions**: pin a session to the top of the history panel; includes a two-step hide confirmation to prevent accidental dismissal.
- **File tree**: right panel file browser replaced with `@pierre/trees` — virtualized rendering, built-in search, git status badges, and multi-select drag-to-terminal.

### Changed
- **Task → Pin**: the Task feature has been renamed to Pin throughout the codebase and UI.
- **History panel**: sharpened visual hierarchy between prompt text and timestamp; terminal status collapsed to three states (attention / active / done).
- Sessions panel redesigned with clearer status grouping.
- Close-interception dialog removed; updater install-and-restart path restored.
- Tasks are now eager-loaded on startup so badges and CLI additions are immediately visible.

### Fixed
- Space-bar pan now activates correctly in Select mode.
- Mouse interactions with the bottom toolbar no longer swallow the next Space keypress.
- Toolbar popover outside-click uses capture-phase `mousedown` to work with box-select.
- Viewport pan position snapped to integer pixels to eliminate sub-pixel jitter.
- Background grid remains stable after pan integer-snap change.

## [0.35.0] - 2026-04-26

### Added
- **Figma-style canvas controls**: bottom-centre floating toolbar with Move/Hand tool selector, zoom in/out, zoom percentage, zoom presets (50 / 100 / 200 %), and Fit All button.
- **Hand tool**: persistent pan mode — left-drag pans instead of selecting; terminals remain focusable by clicking in Hand mode.
- **Space-bar pan**: hold Space anywhere on the canvas to temporarily activate Hand mode; release to restore the previous tool.
- Keyboard shortcuts: `V` (Move), `H` (Hand), `Shift+1` (Fit All), `Cmd/Ctrl+0` (100 %), `Cmd/Ctrl+=` (zoom in), `Cmd/Ctrl+-` (zoom out).
- Composer height awareness: bottom toolbar lifts above the composer bar as it resizes.
- Task terminal badge and drawer filter for completed tasks.
- Drag a task onto a terminal to inject its title and body as a composer prompt (without auto-submitting).

### Changed
- Default canvas tool is now **Hand** (was Move/Select).
- Move tool restricts left-drag panning to middle-button only; left-drag on empty canvas triggers marquee selection.
- Zoom controls removed from the top toolbar; they now live in the bottom floating toolbar.
- Update-ready indicator dot uses design token `--green` instead of Tailwind `green-500`.

### Fixed
- `Shift+1` (Fit All) now uses `e.code` instead of `e.key` so it works on non-US keyboard layouts.
- Cursor correctly shows `grab`/`grabbing` over terminal content in Hand mode (overrides xterm's `cursor: text !important`).
- Space-bar pan no longer intercepts button or menu-item activation.
- `Cmd/Ctrl+0/=/−` no longer intercepts keypresses inside editable fields.
- Zoom preset popover and tool popover can no longer both be open simultaneously.
- `fitAllProjects` bails early when window geometry is degenerate (tiny window or zero-size content) to prevent NaN viewport.
- Dead `isSelected` subscription removed from TerminalTile after selection ring revert.
- `useT` memoised per locale to prevent keyboard shortcut listeners from re-attaching on every render.
- `getCanvasLeftInset`, `getViewportCenterClientPoint`, and `zoomAtClientPoint` now receive `taskDrawerOpen` so zoom/fit math accounts for the Task drawer width.
- TaskDrawer participates in left-chrome layout so canvas origin is correct when the drawer is open.

### Added (zh-CN)
- **Figma 风格画布控制**：底部居中悬浮工具栏，含移动/抓手工具切换、缩放加减、缩放百分比、缩放预设（50 / 100 / 200 %）和适应全部按钮。
- **抓手工具**：持久平移模式，左键拖拽平移画布；抓手模式下仍可点击终端聚焦。
- **空格键平移**：在画布任意处按住空格键临时激活抓手模式，松开后恢复原工具。
- 快捷键：`V`（移动）、`H`（抓手）、`Shift+1`（适应全部）、`Cmd/Ctrl+0`（100 %）、`Cmd/Ctrl+=`（放大）、`Cmd/Ctrl+-`（缩小）。
- 输入框高度感知：底部工具栏随输入框高度动态上移。
- 任务终端角标与已完成任务的抽屉筛选。
- 将任务拖拽到终端可将标题和正文注入输入框（不自动提交）。

### Changed (zh-CN)
- 画布默认工具改为**抓手**（原为移动/选择）。
- 移动工具的左键拖拽平移限制为中键，左键拖拽空白区域触发框选。
- 缩放控件从顶部工具栏移至底部悬浮工具栏。

### Fixed (zh-CN)
- `Shift+1`（适应全部）改用 `e.code` 检测，兼容非 US 键盘布局。
- 抓手模式下鼠标在终端内容上正确显示 `grab`/`grabbing`。
- 空格键平移不再拦截按钮或菜单项的激活事件。
- `Cmd/Ctrl+0/=/−` 不再拦截可编辑字段内的按键。
- 缩放预设弹窗与工具弹窗不再同时打开。
- 窗口或内容尺寸退化时 `fitAllProjects` 提前退出，防止视口 NaN。
- 移除 TerminalTile 中选中环回退后残留的死订阅。
- `useT` 按 locale 缓存，防止键盘快捷键监听器在每次渲染时重挂。
- 缩放/适应计算现在传入 `taskDrawerOpen`，Task 抽屉展开时画布原点正确。

## [0.34.0] - 2026-04-25

### Added
- **Computer Use MCP overhaul**: full desktop-control toolkit with virtual cursor overlay, no-focus-steal input path, AX-first click strategy, keyboard scroll, cursor move action, foreground mouse hardening, and text input tuning.
- ScreenCaptureKit preferred for screenshots with zoom coordinate mapping and stale-coordinate rejection.
- Trajectory recording and replay with debug crosshair output.
- Window-scoped observation, space membership exposure, and Chromium AX activation strengthening.
- Background app launch tool and persistent capture config.
- Agent shim injection into shell terminals with CLI agents taught AX-first workflow.
- Global MCP registration and common CUA tool exposure with operation path capabilities.
- macOS permission flow: guided stale permission repair, setup-time permission request, and CLI repair hints.
- Viewport-fixed focus caret overlay for canvas navigation.

### Fixed
- Terminal link activation now requires Ctrl/Cmd modifier to avoid accidental navigation.
- Blank terminals after visibility loss or WebGL context loss now recover automatically.
- Focus ring in overview mode uses stronger desaturated style for clarity.
- Focus navigation overhead reduced in the renderer.
- Hook stdin consumed before exit to prevent Codex Broken pipe errors.
- Computer Use fixes: AX press preferred for element clicks, screenshot coordinate mapping from captured window, helper signing identity kept stable, MCP credentials loaded from state file, Claude reserved MCP name avoided, TOML env config for Codex MCP, bundled packaged MCP server.

### Added (zh-CN)
- **Computer Use MCP 全面重构**：完整桌面控制工具集，包括虚拟光标覆盖层、无焦点窃取输入路径、AX 优先点击策略、键盘滚动、光标移动操作、前台鼠标输入加固和文本输入调优。
- 截图优先使用 ScreenCaptureKit，支持缩放坐标映射和过期坐标拒绝。
- 轨迹录制与回放，含调试十字线输出。
- 窗口范围观察、空间成员关系暴露、Chromium AX 激活增强。
- 后台应用启动工具和持久化截图配置。
- Agent shim 注入 shell 终端，CLI agent 学习 AX 优先工作流。
- 全局 MCP 注册和通用 CUA 工具暴露，含操作路径能力声明。
- macOS 权限流程：引导修复过期权限、setup 时请求权限、CLI 修复提示。
- 画布导航用的视口固定焦点光标覆盖层。

### Fixed (zh-CN)
- 终端链接激活现在需要 Ctrl/Cmd 修饰键，避免误触导航。
- 终端在可见性丢失或 WebGL 上下文丢失后现在会自动恢复。
- Overview 模式下的焦点环使用更强的去饱和样式以提升辨识度。
- 渲染器中焦点导航开销降低。
- Hook 退出前消耗 stdin，防止 Codex Broken pipe 错误。
- Computer Use 修复：元素点击优先使用 AX press、截图坐标从捕获窗口映射、helper 签名身份保持稳定、MCP 凭据从状态文件加载、避免 Claude 保留 MCP 名称、Codex MCP 的 TOML 环境配置、打包 MCP 服务器。

## [0.33.0] - 2026-04-25

### Added
- Stash button on terminal cards in the sidebar: hover any terminal to reveal a tray icon that stashes it, symmetric with the restore icon in the stash section.
- Stash section in the left sidebar with dedicated collapsible area, explicit restore/destroy buttons, and confirmation dialog for destructive actions.
- Cmd/Ctrl+Click on URLs in the terminal now opens them in the default browser.
- shadcn component system initialized (Radix + Nova) with alert-dialog, collapsible, button, and tooltip primitives.

### Changed
- Project tree always shows the branch row (removed flat-mode special case). Single-worktree projects display the branch name as a second level, matching multi-worktree layout.
- Renamed `isMain` to `isPrimary` across the worktree data model to clarify it means "primary git worktree" (directory identity), not "main branch".
- Terminal title resolution rewritten: `customTitle` stands alone (no longer concatenated with process title), `extractIntent()` extracts meaningful titles from prompts by stripping code blocks, file paths, and polite prefixes.
- Project-level [+] button now creates a worktree (terminal creation moved to each branch row's own [+]).
- Canvas edge resize handles restyle as Figma-style midpoint rectangles.

### Fixed
- ConfirmDialog redesigned: added close button, smooth hover transitions, and danger button now uses project color tokens (`var(--red)`) instead of raw Tailwind red.
- Branch row was hidden for single-worktree repos on feature branches because `isMain` (git worktree identity) was conflated with "is main branch".

### Added (zh-CN)
- 侧边栏终端卡片新增暂存按钮：hover 时显示托盘图标，可将终端暂存，与暂存区的恢复图标形成对称。
- 左侧栏新增独立暂存区，可折叠展开，包含恢复和销毁按钮，销毁前有确认弹窗。
- 终端中 Cmd/Ctrl+点击 URL 现在会在默认浏览器中打开。
- 初始化 shadcn 组件系统（Radix + Nova），包含 alert-dialog、collapsible、button、tooltip 原语。

### Changed (zh-CN)
- 项目树始终显示分支行（移除 flat 模式特例）。单 worktree 项目也会显示分支名作为第二层级。
- 将 worktree 数据模型中的 `isMain` 重命名为 `isPrimary`，明确其语义为「主 worktree」而非「main 分支」。
- 终端标题解析重写：`customTitle` 不再拼接进程标题，`extractIntent()` 通过去除代码块、文件路径和客套前缀来提取有意义的标题。
- 项目级 [+] 按钮改为创建 worktree（终端创建移至各分支行的 [+]）。
- 画布边缘缩放手柄改为 Figma 风格的中点矩形。

### Fixed (zh-CN)
- ConfirmDialog 重新设计：新增关闭按钮、平滑 hover 过渡，危险按钮改用项目色彩令牌（`var(--red)`）。
- 修复单 worktree 仓库在 feature branch 上时分支行被隐藏的问题。

## [0.32.2] - 2026-04-24

### Fixed
- macOS release builds now use ad hoc signing instead of skipping code signing entirely. This keeps the bundle identity as `com.blueberrycongee.termcanvas` and produces a `codesign --verify`-valid app, which avoids the unstable Screen Recording and Accessibility permission behavior seen in unsigned builds.

### Fixed (zh-CN)
- macOS release build 现在使用 ad hoc 签名,不再完全跳过代码签名。这样 bundle identity 会保持为 `com.blueberrycongee.termcanvas`,并产出可通过 `codesign --verify` 的 app,避免未签名构建下录屏和辅助功能权限不稳定的问题。

## [0.32.1] - 2026-04-24

### Fixed
- Dragging a worktree label to compact its terminals now lays them out horizontally first instead of collapsing into a tall vertical stack.
- Hydra standalone workers now get a short natural-exit grace period after writing `result.json`, so stdout telemetry can flush the `session_id` before cleanup and `hydra ask` can resume the session reliably.
- Usage cost estimates now explicitly include GPT-5.5 and Claude Opus 4.7 pricing.

### Fixed (zh-CN)
- 拖动 worktree label 来 compact terminals 时,现在会优先横向排列,不再容易收成很高的竖向栈。
- Hydra standalone worker 写出 `result.json` 后,现在会短暂等待进程自然退出,让 stdout telemetry 有机会 flush `session_id`;清理后 `hydra ask` 也能稳定续接 session。
- Usage 成本估算现在显式支持 GPT-5.5 和 Claude Opus 4.7 价格。

## [0.32.0] - 2026-04-23

### Added
- Usage now includes Kimi and WUU sessions: Kimi `wire.jsonl` `StatusUpdate.token_usage` events and WUU `meta` `token_usage` records are scanned into daily summaries, heatmaps, cache-rate rows, and model breakdowns.
- Clicking a worktree label, either on the canvas or in a terminal header, now enters that worktree's overview mode so double-clicking a terminal zooms into it, matching the `⌘E` overview flow.

### Fixed
- Kimi and WUU usage cost estimates now use the Moonshot API-aligned rates instead of the initial rough defaults.
- Kimi/WUU heatmap parsing now returns the wrapper records correctly, so their token usage contributes to heatmap totals.
- The Settings general tab keeps the app version row pinned to the bottom instead of drifting into the main settings content.

### Added (zh-CN)
- Usage 现在会统计 Kimi 和 WUU session:Kimi 的 `wire.jsonl` `StatusUpdate.token_usage` 事件、WUU 的 `meta` `token_usage` 记录会进入每日汇总、热力图、缓存率行和模型拆分。
- 点击画布上的 worktree label 或 terminal header 里的 worktree label,现在会进入该 worktree 的 overview mode;随后双击任一 terminal 会 zoom in,行为与 `⌘E` overview 流程一致。

### Fixed (zh-CN)
- Kimi 和 WUU 的 usage 成本估算现在使用对齐 Moonshot API 的价格,不再使用最初的粗略默认值。
- Kimi/WUU 的 heatmap 解析现在会正确返回 wrapper records,它们的 token usage 会计入热力图总量。
- Settings 的 General tab 会把 app version 行固定在底部,不再漂到主要设置内容里。

## [0.31.1] - 2026-04-22

### Fixed
- Left panel history and `⌘K` session search appeared completely empty on 0.31.0 even when local session files existed, and replay could not resolve a session for any terminal. The Kimi CLI integration added in 0.31.0 called `findKimiSessionFiles()` inside `electron/session-search-index.ts#listSessionFileCandidates` without importing it, so every call to `listSessionsForProjects` / `listSessionsForProjectsPaged` threw a `ReferenceError`. The main-process IPC handlers had bare `catch {}` blocks that silently returned `{ entries: [], total: 0 }`, making the regression look like "no sessions exist" instead of an error. Import restored; both IPC handlers now log the error instead of swallowing it so the next regression of this shape is not invisible. Two related type errors from the same Kimi commit were also fixed in `session-scanner.ts` (undefined `wd.kaos` fallback short-circuit) and `session-watcher.ts` (unnarrowed `call.function.name` access)

### Fixed (zh-CN)
- 0.31.0 下即使本地有完整 session 文件,左侧历史面板和 `⌘K` session 搜索也完全空白,任何 terminal 都无法 replay。原因是 0.31.0 引入的 Kimi CLI 集成在 `electron/session-search-index.ts#listSessionFileCandidates` 里调用了 `findKimiSessionFiles()` 却没 import,每次 `listSessionsForProjects` / `listSessionsForProjectsPaged` 都会抛 `ReferenceError`;而主进程 IPC handler 用了裸 `catch {}` 静默返回 `{ entries: [], total: 0 }`,把这个回归伪装成"本地没有 session"。补上 import,并把两处 `catch {}` 换成带 `console.error` 的版本——这个形状的回归下次不会再隐身。顺带修掉同一次 Kimi 提交留下的两处类型错误:`session-scanner.ts` 里引用了不存在的 `wd.kaos` 字段导致条件永远走不到,`session-watcher.ts` 读 `call.function.name` 没做收窄

## [0.31.0] - 2026-04-21

### Added
- `feat(session): add Kimi CLI support across session pipeline` — 为 Kimi CLI 添加跨 session 管线的支持

### Fixed
- `fix(session): use findKimi instead of getKimiLatest for Kimi session attachment` — Kimi session 附件改用 findKimi 而非 getKimiLatest
- `fix(renderer): 修复 WebGL 终端乱码问题` — 修复 WebGL 终端乱码问题
- `fix(ci): run postinstall bins via shell on windows` — Windows 上通过 shell 运行 postinstall 脚本
- `fix(session): remove weak fallback in findBestCodexSession` — 移除 findBestCodexSession 的 weak fallback，当 cwd 匹配失败时返回 null 而非绑定到全局最新 session

### Added (zh-CN)
- 为 Kimi CLI 添加跨 session 管线的支持

### Fixed (zh-CN)
- Kimi session 附件改用 findKimi 而非 getKimiLatest
- 修复 WebGL 终端乱码问题
- Windows 上通过 shell 运行 postinstall 脚本
- 移除 findBestCodexSession 的 weak fallback，当 cwd 匹配失败时返回 null 而非绑定到全局最新 session

## [0.30.7] - 2026-04-21

### Fixed
- Live session rows in the left panel no longer keep a stale session identity after a terminal detaches from its session or switches to a new one. Detach now clears the terminal's session-backed telemetry state (`session_id`, `session_file`, first-user-prompt, turn/tool fields), and renderer-side telemetry diffing now treats session identity fields as meaningful changes, so a pushed snapshot from a new session cannot be collapsed as "unchanged" and leave the old session title stuck on the tile

### Fixed (zh-CN)
- 左侧 live session 列表不再在 terminal 与 session 解绑或切到新 session 后继续挂着旧会话身份。现在 detach 会真正清空 terminal 上由 session 驱动的 telemetry 状态(`session_id`、`session_file`、首条用户 prompt、turn/tool 字段),同时 renderer 侧的 telemetry diff 也把这些 session identity 字段视为有效变化,所以新 session 推过来的 snapshot 不会再被当成"没变"吞掉,旧会话标题也不会继续黏在 tile 上

## [0.30.6] - 2026-04-20

### Fixed
- Terminal glyph corruption during `⌘E` overview transitions and `⌘[` / `⌘]` focus cycling is now significantly reduced. Two lifecycle changes landed together: scene-internal terminals no longer get parked just because they temporarily fall outside the viewport during a camera animation, and when a viewport animation settles the app now runs one recovery pass across every attached live WebGL terminal instead of only the source / target tile. This removes the most disruptive remount churn from the transition path and closes a gap where non-focused live terminals could still keep a stale WebGL atlas after the animation finished

### Fixed (zh-CN)
- `⌘E` overview 切换和 `⌘[` / `⌘]` 终端切换过程里的字形损坏现象现在明显减少。这次一起改了两条生命周期策略:只要 terminal 还在 scene 里,就不会因为 viewport 动画期间短暂移出可视区域而被 park;同时 viewport 动画结束后,不再只修 source / target terminal,而是会对所有已 attach 的 live WebGL terminal 统一跑一轮 recovery。这样既去掉了过渡路径里最扰人的 remount 抖动,也补上了"非聚焦但仍然 live 的 terminal 在动画结束后 atlas 仍然陈旧"这条缺口

## [0.30.5] - 2026-04-19

### Fixed
- Windows 11: resuming a session could crash the whole app with an `A JavaScript error occurred in the main process` dialog reading `Error: Cannot resize a pty that has already exited`. node-pty's Windows backend queues `resize()` calls in an internal `_deferreds` list until the named-pipe socket connects; if the underlying winpty agent has already exited by the time the queue is flushed, the replayed call throws from inside a `Socket` event handler, past any try/catch at the call site (see microsoft/node-pty#375). Main process now installs a narrow `uncaughtException` handler that swallows only that exact error (and the matching `Cannot write to a pty that has already exited` variant) and rethrows everything else. Note: this stops the crash dialog — the tab whose pty already died is still dead and needs to be closed and reopened; it does not fix the underlying node-pty race

### Fixed (zh-CN)
- Win11 下续接会话时整个 app 会崩出 `A JavaScript error occurred in the main process` 弹窗,内容是 `Error: Cannot resize a pty that has already exited`。node-pty 的 Windows 后端会把 `resize()` 调用排进内部 `_deferreds` 队列,等命名管道 socket 连上之后再回放;如果此时底层 winpty agent 已经退出,回放的调用会从 `Socket` 事件回调里同步抛错,已脱离调用点的 try/catch(见 microsoft/node-pty#375)。主进程现在装了一个只针对这条错误(以及同类的 `Cannot write to a pty that has already exited`)的 `uncaughtException` handler,命中就 warn 一行吞掉,其他异常原样 rethrow。注意:这只阻止崩溃弹窗——那个已经死掉的终端 tab 还是死的,需要手动关掉重开;node-pty 本身的竞态没有修

## [0.30.4] - 2026-04-19

### Fixed
- Left and right side panels sometimes rendered as blank until a mouse hover repainted them — most visible after returning to the app from the background. The panels were built as two absolute-positioned surfaces swapped via opposing `opacity` transitions; Chromium could promote each into an independent compositor layer, and those layers fell out of paint sync on foreground/background switch. Replaced with conditional rendering — only the currently-active state (collapsed icon strip OR expanded surface) mounts in the DOM at any time
- Collapsing or expanding the LEFT side panel made the canvas terminals shake horizontally instead of the clean shrink/grow the right panel already produced. Three animations were running on different clocks (panel width CSS 240 ms cubic-bezier, canvas container `left` React snap with no transition, viewport `animateTo` 400 ms easeOutCubic JS). All of them now share the same 240 ms cubic-bezier curve — both the CSS string and a matching JS easing function, defined once in `src/utils/panelAnimation.ts` — so the compensating terms cancel at every frame. Terminals stay put; the middle area just widens / narrows cleanly on both sides
- Worktree labels no longer snap back to their original position after you drop them (#140)
- Updater now surfaces a toast when the app is in a location that blocks auto-update (e.g. Downloads folder, read-only volume) instead of silently skipping (#139)

### Changed
- README warns Apple Silicon users to pick the arm64 build — the x64 build runs under Rosetta 2 on M-series Macs with measurable battery / performance cost

### Fixed (zh-CN)
- 左右侧栏偶尔展示成空白,只有鼠标移上去才重绘出现内容——最典型是从后台切回 app 之后。面板原本由两个 `absolute` 层用相反的 `opacity` 过渡做 crossfade,Chromium 可以把每一层提升成独立合成层,在前后台切换时这些层的重绘不一定同步。改成条件渲染:每一时刻只挂载当前状态(折叠图标条或展开面板)
- 折叠/展开**左**侧栏时画布里的终端会横向晃动一下,不像右侧栏那样干净地"缩小/放大"。原因是三条动画跑在三条不同时钟上(面板 width 走 240ms CSS cubic-bezier、画布容器 `left` 是 React 瞬跳没过渡、viewport `animateTo` 走 400ms easeOutCubic JS)。现在全部对齐到同一条 240ms cubic-bezier 曲线——CSS 字符串和 JS 缓动函数在 `src/utils/panelAnimation.ts` 里是同源定义——每帧补偿项精确抵消。终端不再晃,中间区域就是干净地从两侧变窄/变宽
- worktree 标签拖拽放下后不会弹回原位了(#140)
- 当 app 装在阻止自动更新的位置(如 Downloads 文件夹、只读卷)时,updater 现在弹 toast 提示而不是静默跳过更新(#139)

### Changed (zh-CN)
- README 提示 Apple Silicon 用户下载 arm64 版本——x64 版在 M 系 Mac 上走 Rosetta 2,耗电和性能都有可感知的差距

## [0.30.3] - 2026-04-19

### Fixed
- Terminals sometimes showed blank or garbled glyphs after switching back to the app from another window, waking the laptop from sleep, or on cold start. Root cause was the WebGL glyph atlas going stale without the GPU firing any signal. The fix rebuilds the atlas automatically on the four triggers that most commonly invalidate it: `window.focus` (catches Cmd+Tab back, lid-close-and-reopen, screen lock/unlock), initial tile attach after the host has laid out, theme change, and font / size / contrast change

### Added
- Toolbar "Refresh terminal rendering" button (circular-arrow icon, immediately left of the dark/light toggle). One-click rebuild of every terminal's glyph atlas — a manual escape hatch for the rare edge cases the automatic triggers can't detect (driver partial crash, GPU hot-swap, etc.). Replaces the old workaround of toggling the theme to force a redraw

### Fixed (zh-CN)
- 终端偶尔会在从其他窗口切回 app、笔记本唤醒后、或冷启动时显示空白 / 错位字符。根因是 WebGL 字形 atlas 缓存在 GPU 无事件通知的情况下变质。现在在四种最常触发失效的信号上自动重建 atlas:`window.focus`(涵盖 Cmd+Tab 返回、合盖唤醒、锁屏解锁)、tile 初次 attach 后 layout 完成、主题切换、字体 / 字号 / 对比度改动

### Added (zh-CN)
- 工具栏新增"刷新终端渲染"按钮(圆形箭头图标,紧挨亮暗切换按钮左边)。一键重建所有终端的字形 atlas —— 给自动信号抓不到的罕见场景(驱动局部崩、macOS GPU 热切换等)留个手动出口。替代之前"靠切主题当 workaround"的做法

## [0.30.2] - 2026-04-19

### Added
- File editor drawer now renders images: PNG, JPG/JPEG, GIF (animated), WebP, BMP, ICO, AVIF, APNG. Clicking an image in the Files tree or a search result previews it centered in the drawer with a transparent-checkerboard backdrop so alpha is visible. The per-file size cap is split — text stays at 512 KB, images go up to 10 MB so typical screenshots / GIFs open instead of silently failing
- Bilingual user guide at `docs/user-guide.md` + `docs/user-guide.zh.md`, linked from both READMEs. Walks through every non-obvious interaction (⌘E focus chain with double-click-to-zoom, drag-to-stash, right-click menus per surface, session resume fallback, canvas-gap drawer mutex, etc.)

### Changed
- Left and right side panels animate their expand / collapse with a 240 ms width ease and a crossfade between the narrow strip and the full surface. Nothing reflows mid-animation; the transition is suppressed while the resize handle is dragged so width still tracks the pointer 1:1
- Settings modal reorganised from 3 tabs into 5, each answering one question:
  - **General** — language, CLI integration toggle, app version + update
  - **Appearance** — font size, font family, animation, blur, minimum contrast
  - **Features** — composer, drawing tools, browser, terminal summary + its CLI picker, global search, canvas pet
  - **Agent** — API section (provider / format / base URL / key / model) + CLI Tools section (per-agent command paths)
  - **Shortcuts** — unchanged

### Fixed
- Memory tab's knowledge-graph nodes no longer shake for five seconds every time you enter the tab or a memory file is saved. The force simulation moved from the render loop (restarted on every `graph` reference change) to a one-shot offline `relaxLayout()`

### Added (zh-CN)
- 文件编辑器抽屉可以渲染图片了:PNG、JPG/JPEG、GIF(动图可播)、WebP、BMP、ICO、AVIF、APNG。在 Files 树或搜索结果里点图片,会在抽屉里居中预览,带透明棋盘底所以 alpha 能看见。单文件大小上限按类型拆分:文本保持 512 KB,图片放到 10 MB,常见截图 / GIF 不再被默默拦截
- 双语用户指南 `docs/user-guide.md` + `docs/user-guide.zh.md`,两份 README 都在顶部加了链接。把每个不说就发现不了的小交互都写清楚了(⌘E 聚焦连环 + 双击放大、拖到 stash、每类界面的右键菜单、会话续接回退、canvas-gap 抽屉互斥等等)

### Changed (zh-CN)
- 左右栏展开 / 折叠现在是 240 ms 宽度缓动 + 折叠条和完整面板之间的交叉淡入。动画中途不会 reflow;拖动 resize 把手时关闭过渡,宽度 1:1 跟着指针走
- 设置面板从 3 tab 重排成 5 tab,每个 tab 回答一件事:
  - **通用** — 语言、CLI 集成开关、app 版本 + 更新
  - **外观** — 字号、字体、动画、模糊、最小对比度
  - **功能** — composer、绘图、浏览器、终端总结 + CLI 选择器、全局搜索、水豚
  - **Agent** — API(provider / 格式 / base URL / key / model)+ CLI Tools(各 agent 命令路径)
  - **快捷键** — 保持不变

### Fixed (zh-CN)
- Memory tab 的知识图节点不再每次切进 tab 或 memory 文件保存时抖 5 秒。力场模拟从 render 循环(每次 `graph` 引用变都重跑)移到了离线一次性 `relaxLayout()`

## [0.30.1] - 2026-04-18

### Changed
- Welcome demo rewritten for the v0.30 layout: shows project management + "+" in the left panel, code navigation + Monaco editor drawer on the right, session replay as a left-anchored drawer, Usage dashboard as a canvas-gap panel. Both side panels now demo their collapsed → expanded transitions on click, matching how the app actually boots
- Welcome demo Usage mock is now a dense five-row dashboard (4-card stat strip → hourly + 30-day charts → cache / projects / models bar lists → quota meters → heatmap ribbon) so it looks like the real UsageOverlay at small scale instead of a sparse placeholder
- Typography hierarchy across agent surfaces (agent chat, ChatPanel, MessageBubble, AgentStatusBar, ThinkingBlock, Hub, Diff, StatusBadges): semantic type tokens (tc-display / title / body / ui / label / eyebrow / caption, tc-mono / num) replace ad-hoc px sizes and hardcoded zinc greys so the agent subsystem no longer drifts from the rest of the app under either theme

### Fixed
- Demo: drawer animations start flush against the panel seam instead of leaving a thin grey vertical line (border-l + border-r stacking at width=0 rendered as 2-px chrome)
- Demo: cursor click positions measured from DOM refs rather than hardcoded pixels, so they land on the correct targets regardless of container width

### Changed (zh-CN)
- 欢迎 demo 对齐 v0.30 布局重做:展示左栏项目管理 + 「+」、右栏代码导航 + Monaco 编辑器抽屉、会话回放作为左锚定抽屉、Usage 仪表盘作为 canvas-gap 面板;两侧栏都按真实 app 启动状态从折叠条开始,演示被点击后展开
- Demo 里的 Usage mock 现在是密集的五行仪表盘(4 张 stat 卡 → 并排的今日小时和 30 天趋势图 → 缓存率/项目/模型三列 bar → quota 条 → 热力图),小尺寸下也能看出是真实的 UsageOverlay,而不是稀疏占位
- agent 系列界面(agent chat、ChatPanel、MessageBubble、AgentStatusBar、ThinkingBlock、Hub、Diff、StatusBadges)引入排版层级,用语义化 type token(tc-display / title / body / ui / label / eyebrow / caption、tc-mono / num)替换临时的 px 尺寸和硬编码的 zinc 灰,两种主题下 agent 子系统不再与 app 其他部分"跑调"

### Fixed (zh-CN)
- Demo:抽屉展开动画从面板接缝处贴边展开,不再留下一道灰色竖线(关闭状态 border-l + border-r 叠在一起渲染成 2px 假 chrome)
- Demo:光标点击位置改成从 DOM ref 量出,不再是硬编码 px,任何容器宽度下都能落在正确的目标上

## [0.30.0] - 2026-04-18

### Added
- Editor: full-canvas Monaco drawer — click any file in the right panel to open it in a real VSCode-style editor with syntax highlighting, Cmd+S save, dirty tracking, and a two-level half/full width toggle. Replaces the cramped preview tab
- Editor: custom Monaco themes tuned to the app's warm palette — dark mode uses the charcoal `#1a1918` surface (not VSCode's stock cool grey); light mode gets an overhauled syntax palette (warm violet keywords, green strings, amber numbers, teal types) that reads naturally on the cream surface instead of the over-saturated stock vs colours
- Left panel: project management + session history in one place. "+" button (in the header and in the collapsed strip) adds a project in a single click; History section below ProjectTree lists past Claude/Codex sessions scoped to the current canvas
- Canvas-gap overlay system: Usage dashboard and Session replay now render as panels anchored in the gap between the left and right side panels, so both nav surfaces stay visible while you read code, dashboards, or transcripts. Three tenants (Usage / File Editor / Session Replay) are mutually exclusive in that slot

### Fixed
- Sessions: Claude Resume button is no longer grayed out — projectDir now reads the real `cwd` from inside the Claude JSONL instead of the dash-encoded directory name, so worktree matching succeeds
- Sessions: Codex Resume actually resumes the past session now — sessionId is extracted from `session_meta.payload.id` (which `codex resume` accepts) instead of the filename stem (which Codex rejected, falling back to a fresh session)
- Sessions: Resume closes the replay drawer before panning, so the newly spawned terminal is visible on the canvas instead of being hidden behind the drawer
- Left panel: the entire collapsed sidebar strip is now a click target — previously only the small chevron at the bottom expanded it
- Usage: overlay sizing tightened — individual components (stat cards, quota meters, device rows) no longer stretch beyond their readable width; the dashboard auto-hides when the canvas gap falls below a usable threshold and reappears when the side panels are narrowed again
- Usage: aligned chart heights and axis margins so side-by-side cards match; removed duplicate section titles; heatmap extended to a full year and centred within its card

### Changed
- Layout: the left and right panels swapped responsibilities. Files / Diff / Git / Memory tabs moved to the right panel (resizable, collapsible). The left panel is now dedicated to project management + history
- Sessions: replay view is now a left-anchored drawer that pulls out from the right edge of the left panel, with half / full expand levels. The old full-screen modal is gone — the session list lives in the left panel and stays visible while a replay plays

### Added (zh-CN)
- 编辑器:全画布 Monaco 抽屉 —— 在右侧栏 Files 里点任意文件,会像 VSCode 那样打开一个真正的编辑器,带语法高亮、Cmd+S 保存、脏状态跟踪、半屏/全屏切换。取代了之前拥挤的 preview tab
- 编辑器:自定义 Monaco 主题匹配 app 暖色调 —— 暗色用 charcoal `#1a1918`(不是 VSCode 原生的冷灰);亮色重做了整套语法色(warm violet 关键字、green 字符串、amber 数字、teal 类型),在 cream 背景上读起来自然,不会像原版 vs 那样饱和度过高显脏
- 左侧栏:项目管理 + 会话历史二合一。标题栏 + 折叠态都有「+」按钮,一键加项目;ProjectTree 下方是 History 区,列出当前 canvas 范围内的过往 Claude/Codex 会话
- Canvas-gap 抽屉体系:Usage 仪表盘、会话回放不再是全屏弹窗,而是锚定在左右栏之间的那块区域里,两边导航始终可见。Usage / 文件编辑器 / 会话回放三者在这块空间里互斥,同一时刻只显示一个

### Fixed (zh-CN)
- 会话:Claude 的 Resume 按钮不再全灰 —— projectDir 现在从 Claude JSONL 里直接读真实 `cwd`,而不是用 dash 编码的目录名,worktree 匹配成功
- 会话:Codex Resume 终于真能续接了 —— sessionId 从 `session_meta.payload.id` 里取(这是 `codex resume` 接受的 id),不再用文件名 stem(Codex 拒收,然后 fallback 成全新会话)
- 会话:点 Resume 后会先关闭回放抽屉再 pan 到新 terminal,不会出现"新 terminal 生成但被抽屉挡住看不见"的情况
- 左侧栏:折叠态整条竖条都可点击展开 —— 之前只有底部那个小箭头能展开
- Usage:面板尺寸收紧 —— StatCard / Quota / Devices 不会再被撑到远超可读宽度;canvas gap 太窄时仪表盘自动消失,缩回左右栏后重新出现
- Usage:并排卡片高度和横轴 margin 统一对齐;去掉了重复的 section 标题;热力图扩展到整年并在卡片内水平居中

### Changed (zh-CN)
- 布局:左右栏职能对调。Files / Diff / Git / Memory 四个 tab 搬到右侧栏(可拖宽、可折叠),左侧栏专门负责项目管理 + 历史
- 会话:回放从全屏 modal 改成左锚定抽屉,从左栏右边缘划出,支持半屏/全屏两级。历史列表留在左栏持续可见,边看回放边切 session 不用关抽屉

## [0.29.0] - 2026-04-17

### Added
- Terminal: new terminals stick to your preferred size — the first manual resize is learned and used for every subsequent "+ Terminal", regardless of sidebar width or collapse state
- Pet: refreshed capybara sprites with more expressive face, contour, and animation cadence
- Pet: ground shadow + heart/dust particle system for richer visual feedback
- Pet: richer idle behaviors including emotes, walk dust, bobbing question marks, and a spa-yuzu scene
- Pet: offline sprite preview script (`pet-preview`) for inspecting animations without running the app
- Telemetry: event-driven `awaiting_input` detection for Claude and Codex, replacing timer-based polling with signal-driven accuracy
- Hydra: PTY shell pid and capture time now persisted on each assignment run for post-hoc debugging
- Hydra: surfaces `stall_advisory` as a DecisionPoint to the Lead when a worker stops making progress

### Fixed
- Telemetry: first session attach now discards any `ps`-contaminated state left by previous unknown-provider detection
- Telemetry: derived state is reset when a terminal's provider flips from unknown to a known agent, preventing stale indicators
- Telemetry: MCP daemon churn no longer masquerades as agent progress or active tool calls
- Hydra: cleanup guarded against non-Lead callers to prevent orphaned workbench state
- Hydra: dispatch prompt strengthened; skill install failures now surface to the Lead instead of failing silently
- Hydra: watch loop probes PTY liveness directly rather than inferring it from polling cadence

### Changed
- Internal: every timing threshold centralized into `shared/lifecycleThresholds` so behavior adjustments don't require hunting through the codebase

### Added (zh-CN)
- 终端：新建终端会保持你的偏好尺寸——第一次手动调整大小后会被记住，后续每次「+ Terminal」都用这个尺寸，不再被侧边栏宽度或折叠状态影响
- 桌宠：水豚精灵图重绘，面部表情、轮廓、动画节奏更丰富
- 桌宠：新增地面阴影和爱心/灰尘粒子系统，视觉反馈更丰富
- 桌宠：新增更多闲置行为，包括表情动作、走路灰尘、头顶冒问号、柚子温泉场景
- 桌宠：新增离线精灵图预览脚本（`pet-preview`），不启动应用也能查看动画
- 遥测：Claude 和 Codex 的 `awaiting_input` 检测改为事件驱动，替代基于计时器的轮询，更准确
- Hydra：每次分派运行都记录 PTY shell pid 和捕获时间，方便事后排查
- Hydra：当 worker 停止推进时，向 Lead 暴露 `stall_advisory` DecisionPoint

### Fixed (zh-CN)
- 遥测：首次会话接入时会清除之前未知 provider 检测留下的 `ps` 污染状态
- 遥测：当终端 provider 从未知翻转到已知 agent 时会重置派生状态，避免指示器陈旧
- 遥测：MCP 守护进程的抖动不再被误判为 agent 进度或工具调用
- Hydra：清理流程防护非 Lead 调用方，防止遗留 workbench 状态
- Hydra：加强分派 prompt；技能安装失败现在会暴露给 Lead，不再静默失败
- Hydra：watch 循环直接探测 PTY 活性，而非根据轮询节奏推断

### Changed (zh-CN)
- 内部：所有时间阈值集中到 `shared/lifecycleThresholds`，行为调整不用再满代码库找

## [0.28.3] - 2026-04-16

### Added
- Pet: richer telemetry-driven reactions for tool running, tool pending, workflow start/completion/failure, stall, and stuck states

### Fixed
- Keyboard: Cmd/Ctrl+A now scopes "Select All" to the active context, selecting the focused input/editor or the focused terminal buffer instead of the wrong surface
- Pet: suppress repeated completion alerts after a finished terminal has already been seen

### Added (zh-CN)
- 桌宠：接入更丰富的遥测驱动反馈，覆盖工具运行、工具等待、工作流开始/完成/失败、停滞与卡住等状态

### Fixed (zh-CN)
- 键盘：Cmd/Ctrl+A 的“全选”现在按当前焦点上下文生效，会优先选中当前输入框/编辑区，或当前聚焦终端的缓冲区，而不是错误作用到别的区域
- 桌宠：已查看过完成结果的终端不再重复弹出完成提醒

## [0.28.2] - 2026-04-16

### Added
- Pet: attention queue with priority-based terminal notifications, plus attention movement that brings the capybara inside the target terminal instead of parking on the title bar

### Fixed
- Terminal: overview mode (Cmd+E) now keeps single-click focused for immediate typing, uses double-click anywhere on the terminal to zoom back in, and suppresses accidental xterm text selection during overview navigation
- UI: remove the focused terminal side glow and keep the focus state indicated by border only
- Pet: refine capybara sprite shading, contour, detail, and movement sizing to match the larger sprite scale

### Added (zh-CN)
- 桌宠：新增按优先级排队的终端提醒气泡；提醒时水豚会进入目标终端内部，而不是停在标题栏上

### Fixed (zh-CN)
- 终端：修复概览模式（Cmd+E）交互，单击后可立即输入，双击终端任意区域即可放大，并抑制导航时误触发 xterm 文本选区
- UI：移除终端聚焦时两侧的光晕，仅保留边框作为聚焦指示
- 桌宠：优化水豚精灵图的阴影、轮廓、细节和移动尺寸，使其与放大后的 sprite 比例一致

## [0.28.1] - 2026-04-16

### Added
- Canvas: click anywhere on a terminal tile to zoom in when zoomed out (Cmd+E), using fit-all scale as adaptive threshold

### Fixed
- Canvas: commit compact positions to store on label click without drag
- Terminal: prevent stale "Copied" toast from re-appearing on re-mount after zoom-to-fit
- UI: refine terminal focus indicator from hard ring to soft glow
- Focus: make spatial focus cycling (Cmd+]/Cmd+[) worktree-group-aware

### Added (zh-CN)
- 画布：缩小状态下（Cmd+E）单击终端 tile 任意位置即可放大聚焦，阈值基于 fit-all 缩放自适应

### Fixed (zh-CN)
- 画布：点击标签（无拖拽）时正确提交紧凑布局位置
- 终端：修复 zoom-to-fit 后重新挂载时"已复制"提示错误重现
- UI：终端聚焦指示器从硬边框改为柔和光晕
- 聚焦：Cmd+]/Cmd+[ 空间导航现在按 worktree 分组循环

## [0.28.0] - 2026-04-16

### Added
- Git: comprehensive git panel with stash, amend, merge, rebase, tags, remotes, file diff, and hunk staging
- Search: experimental global search (Cmd+K)
- Pet: pixel-art capybara desktop pet (experimental)

### Fixed
- Preview: stop click-to-edit, use button toggle instead
- Sessions: move early return after hooks to fix React rules violation

### Added (zh-CN)
- Git：完整 git 面板，支持 stash、amend、merge、rebase、标签、远程、文件 diff、hunk 暂存
- 搜索：实验性全局搜索（Cmd+K）
- 桌宠：像素风水豚桌面宠物（实验性）

### Fixed (zh-CN)
- 预览：点击编辑改为按钮切换
- 会话面板：修复 hooks 顺序违反 React 规则的问题

## [0.27.8] - 2026-04-15

### Added
- Canvas: summon-style label drag with collision detection — dragging a worktree label repositions it with automatic avoidance of overlapping labels

### Fixed
- Canvas: stop label drag preview update loop that caused unnecessary re-renders
- Canvas: preserve node position while resizing
- Renderer: restore missing getProjectBounds export
- Git panel: initialize viewport height with ResizeObserver on mount to prevent blank bottom area
- CI: rezip-electron requires -o flag for output path

### Added (zh-CN)
- 画布：召唤式标签拖拽，支持碰撞检测 — 拖拽 worktree 标签时自动避让重叠标签

### Fixed (zh-CN)
- 画布：修复标签拖拽预览的无限更新循环
- 画布：调整节点大小时保留节点位置
- 渲染器：恢复 getProjectBounds 导出
- Git 面板：挂载时用 ResizeObserver 初始化视口高度，修复底部空白
- CI：rezip-electron 需要 -o 参数指定输出路径

## [0.27.7] - 2026-04-14

### Added
- Updater: blockmap-based differential downloads for macOS — subsequent updates now download only changed blocks (~3-5 MB) instead of the full ZIP (~120 MB), with automatic fallback to full download on failure
- Hydra: `hydra spawn --role <name>` dispatches any role (not just dev) into an isolated terminal
- Hydra: `hydra scan` convenience command — spawns a janitor role for codebase entropy scanning
- Hydra: role-specific model and reasoning effort are forwarded from role definitions to spawned agents

### Fixed
- Updater: skip directly to the latest version instead of updating through every intermediate release
- Updater: preserve pending update when offline so users can still install an already-downloaded version
- Updater: download to a temp directory so a failed download does not destroy a previously valid pending update
- Canvas: main worktree is no longer dropped when project scanner syncs worktree list
- CI: macOS ZIPs are re-compressed with rezip-electron for efficient differential updates; latest-mac.yml hashes are recomputed after optimization

### Changed
- Hydra: CLI cleanup — consistent reset behavior, cleanup state preservation, SubAgent renamed to Run

### Added (zh-CN)
- 更新器：macOS 基于 blockmap 的差量下载 — 后续更新仅下载变化的块（约 3-5 MB），而非完整 ZIP（约 120 MB），失败时自动回退到全量下载
- Hydra：`hydra spawn --role <name>` 可将任意角色调度到独立终端
- Hydra：`hydra scan` 快捷命令 — 启动 janitor 角色进行代码库熵扫描
- Hydra：角色定义中的 model 和 reasoning effort 会传递给生成的 agent

### Fixed (zh-CN)
- 更新器：直接跳到最新版本，不再逐版本更新
- 更新器：离线时保留已下载的待安装更新，用户仍可安装
- 更新器：下载到临时目录，下载失败不会破坏已有的待安装更新
- 画布：项目扫描器同步 worktree 列表时不再丢失主 worktree
- CI：macOS ZIP 使用 rezip-electron 重压缩以支持高效差量更新；优化后重新计算 latest-mac.yml 的哈希值

### Changed (zh-CN)
- Hydra：CLI 清理 — 统一 reset 行为、cleanup 状态保留、SubAgent 重命名为 Run

## [0.27.6] - 2026-04-13

### Changed
- Hydra: rename Workflow → Workbench, Node → Dispatch — Hydra is now Lead's persistent workbench for multi-role orchestration, not a predefined workflow
- Hydra: remove DAG dependency system (`depends_on`, auto-blocking, cascade reset, node promotion) — Lead sequences dispatches manually and passes context explicitly via `--context-ref`
- Hydra: merge Node + Assignment into Dispatch, eliminating redundant abstraction layers; each dispatch carries inline status
- Hydra: CLI flags renamed (`--workflow` → `--workbench`, `--node` → `--dispatch`)
- Hydra: result contract uses `workbench_id` instead of `workflow_id`
- Hydra: file layout changed from `.hydra/workflows/` to `.hydra/workbenches/`, `nodes/` to `dispatches/`

### Changed (zh-CN)
- Hydra: 重命名 Workflow → Workbench, Node → Dispatch — Hydra 现在是 Lead 的持久化工作台，而非预定义工作流
- Hydra: 移除 DAG 依赖系统（`depends_on`、自动阻塞、级联重置、节点提升）— Lead 手动排序调度，通过 `--context-ref` 显式传递上下文
- Hydra: 合并 Node + Assignment 为 Dispatch，消除冗余抽象层；每个 dispatch 内联状态
- Hydra: CLI 参数重命名（`--workflow` → `--workbench`、`--node` → `--dispatch`）
- Hydra: 结果契约使用 `workbench_id` 替代 `workflow_id`
- Hydra: 文件布局从 `.hydra/workflows/` 变更为 `.hydra/workbenches/`，`nodes/` 变更为 `dispatches/`

## [0.27.5] - 2026-04-11

### Fixed
- Clicking a worktree label on the canvas now also focuses that worktree, so a follow-up `cmd+t` creates the new terminal inside the worktree you just clicked instead of whichever one happened to be focused before. The label click handler now pairs `panToWorktree` with `focusWorktreeInScene`, matching the convention already used by Hub and `cmd+]` / `cmd+[` worktree-level navigation. The LOD project-label fallback (extreme zoom-out) also focuses the first populated worktree, so click-then-`cmd+t` works at every scale

### Fixed (zh-CN)
- 在画布上点击 worktree 标签时，现在会同时把键盘焦点切到该 worktree，这样紧接着按 `cmd+t` 新建的终端会落在你刚刚点击的 worktree 里，而不是上一次焦点所在的 worktree。label 的 click handler 现在会同时调 `panToWorktree` 和 `focusWorktreeInScene`，与 Hub 以及 `cmd+]` / `cmd+[` worktree 级导航的现有约定一致。极远缩放下点击 LOD 模式的项目级合并标签也会聚焦该项目的第一个有内容的 worktree，因此在任何缩放比例下"点了再 cmd+t"都能落到正确位置

## [0.27.4] - 2026-04-11

### Added
- Screen-space worktree label layer: each worktree now shows a pixel-fixed `project / worktree` label anchored to its topmost terminal, scaled-driven so it fades in as you zoom out and collapses to `Project (N)` at extreme zoom-out; hovering any terminal lights up its worktree's label, hovering or clicking a label highlights it and pans the viewport to fit the worktree
- Top-left HUD pill that shows the focused `project / worktree` whenever you're zoomed in past 0.7, so the canvas itself answers "where am I" without forcing the right session panel open
- `wuu` is now a first-class terminal agent type
- `IconButton` and `ConfirmDialog` UI primitives, adopted across the right session panel
- Sessions panel auto-opens the first time a project is added so new users see their newly added project immediately

### Changed
- `cmd+d` is now the strict inverse of `cmd+t`: closing the focused terminal lands focus on the spatial-LEFT row sibling in the SAME worktree (mirroring `cmd+t`'s right-of-focused insertion), and only walks worktree → project → cross-project as fallbacks. Pressing `cmd+t` then `cmd+d` round-trips back to the original focused tile, and you can no longer be silently kicked out of the project you were working in
- The yellow project-name sticker in each terminal header is removed; the new label layer carries that information at a readable size at every zoom
- The Hub focus-level switcher is hidden for now while the underlying level cycling is reworked, since it overlapped the new HUD
- The cluster toolbar is hidden until its layout algorithm is reworked
- Right session panel: project/worktree removal is unified on the new `ConfirmDialog`, with two-step confirm and a `--force` fallback for non-empty worktree removal
- Right session panel: chevrons are semantic `<button>`s with focus-visible rings and proper tablist semantics; left-click on a worktree row toggles expand instead of being conflated with focus

### Fixed
- New terminals now have their tile size recomputed on every create, so the first tile in a fresh worktree always lands at the right dimensions instead of inheriting a stale measurement
- Codex session attach now uses the SessionStart hook for an exact match instead of guessing from polling order
- OpenAI streaming `tool_call` accumulator is realigned with the `openai-node` upstream so partial argument chunks are stitched in the correct order

### Added (zh-CN)
- 屏幕坐标系下的 worktree 标签层：每个 worktree 现在会在它最上方那个终端的上方显示一个 `项目 / worktree` 标签，字号是固定像素大小，跟随画布平移和缩放但本身不会变小；标签会随着缩远渐入显示，缩到极远时会自动合并成 `Project (N)`；hover 任何终端会点亮它所属 worktree 的标签，hover 或点击标签会高亮它并把视口平移到刚好包住该 worktree
- 当画布缩放 ≥ 0.7（你正在某个终端里打字时），左上角会出现一个 HUD pill 显示当前焦点的 `项目 / worktree`，让画布本身回答"我在哪"，不再强迫你打开右侧 session 面板才知道
- `wuu` 现在是一等的终端 agent 类型
- 新增 `IconButton` 和 `ConfirmDialog` 两个 UI 原语，并在右侧 session 面板里推广使用
- 第一次新增项目时，session 面板会自动打开，让新用户立即看到刚添加的项目

### Changed (zh-CN)
- `cmd+d` 现在是 `cmd+t` 的严格逆运算：关闭焦点终端后，焦点会落到**同一个 worktree 内、同一行的左侧邻居**（对应 `cmd+t` 在焦点右边插入新终端），fallback 顺序严格走 worktree → project → 跨项目。连按 `cmd+t`、`cmd+d` 会完全回到原焦点终端；再也不会在你不知情的情况下被踢到别的项目里
- 删除了终端 header 上的黄色项目名贴纸；新的标签层在任何缩放下都能读清楚归属，贴纸不再需要
- Hub 层级切换器临时隐藏，因为和新 HUD 重叠，且底层 focus-level 还在改造
- 集群工具条临时隐藏，等布局算法重做完再恢复
- 右侧 session 面板：项目和 worktree 的删除流程统一到新的 `ConfirmDialog`，提供两步确认；非空 worktree 删除会回退到 `--force`
- 右侧 session 面板：折叠箭头改为语义 `<button>`，带 focus-visible 圈和正确的 tablist 语义；worktree 行的左键点击改为切换展开而不是混淆成 focus

### Fixed (zh-CN)
- 新建终端现在每次都会重新计算 tile 尺寸，避免在一个空 worktree 里第一个终端继承到上次的旧尺寸
- Codex 会话 attach 改为通过 SessionStart hook 精确匹配，不再依赖轮询顺序猜测
- OpenAI 流式 `tool_call` 累加器与上游 `openai-node` 对齐，部分参数 chunk 现在按正确顺序拼接

## [0.27.3] - 2026-04-10

### Fixed
- Dragging the left sidebar width no longer force-zooms the focused terminal back to fit-scale when the canvas is in plain (non zoom-focus) focus mode; the resize cleanup now consults the shared viewport focus state and only re-fits the viewport when the user is actually in zoom-focus mode

### Changed
- The "zoomed out vs zoom-focused" flag previously kept as a local ref inside the keyboard shortcut hook is now lifted into a shared `viewportFocusStore`, so any surface that mutates the viewport (sidebar resize today, future panels tomorrow) reads the same source of truth instead of guessing the mode

### Fixed (zh-CN)
- 在“仅聚焦”（非放大聚焦）模式下拖动左侧栏宽度，不再强制把当前聚焦终端重新放大充满视口；拖动结束后的清理逻辑会读取共享的视口聚焦状态，只有在真正处于放大聚焦模式时才会重新 fit 视口

### Changed (zh-CN)
- 原本只活在键盘快捷键 hook 里的 `zoomedOutTerminalIdRef` 已提升为共享的 `viewportFocusStore`，让所有会改动视口的入口（当前是侧栏拖动，未来其它面板）都从同一份状态读取焦点模式，而不是各自猜测

## [0.27.2] - 2026-04-11

### Added
- Terminal tiles can now use the first real user prompt from telemetry as the default title, so new Codex/agent sessions are easier to distinguish in the canvas and sessions panel

### Fixed
- Telemetry title extraction now skips injected context so agent terminals do not pick a synthetic bootstrap message as the visible title
- Sessions wait one poll cycle before accepting Codex session data and reject the baseline session, reducing false-positive terminal matches during initial discovery
- Terminal resize handles now appear on hover instead of only on selected tiles, making free-resize discoverable without bringing back the always-on frame
- Cmd+T placement now anchors from the focused terminal when possible, keeping new terminals closer to the user’s current working area

### Added (zh-CN)
- 终端瓦片现在可以把遥测中的第一条真实用户消息作为默认标题，因此新的 Codex/agent 会话在画布和会话面板里更容易区分

### Fixed (zh-CN)
- 遥测标题提取现在会跳过注入的上下文，避免 agent 终端把启动时的合成引导消息显示成可见标题
- 会话发现现在会先延后一轮轮询再接受 Codex 会话数据，并过滤基线会话，减少初始化阶段的误匹配
- 终端尺寸调节手柄改为 hover 时显示，而不是只在选中 tile 时显示，让自由调整尺寸更容易被发现，同时不再恢复常驻外框
- Cmd+T 放置新终端时会优先以当前聚焦终端为锚点，让新 terminal 更接近用户当前的工作区域

## [0.27.1] - 2026-04-11

### Fixed
- Terminal resize handles and the surrounding node outline no longer stay visible on every tile all the time; the resizer now appears only for the selected terminal, removing the always-on blue frame from the canvas
- Closing a terminal with cmd+d now re-zooms to the next focused terminal when the canvas is in normal zoomed-in navigation mode, instead of only panning and leaving the viewport scale behind

### Fixed (zh-CN)
- 终端尺寸调节手柄和外围节点描边不再常驻显示在每个 tile 外侧；现在只有选中该终端时才显示，去掉了画布上一直存在的蓝色外框
- 在普通聚焦导航模式下，用 cmd+d 关闭终端后，现在会重新缩放聚焦到下一个终端，而不是只平移视口导致缩放状态残留

## [0.27.0] - 2026-04-10

### Added
- Free resize of terminal tiles: drag any corner or edge of a terminal node to reshape it live; the inner xterm refits cols/rows on release
- Double-click the terminal header to zoom-to-fit that terminal (restored after the flat-canvas refactor, now respects the tile's current freely-resized dimensions)
- Clicking a worktree or project row in the session panel activates it, so a subsequent cmd+t targets that row without having to click back on the canvas first
- Right-clicking a session panel row also activates it before opening the context menu so cmd+t after dismissing the menu still lands on the right row
- Viewport-aware grid placement for cmd+t: new terminals now fill the visible canvas row-major (top-left → bottom-right), stepping past user-resized wide tiles instead of getting stuck behind them; the old rightmost-sibling anchor is kept as a fallback only when the viewport is saturated or smaller than a default tile
- Spatial (y asc, x asc, id) navigation order shared between cmd+] / cmd+[ and cmd+d's "next focus after close", so prev/next and post-close focus both follow what the user sees on screen instead of the array insertion order that only made sense on the old grid layout

### Changed
- cmd+t no longer stacks new terminals vertically below the worktree's bounding box; the no-parent placement path anchors off the rightmost sibling first (when the viewport grid is unavailable) instead of its bottom
- Session panel row click only activates the row; collapse/expand is now a dedicated chevron button so the two gestures don't stomp on each other

### Fixed
- cmd+d lands focus on the spatial next terminal to match cmd+] / cmd+[, instead of whichever terminal happened to be array-adjacent inside the same worktree
- Restored CLI tiles fall back to a default shell when the original CLI process is already gone during session rehydration, instead of leaving a dead tile behind

### Removed
- cmd+1 / cmd+2 / cmd+3 / cmd+4 tile-size presets (tileSizeDefault / tileSizeWide / tileSizeTall / tileSizeLarge): the hardcoded 640x480 / 1288x480 / 640x968 / 1288x968 dimensions ignored the adaptive tileDimensionsStore and interacted badly with focus zoom. Free NodeResizer drag-resize replaces them end-to-end. Removed shortcut definitions on both mac and win/linux defaults, the handler loop, the SettingsModal / ShortcutHints rows, the en/zh i18n strings, and the now-unused updateTerminalSizeInScene action. The localStorage migration helper strips any leftover span* / tileSize* keys on load

### Added (zh-CN)
- 终端瓦片支持鼠标自由调整尺寸：拖动节点四角或四边即时改变大小,释放后 xterm cols/rows 自动重新适配
- 双击终端顶部标题栏聚焦放大该终端（在自由画布重构之后补回,现在会按照 tile 当前的自由尺寸计算缩放）
- 在右侧会话面板点击某个 worktree 或 project 行会把它激活,接着按 cmd+t 就会在对应行下建新终端,不用再切回 canvas 点一下
- 右键会话面板的行时也会先激活所在行再弹出菜单,避免关闭菜单后 cmd+t 还落到之前那一行
- cmd+t 的新终端放置改为感知视口的行优先网格填充（左上 → 右下）：遇到用户自由 resize 出来的宽胖 tile 会跳过它继续在同一行放置,视口塞满或太小时才回退到 rightmost-sibling 锚点
- cmd+] / cmd+[ 和 cmd+d 关闭后的"下一个焦点"统一改成空间顺序（按 y 升序再按 x 升序,同位置用 id 做稳定 tiebreaker）,和屏幕上看到的前后关系一致,不再跟随数组创建顺序

### Changed (zh-CN)
- cmd+t 不再把新终端堆到 worktree 包围盒下方;没有 parent 的情况在视口网格不可用时会锚到 rightmost sibling 的右边,而不是底部
- 会话面板的行点击只触发激活,折叠/展开归还给独立的 chevron 图标,两个动作不再互相干扰

### Fixed (zh-CN)
- cmd+d 关闭焦点终端后的新焦点改为空间顺序上的下一个,和 cmd+] / cmd+[ 的语义对齐,不再跳到数组里的创建顺序邻居
- 恢复会话时如果原来的 CLI 进程已经退出,现在会自动落回一个默认 shell,而不是留下一个死 tile

### Removed (zh-CN)
- 删除 cmd+1/2/3/4 的 tile-size 预设快捷键（tileSizeDefault / tileSizeWide / tileSizeTall / tileSizeLarge）：硬编码的 640x480 / 1288x480 / 640x968 / 1288x968 完全忽略自适应的 tileDimensionsStore,并且和聚焦缩放有互相干扰。自由拖拽节点手柄调整尺寸已经完整替代这套快捷键。相关的 mac 和 win/linux 键位定义、handler 循环、SettingsModal / ShortcutHints 显示行、en/zh i18n 字符串、以及无人引用的 updateTerminalSizeInScene action 全部一并删除;localStorage 里遗留的 span* / tileSize* 键会在加载时自动清理

## [0.26.0] - 2026-04-10

### Added
- Free canvas layout: terminals are now flat top-level ReactFlow nodes that can be freely positioned, replacing the nested project/worktree containers
- Clustering toolbar with rule picker (by project / worktree / type / status / custom tag) and an undo for the last cluster
- Custom Tags… popover on each terminal for managing user tags
- Auto-placement for newly created terminals so they land in a free spot on the canvas
- Collision resolver to nudge tiles apart when they overlap (also applied when unstashing)
- Add Project Folder entry in the canvas right-click menu and a + button in the session panel header
- Inline + button on session panel rows for creating a new terminal in that project/worktree
- Hover × button to remove a non-main worktree directly from the session panel
- Hover × button to close a single terminal directly from its session panel card
- Remove Project entry in the project context menu (panel-only removal, files untouched)
- Delete Project from Disk… entry with a typed-name confirmation modal that calls a guarded `project:delete-folder` IPC
- Auto-migration from legacy v1 (nested) snapshots into the free canvas layout on load
- End-to-end integration test suite for the free canvas

### Changed
- Session panel strings (context menus, notifications, delete-project modal) are fully internationalized; added panel_* keys to en/zh dictionaries
- Worktree row now exposes Remove via the hover × button instead of a right-click menu
- Canvas right-click menu uses the shared ContextMenu component for consistency
- Shortcut identifiers renamed from span* to tileSize* (existing keybinds preserved)

### Fixed
- Popovers (canvas right-click menu, cluster dropdown) no longer stay stuck open: dismiss listeners now run in the capture phase so React Flow's stopPropagation can't swallow them
- Cluster toolbar now positions itself below the toolbar and respects the right-panel inset
- Terminal tile border restored after the free-canvas flatten refactor
- Session panel now shows projects and worktrees that have no terminals
- Cluster toolbar gained Escape-to-close support

### Removed
- Dead grid-pack helpers superseded by the free canvas layout
- Orphaned compactFocusedProject shortcut

### Added (zh-CN)
- 自由画布布局：终端改为 ReactFlow 顶层节点，可在画布任意位置自由摆放，不再使用嵌套的项目/工作树容器
- 集群工具栏，支持按项目 / 工作树 / 类型 / 状态 / 自定义标签聚类，并可撤销上一次聚类
- 终端 Tags… 弹层，用于管理自定义标签
- 新建终端时自动放置到空闲位置
- 终端瓦片重叠时的碰撞偏移（取出暂存时也会应用）
- 画布右键菜单新增 "Add Project Folder" 入口；会话面板顶部新增 + 按钮
- 会话面板各行增加内联 + 按钮，可在该项目 / 工作树下快速新建终端
- 会话面板支持 hover 时显示 × 按钮直接移除非 main worktree
- 会话面板的终端卡片支持 hover 时显示 × 按钮直接关闭终端
- 项目右键菜单新增 "Remove Project"（仅从面板移除，磁盘文件不动）
- 项目右键菜单新增 "Delete Project from Disk…"，需在弹窗中输入项目名确认，主进程 `project:delete-folder` IPC 已加路径安全护栏
- 加载旧版 v1（嵌套）快照时自动迁移到自由画布布局
- 自由画布的端到端集成测试套件

### Changed (zh-CN)
- 会话面板的所有文案（右键菜单、通知、删除项目弹窗等）已完成国际化，新增 panel_* 键到 en/zh 字典
- Worktree 移除入口从右键菜单改为 hover 时的 × 按钮
- 画布右键菜单改为复用共享的 ContextMenu 组件
- 快捷键标识符从 span* 重命名为 tileSize*（已有键位保持不变）

### Fixed (zh-CN)
- 画布右键菜单和集群下拉菜单不再卡住打不掉：dismiss 监听器改在 capture 阶段触发，避免被 React Flow 的 stopPropagation 吞掉
- 集群工具栏现在放在工具栏下方，并尊重右侧面板的内边距
- 修复自由画布扁平化重构后丢失的终端瓦片边框
- 会话面板现在会显示没有终端的项目和工作树
- 集群工具栏新增 Escape 关闭

### Removed (zh-CN)
- 删除自由画布之后已无用的 grid-pack 辅助代码
- 删除已无引用的 compactFocusedProject 快捷键

## [0.25.23] - 2026-04-09

### Changed
- Separated terminal focus semantics from viewport zoom semantics:
  - Clicking a terminal now keeps focus highlight without forcing viewport zoom.
  - Cmd+E now toggles zoom state while keeping terminal focus highlight.
- Cmd+T and Cmd+D now preserve current zoom scale and only pan the viewport.
- In non-zoomed mode, Cmd+[ and Cmd+] now preserve scale and only pan to the previous/next focused terminal.

### Changed (zh-CN)
- 终端聚焦语义与视口缩放语义已拆分：
  - 点击终端仅保留聚焦高亮，不再强制缩放视口。
  - Cmd+E 改为切换缩放状态，同时保留终端聚焦高亮。
- Cmd+T 与 Cmd+D 现在保持当前缩放比例，仅平移视口。
- 在非放大模式下，Cmd+[ 与 Cmd+] 现在保持缩放比例，仅平移到上一个/下一个聚焦终端。

## [0.25.22] - 2026-04-09

### Fixed
- Sessions panel terminal ordering is now stable within project/worktree groups instead of dynamically reordering by activity updates

### Fixed (zh-CN)
- 会话面板在项目/工作树分组内的终端顺序改为稳定顺序，不再随活动更新动态重排

## [0.25.21] - 2026-04-09

### Added
- Worktree management now supports create/remove routes in the Electron API server and IPC bridge
- Added right-click "New Worktree..." and "Remove Worktree" menus in the sessions project tree and canvas project/worktree headers

### Added (zh-CN)
- Electron API server 与 IPC bridge 新增工作树创建/删除能力
- 会话项目树与画布项目/工作树标题支持右键菜单（"New Worktree..."、"Remove Worktree"）

### Fixed
- New Worktree creation now uses an inline branch-name popover instead of system prompt, keeps the popover onscreen, and closes when clicking outside
- Summary title updates now respect toggle state and ignore stale async writes

### Fixed (zh-CN)
- 创建工作树改为内联分支名输入弹层，不再依赖系统 prompt；弹层会保持在可视区内，点击空白处可关闭
- Summary 标题更新现在遵守开关状态，并忽略过期的异步写入

## [0.25.20] - 2026-04-09

### Fixed
- Awaiting input detection now works reliably: fixed snapshot push failure when the 5s timer fires, and prevented late JSONL session events from clobbering the awaiting_input state
- Sessions panel keeps focused terminals visible in the project tree instead of hiding them
- Panel turn elapsed timer now counts from actual turn start instead of showing zero

### Fixed (zh-CN)
- 等待交互检测现已可靠工作：修复 5 秒定时器触发后快照未推送的问题，并防止延迟到达的 JSONL 会话事件覆盖 awaiting_input 状态
- 会话面板的项目树中不再隐藏当前聚焦的终端
- 面板的 turn 耗时计时器现在从实际 turn 开始时间计算，而非显示为零

### Fixed
- Pinch-to-zoom no longer triggers on focused terminal tiles

### Fixed (zh-CN)
- 聚焦终端不再响应双指缩放手势

## [0.25.19] - 2026-04-08

### Fixed
- Sessions panel now shows the provider name (e.g. "Claude", "Codex") instead of generic "Terminal" when no custom title is set

### Fixed (zh-CN)
- 会话面板在终端没有自定义标题时，显示 provider 名称（如 "Claude"、"Codex"）而非通用的 "Terminal"

## [0.25.18] - 2026-04-08

### Added
- Sessions panel now uses a tree layout grouped by Project → Worktree → Terminal, replacing the flat status-based grouping
- Terminal tile header shows the project name instead of the telemetry badge
- Awaiting input detection: when an AI agent (Claude Code / Codex) waits for user interaction (tool approval, answering questions, plan review) for more than 5 seconds, the sessions panel shows a red "Awaiting input" status instead of the orange "Running" status (WIP — detection may not trigger in all cases)

### Added (zh-CN)
- 会话面板改为按 项目 → Worktree → 终端 的树形结构分组，替代原来的扁平状态分组
- 终端标题栏显示项目名称，移除遥测徽章
- 等待交互检测：当 AI 代理（Claude Code / Codex）等待用户交互（工具批准、回答问题、计划审批）超过 5 秒时，会话面板显示红色"等待交互"状态，而非橙色"运行中"（WIP — 部分场景下可能未触发）

## [0.25.17] - 2026-04-07

### Fixed
- File tree now shows dotfiles and previously hidden directories (node_modules, dist, build, out); only .git is hidden

## [0.25.16] - 2026-04-07

### Fixed
- Viewport focus switching no longer produces a zoom bounce effect; animation uses JS frame interpolation instead of xyflow's smoothstep
- Closing the focused terminal with Cmd+D now pans the viewport to the adjacent terminal
- Plain shell terminals no longer show as "Thinking" / "PROGRESSING" in the sessions panel and tile badge
- Live xterm containers no longer capture scroll wheel events intended for the canvas

## [0.25.15] - 2026-04-07

### Changed
- Restored the right sidebar Sessions panel interaction model to match v0.25.12 (focused/attention/progress grouping, inspector trace, jump-to-terminal flow)
- Worktree focus navigation now applies focus before viewport pan so focus-switch animation behavior matches v0.25.12

### Fixed
- Codex sessions in `in_turn` state are no longer treated as indefinitely progressing when session events are stale
- Session scanner now downgrades stale `generating`/`tool_running` history entries to `idle` to avoid misleading live-state labels

## [0.25.14] - 2026-04-07

### Added
- Git status badges in file tree: VS Code-style letter badges (M, U, A, D, R, C) with color-coded file names and folder dot indicators
- File name coloring matches git status (yellow=modified, green=untracked/added, red=deleted)

## [0.25.13] - 2026-04-07

### Added
- Inject Codex CLI lifecycle hooks (PreToolUse, PostToolUse, SessionStart, Stop, UserPromptSubmit) for real-time telemetry via Unix socket
- Auto-enable `codex_hooks` feature flag in `~/.codex/config.toml` on skill install
- Parse additional Codex JSONL events (exec_command, patch_apply, web_search, mcp_tool_call, turn_started, turn_complete, error) as telemetry fallback layer
- Surface `task_status` and `active_tool_calls` in telemetry UI

### Fixed
- `deriveTelemetryStatus` no longer falsely reports `stall_candidate` when Codex is doing long inference or has active tool calls
- Hook-driven session attachment now preserves the registered terminal provider instead of hardcoding to "claude"

### Changed
- Simplified main-brain telemetry polling instructions to trust `derived_status` and `task_status` as primary decision signals

## [0.25.12] - 2026-04-06

### Fixed
- Pan viewport after closing focused terminal

## [0.25.11] - 2026-04-06

### Fixed
- Stashed terminals no longer affect worktree and project sizing, terminal packing, or drag reordering calculations

## [0.25.10] - 2026-04-06

### Changed
- Offscreen unfocused terminals now park their live runtime while tile rendering stays tied to actual viewport visibility

### Fixed
- Parked terminal previews no longer break on ANSI escape boundaries and resumed terminals now recover more reliably without unnecessary resize, font, or WebGL churn
- PTY login shell environment seeding now strips host-session variables like `TERM_PROGRAM`, `CODEX_*`, and `P9K_*` before spawning the shell

## [0.25.9] - 2026-04-05

### Fixed
- Bundled skills are now available to Codex after app startup, including `challenge`, `hydra`, `investigate`, and `using-termcanvas`
- Skill discovery now scans both Codex and Claude skill directories and supports both `SKILL.md` and `skill.md`
- Bundled skill installation no longer depends on CLI registration succeeding first

## [0.25.8] - 2026-04-05

### Changed
- Sessions in the right sidebar are now grouped by current canvas visibility, recent activity, and history, with on-canvas sessions prioritized ahead of off-canvas sessions
- Session cards now show shorter activity labels instead of raw long command paths

### Fixed
- Duplicate session entries are now deduplicated before the sessions panel updates

## [0.25.6] - 2026-04-05

### Changed
- Sessions in the right sidebar are now grouped by current canvas visibility, recent activity, and history, with on-canvas sessions prioritized ahead of off-canvas sessions
- Session cards now show shorter activity labels instead of raw long command paths

### Fixed
- Duplicate session entries are now deduplicated before the sessions panel updates

## [0.25.5] - 2026-04-05

### Fixed
- Release builds no longer fail when Codex session discovery imports `node:sqlite`; the SQLite dependency is now loaded lazily in the Electron main process path

## [0.25.4] - 2026-04-05

### Changed
- Git commit input is now centered for cleaner presentation

### Fixed
- Global app shortcuts now stop leaking into terminals and use better default mappings on Windows and Linux
- Codex session attach and discovery are more reliable by using the Codex state database
- Downloaded terminal fonts now switch correctly on Windows by loading valid `file:///` font URLs

## [0.25.3] - 2026-04-05

### Fixed
- Windows app startup no longer fails when the hook receiver tries to bind a Unix `.sock` path; it now uses a Windows named pipe
- App startup now degrades safely if the hook receiver cannot start, instead of blocking the main window from opening

## [0.25.2] - 2026-04-05

### Added
- Automatic CLI integration on first app launch, including Codex/Claude skill installation

### Changed
- Settings modal toggles and status text polished for more stable async feedback and localized copy

### Fixed
- Hidden unfinished agent message bubble from the app UI
- CLI integration toggle now respects explicit user opt-out while still allowing manual re-enable

## [0.25.0] - 2026-04-03

### Added
- Live sessions panel and session replay in right sidebar
- Session scanner with managed session discovery
- Session store with IPC subscription
- Right panel tab system with Usage and Sessions tabs
- i18n for sessions panel and replay view

### Fixed
- Race guard, error handling, async IO, and user prompt issues (challenge findings)
- Summary CLI stderr capture increased from 200 to 500 chars for better error diagnostics

### Changed
- Stable socket path for hook receiver

## [0.24.2] - 2026-04-03

### Fixed
- Terminal white screen on spawn and after layout changes: runtime-side `usesAgentRenderer` guard blocked xterm attachment for claude-type terminals
- Instrument WebGL context loss with toast notification and localStorage counter for observability

## [0.24.1] - 2026-04-03

### Fixed
- Terminal white screen: xterm never created because containerRef was null when useEffect ran; switched to callback ref so container availability triggers attachment

## [0.24.0] - 2026-04-03

### Added
- Challenge gate: 4 parallel adversarial workers review evaluator success verdicts before completing Hydra workflows
- Evaluator skepticism rules: independent assessment before reading implementer claims, no-evidence-no-pass, default to fail when uncertain

### Changed
- Browse CLI is now mandatory for Hydra evaluator UI verification (Playwright/Puppeteer/Cypress as fallback only)
- QA skill added to evaluator skill set

### Fixed
- Browse CLI missing from Linux symlink registration (CLI_NAMES)

## [0.23.0] - 2026-04-02

### Added
- Claude Code headless driver via stream-json protocol
- AgentRenderer component suite with theme, status bar, error handling, and auto-scroll
- Agent output rendered inside TerminalTile on canvas
- Slash command autocomplete in agent input box
- Instant slash command loading via filesystem scan
- Session resume across app restarts
- Streaming event coverage for agent messages
- Smooth LERP zoom on Cmd+scroll

### Fixed
- IME composition guard for agent input
- Agent mousedown propagation and canvas event isolation (nopan/nodrag/nowheel)
- IPC key separated from Claude Code session ID
- Non-blocking agent start with ref-stable event subscription
- Canvas zoom broken by undefined constant reference

## [0.22.0] - 2026-04-02

### Added
- Auto-compact worktrees after user opts in via Cmd+Shift+G

### Fixed
- Toolbar workspace name overlapping control buttons on narrow windows

## [0.21.0] - 2026-04-02

### Added
- Hook-first agent observation: push-based telemetry replaces 2s polling as primary state source
- Hook script hardening: 10s timeout, single retry on connection failure, error logging to tmpdir
- HookReceiver health metrics (eventsReceived, parseErrors, lastEventAt) exposed via IPC
- Hook-based CLI type upgrade: shell terminals auto-detected as Claude via SessionStart hook
- Event-driven auto-summary triggered on turn completion instead of 10-minute scan
- Missed hook event detection via pendingPreToolUse tracking with console warnings
- Adaptive telemetry polling: 5s fast fallback when push events go silent, 30s when healthy

### Fixed
- foreground_tool guard uses semantic pendingPreToolUse flag instead of 5s time window
- Stale pendingPreToolUse auto-resets after 5 minutes when CC crashes without PostToolUse
- Turn completion deduplication prevents double-firing from session watcher and hook listener
- Process polling reduced from 3s to 15s; session file polling from 2s to 10s
- SessionWatcher fallback polling relaxed to 60s delay / 30s interval

## [0.20.0] - 2026-04-02

### Added
- SuperHydra P0/P1 agent runtime with filesystem tools, model registry, cost tracking, compaction, o-series adaptation, streaming, fallback model, tool hooks, context injection, and session persistence
- API key encryption at rest via Electron safeStorage
- Approval bridge with policy-based auto-approve and escalation
- JSONL session persistence with append-only transcript and resume
- Composable pre/post tool hooks with permission decisions
- Fallback model and max_output_tokens recovery with progressive retry
- OpenAI o-series adaptation with max_completion_tokens, developer role, reasoning_effort
- Auto-compaction with circuit breaker
- Cost/budget tracking with per-turn USD calculation
- Error categorization and loop-level retry
- Static model capability registry
- ReadFile, GlobFile, GrepFile read-only filesystem tools for agent
- Async/background tool execution with pending task registry
- Structured coordinator system prompt builder
- Challenge skill
- Hydra telemetry enrichment and retry for agent watch
- Hydra watch support for spawned agents

### Fixed
- Network errors classified as retryable; compaction same-size loop guarded
- 5 agent review-round bugs: cost model, approval crash, callback imbalance, stale context, dead code
- currentModel passed to provider.stream() so fallback model switch takes effect
- Consecutive same-role messages merged in Anthropic conversion
- Synchronous settled flag for pending task detection
- Provider-level retry removed to eliminate double retry
- HTTP 413 categorized as prompt_too_long
- termcanvas-hook.mjs moved to skills/scripts/ to match registered path
- Hydra spawn uses hydra list instead of hydra watch

## [0.19.0] - 2026-04-02

### Added
- Smooth stepless zoom and pan with lerp interpolation for fluid canvas navigation
- OpenAI-compatible provider and provider preset definitions for agent runtime
- Agent session isolation, horizontal tab bar, stop button, and auto-scroll active tab
- IPC handlers, preload bridge, and AgentService for main-process agent runtime
- Summarizing indicator in terminal title bar
- CC hook-based lifecycle monitoring pipeline with StopFailure API error detection
- Versioned manifest for skill lifecycle management
- Scrollback buffer increased from 5k to 50k lines

### Fixed
- Stashed terminals excluded from keyboard focus cycle and panToTerminal layout
- Native select replaced with custom dropdown for provider picker
- Hub pointer events passed through container to terminal below
- Collapsed hub dropdown no longer blocks terminal title bars
- Text cursor wildcard selector reverted to fix cursor override
- Stale customTitle cleared when session changes
- Summary OAuth auth fixed by replacing --bare with --no-session-persistence
- Socket bind awaited and fallback timer stored on hook runtime
- cleanupOldHydraSymlinks no longer deletes newly-created hydra symlink

### Changed
- Agent migrated to unified provider config model

## [0.18.0] - 2026-04-01

### Added
- Agent runtime: BYOK orchestration engine based on async generator loop with streaming tool_use cycle
- Anthropic BYOK provider with streaming, retry, and abort support
- 9 TermCanvas orchestration tools: CanvasState, Diff, Telemetry, ProjectManage, WorktreeManage, TerminalManage, HydraWorkflow, HydraAgent, BrowseAction
- HTTP client for tools with 3-tier connection resolution and exponential backoff retry
- Floating agent bubble UI: collapsible chat panel with drag, 8-direction resize, ESC to close
- Agent bubble Zustand store for message and task state management
- Terminal auto-summary: AI-generated one-line summaries with session resume and locale-aware prompts

### Fixed
- Auto-summary: skip Hydra sub-agent terminals, increase interval to 10min, skip already-summarized
- Terminal: focus terminal after file drop from file tree

## [0.17.1] - 2026-04-01

### Fixed
- Text selection in terminal top-left area: xterm v6 scroll shadow overlays intercepted mouse events, and mousedown bubbled to Canvas pan handler

## [0.17.0] - 2026-04-01

### Added
- Terminal stash box: park running terminals and restore them later with PTY kept alive
- Drag-to-stash: drag a terminal past its worktree boundary to stash it
- Right-click context menu "Stash" action on terminal tiles
- StashBox panel (bottom-right) to manage stashed terminals
- Browse tool: headless Chromium sub-package with CLI client and HTTP daemon
- Browse commands: navigation, interaction, screenshots, snapshots, cookies
- QA skill for browser-based testing workflows
- File tree watcher: per-directory fs.watch with IPC bridge
- Rescan watched directories on window focus
- Investigate, security-audit, and code-review skills

### Improved
- CLI type detection runs on fixed 1-second interval instead of 3-second idle debounce, no longer blocked by active output
- Stashed terminals stay in worktree with TerminalRuntimeHandle mounted (same as collapse), preventing PTY interruption
- Remaining terminals reflow when a sibling is stashed

### Fixed
- xterm v6 text cursor override
- Canvas willChange hit-test offset during animation
- Keyboard Backspace terminal delete now requires confirmation
- React state updater side effect in file tree hook
- xterm scrollToBottom crash on disposed instance during restore

## [0.16.14] - 2026-03-31

### Added
- Detect Codex bypass state (approval_policy + sandbox_policy) from session JSONL

### Improved
- Scan JSONL backwards in 64KB chunks (up to 512KB) instead of fixed tail read

## [0.16.13] - 2026-03-30

### Fixed
- Read Claude permissionMode from session JSONL to persist bypass permissions across restarts
- Refresh Claude sessionId and permissionMode before save to capture /resume switches

## [0.16.11] - 2026-03-30

### Fixed
- Persist CLI auto-approve flag (e.g. --dangerously-skip-permissions) across app restarts

### Improved
- Stagger non-focused PTY spawns on restore to reduce fork storm

## [0.16.10] - 2026-03-30

### Added
- Click collapsed sidebar to expand, with hover highlight
- Enable autoplay on welcome overlay

## [0.16.9] - 2026-03-30

### Fixed
- Minimized terminal tile showing xterm content over header instead of title bar with restore button

## [0.16.8] - 2026-03-30

### Fixed
- Resolve worktree overlaps when tile dimensions change (window resize, sidebar drag)

## [0.16.7] - 2026-03-30

### Added
- "Don't remind" option in Hydra setup popup to suppress per-project prompts for the session

## [0.16.6] - 2026-03-30

### Added
- Agent terminal freeze during sidebar drag — xterm stays frozen at pre-drag size with zero PTY resize, zero flicker; commits one fit on drag-end
- Buffer snapshot and reflow engine for agent terminals

### Fixed
- Skip redundant focus dispatch in panToTerminal when terminal is already focused
- Account for left panel inset in canvas coordinate transforms (box select, family tree overlay, viewport calculations)

## [0.16.5] - 2026-03-30

### Fixed
- Left panel resize handle sticking after pointer capture loss

## [0.16.4] - 2026-03-30

### Added
- Dynamic terminal tile aspect ratio based on available viewport size
- Manual check-for-updates button in settings

### Fixed
- Skip collapsed/minimized terminals in focus navigation
- Prepend space before dropped file path in PTY input
- Destroy orphaned PTYs on renderer reload to prevent FD leak
- Recompute terminal position on focus to avoid stale geometry after sidebar resize
- Improve markdown preview readability and visual hierarchy

## [0.16.3] - 2026-03-29

### Fixed
- Kill process group before removing PTY instance on resize error
- Restrict token and device-id file permissions to owner-only
- Resolve theme-related visual issues across multiple components
- Add 8px inset to terminal tiles within worktree containers
- Remove selection outline from terminal tiles
- Do not trigger onOpenFile when deselecting a memory graph node
- Register welcome drag listeners on step 4 instead of step 3
- Add try/catch to login() to prevent permanent loginPending lock
- Remove terminal tile border classes and inner padding
- Remove terminal tile border and light-only box-shadow
- Deduplicate SessionStart hook by script name to prevent dev/prod double registration
- Account for left sidebar in viewport centering calculations

## [0.16.2] - 2026-03-29

### Fixed
- Left panel tabs collapse to icons only when panel width is narrow, preventing text wrapping to two lines

## [0.16.1] - 2026-03-29

### Fixed
- Memory SessionStart hook now registered in Claude Code settings.json with absolute path (plugin hooks.json alone was not loaded by Claude Code)

## [0.16.0] - 2026-03-29

### Added
- Memory enhancement plugin: SessionStart hook injects explicit references and time-sensitive warnings into Claude Code context
- Enhanced memory index generator: extracts cross-file markdown links and expired date detection
- `GET /api/memory/index` API endpoint for hook integration
- Memory Graph navigation skill: instructs agent to follow references and verify stale memories
- Auto-enable TermCanvas plugin in Claude Code settings.json on startup (required for hooks)
- OS file drop into project file tree with drag-and-drop copy
- Auto-expand collapsed left panel and directories on OS file drag hover

### Fixed
- Hook script reads both dev/prod port files and bypasses proxy for localhost
- Shell injection in hook script prevented via stdin parameter passing
- Render loop no longer rebuilds on hover/select state changes (uses refs)
- MEMORY.md read and watch callback exceptions caught to prevent main process crash
- Regex lastIndex reset between nodes in date expiry detection
- Worktree root directory no longer exposed to rename/delete in file tree context menu
- Path traversal in rename/mkdir/createFile blocked by basename validation
- Windows backslash and drive letter paths handled in memory directory derivation
- PreviewContent saveAndExit no longer gets stuck on write failure
- Dead `memory:read-file` IPC removed, CSS variables cached to avoid per-frame getComputedStyle

## [0.15.1] - 2026-03-29

### Fixed
- Memory graph background now matches panel surface color instead of being too dark
- Tooltip opacity rendering fixed for Tailwind v4 compatibility

## [0.15.0] - 2026-03-29

### Added
- Memory tab in left panel: visualize Claude Code memory files as a force-directed knowledge graph
- Graph features: theme-aware colors, multi-level emphasis on hover/select, glow effects, arrow edges, hover tooltip
- Live memory graph updates via fs.watch when memory files change
- Click memory node to open in Preview tab
- Click-to-edit for all text/markdown files in Preview (auto-save on blur, ⌘S save, Esc cancel)
- General `fs:writeFile` IPC with content comparison to avoid unnecessary writes

### Fixed
- Preview close now returns to originating tab (Memory or Files) instead of always Files
- Canvas resize flicker eliminated by deferring resize to render loop
- File writes skip when content unchanged, preserving mtime for accurate freshness signals

## [0.14.0] - 2026-03-28

### Added
- Headless runtime: Electron-free Node.js runtime enabling Hydra to run inside cloud VMs (project-store, api-server, heartbeat, artifact-collector)
- Dynamic panel-aware centering: focused terminals stay centered between both panels regardless of panel state
- Real-time re-center during left panel resize drag
- Left panel markdown preview with source toggle
- Hydra setup popup replacing inline banner
- Persistent Hydra status banner replacing transient toast
- Auto-check Hydra toolchain status on project focus
- Hydra sub-agents default to auto-approve

### Fixed
- Viewport scale calculation now accounts for left panel width, preventing terminal occlusion
- Panel resize re-center uses immediate viewport update for smooth tracking
- Suppress stale copied toast on terminal remount
- Prevent selection jump when mouse re-enters terminal during zoom

## [0.13.0] - 2026-03-28

### Added
- Hydra plan approval gate: `--approve-plan` flag pauses workflow after planner for user review
- `hydra approve` command to continue approved plans to implementation
- `hydra revise --feedback "..."` command to re-run planner with structured feedback
- Human-in-the-loop plan cycle: user → main brain → planner → review → revise/approve → implement → evaluate

### Fixed
- Hydra requeue now only deletes done marker, preserving result.json for downstream agents (evaluator findings for implementer, old plan for revised planner)
- Git panel graph rail tightened to shift visual weight toward text

## [0.12.1] - 2026-03-27

### Fixed
- PTY leak: terminal destroy now sends SIGHUP to the entire process group instead of SIGTERM to the shell only, preventing orphaned Claude CLI and MCP server processes from accumulating and exhausting the system PTY limit
- Quota panel: show error state instead of hiding the section on fetch failure

## [0.12.0] - 2026-03-27

### Added
- Hydra planner: three-phase structure (investigate → constrain → plan) replacing direct task decomposition
- Hydra planner: domain-specific audit guides (frontend, backend, infra) loaded on demand
- Hydra evaluator: constraint and problem verification anchored to planner output
- Hydra evaluator: regression check dimension — verify git diff doesn't break existing functionality

### Changed
- Left panel: removed standalone preview tab (preview is reached by clicking a file, not a tab)
- Left panel: segmented tab bar with icons, collapsed icon strip, Hydra button relocated to git toolbar

### Fixed
- Left panel: git history scroll regression caused by missing flex height constraints in CollapsibleGroup

## [0.11.0] - 2026-03-27

### Added
- Hydra evaluator: structured `verification` field in result.json for tier-level reporting (runtime/build/probing/static)
- Hydra evaluator: domain-specific evaluation guides (frontend, backend, infra) loaded on demand
- Hydra workflow: telemetry-based early exit detection — retries within seconds instead of waiting for timeout
- Hydra workflow: eager terminal destruction after handoff completion to prevent PTY/process accumulation

### Changed
- Hydra evaluator prompt rewritten to focus on deep evaluation (intent alignment, stub detection, test quality, architectural fit) instead of just CI checks
- Hydra watch defaults increased to 30s poll interval and 1h timeout

### Fixed
- Hydra loop requeue: stale done/result files no longer cause infinite phantom completion cycles
- Hydra cleanup: now destroys terminals for all handoffs in a workflow, not just the current one

## [0.10.0] - 2026-03-27

### Added
- Git graph layout engine with tighter rail spacing for branch visualization
- Hydra evaluator upgraded from code reviewer to QA engineer with tiered verification strategy

### Fixed
- Terminal PTY spawn now retries on transient failures
- Git push/pull no longer hangs on auth prompts; stderr properly captured with 30s timeout
- Left panel (git, files, diff) no longer goes blank when clicking canvas background

## [0.9.1] - 2026-03-27

### Fixed
- Hydra: remove hardcoded codex default for implementer role, use flexible agent resolution chain
- Hydra: add agent characteristics (Claude vs Codex strengths) to hydra skill for provider selection guidance

## [0.9.0] - 2026-03-27

### Added
- Hydra orchestration system: task handoffs, workflow commands, planner-implementer-evaluator template
- Hydra telemetry truth layer with query APIs and UI advisory views
- Git panel in the left sidebar with staging, commit, push/pull, branch switching, and commit history
- One-click hydra project enable button
- CLI command routing to the active termcanvas instance
- Termcanvas router skill

### Changed
- Redesigned git sidebar panel layout and inspector
- Left panel resize now uses pointer capture for smoother interaction

### Fixed
- Git panel bottom dead space eliminated; history fills remaining space
- Diff line backgrounds extend to full scrollable width on horizontal scroll
- Commit detail panel no longer overlaps history items
- Terminal title controls visibility restored
- Terminal auto-copy focus regression resolved
- Worktree header actions no longer re-expand legacy nodes

## [0.8.57] - 2026-03-25

### Changed
- Simplified canvas interaction by removing DiffCard and FileTreeCard components

### Fixed
- Menu handler no longer depends on terminal state variable

## [0.8.56] - 2026-03-25

### Added
- Codex quota display in the usage panel

### Changed
- Reduced usage panel polling frequency
- Refined compact worktree sizing and visible worktree bounds for layout alignment


## [0.8.55] - 2026-03-24

### Fixed
- Restore the copied toast to a solid surface so it stays legible above the canvas
- Fix cascading worktree overlap reflow so neighboring worktrees keep a stable layout
- Align quoted wrapper command parsing so CLI launches resolve correctly

## [0.8.54] - 2026-03-24

### Fixed
- Installing a downloaded update now goes through the normal shutdown path so app cleanup runs before handing off to the updater
- Restart-to-install no longer gets stuck behind the unsaved-changes dialog, and canceling that dialog clears the pending restart intent safely

## [0.8.53] - 2026-03-24

### Fixed
- Restore CLI message color hierarchy in light mode so user prompts and AI responses remain visually distinct after a theme-triggered redraw

## [0.8.52] - 2026-03-24

### Performance
- Reduce renderer focus and snapshot churn during canvas interactions
- Cache usage heatmap results per session file to avoid repeated recomputation

### Fixed
- Defer and cancel queued xterm focus when switching terminals across projects so CLI focus no longer lags behind visual focus
- Keep empty worktrees expanded after removing their last terminal

## [0.8.51] - 2026-03-24

### Performance
- Reduce main-process stalls during usage session scans
- Defer usage heatmap loading until the heatmap section is visible, so opening the right panel no longer triggers a multi-second heatmap scan
- Avoid idle background stalls from hidden usage prefetch and repeated autosave backstop snapshots

### Fixed
- Improve hover card drag stability
- Keep related hover cards visible during drag

## [0.8.50] - 2026-03-24

### Changed
- macOS title bar now uses a more native three-part layout with centered workspace title and grouped controls
- Toolbar actions and zoom controls now share a more consistent visual grouping and spacing rhythm

### Fixed
- Electron production builds now externalize `adm-zip` correctly so release packaging does not fail during the main-process bundle step

## [0.8.49] - 2026-03-23

### Fixed
- Theme switches now notify running CLI terminals to redraw, reducing stale light/dark input box styling after a theme toggle
- New terminals inherit explicit theme hints in their PTY environment so CLI tools start with the correct light/dark context

## [0.8.48] - 2026-03-23

### Performance
- Convert worktree rescans from blocking sync git commands to async execution
- Skip no-op worktree sync updates to avoid unnecessary canvas rerenders

## [0.8.47] - 2026-03-23

### Changed
- Hydra polling interval now adapts based on task duration (short tasks poll faster)
- Reduced default Hydra polling frequency from 30s to 2 minutes

### Performance
- Convert quota-fetcher from execSync to async execFile/fetch
- Convert project:diff from execSync to async execFile

### Fixed
- Hydra skill set to alwaysApply so polling instructions are always loaded
- Hub spring animations, glass material, and position refinements

## [0.8.46] - 2026-03-23

### Added
- Terminal rename skill (`/termcanvas:rename`): AI generates a concise tab title from conversation context
- CLI `terminal set-title` command and `PUT /terminal/{id}/custom-title` API route
- Hub component for layered focus navigation across projects and worktrees
- Auto-collapse worktrees when their last terminal is removed

### Changed
- Skill distribution migrated from per-skill symlinks to Claude Code plugin system
- Removed Sidebar component in favor of Hub navigation
- Removed Hydra connection line overlay (parent-child navigation via HierarchyBadges)

### Fixed
- Improved text-muted contrast for better readability
- Windows: correct path joining for CLI artifacts

## [0.8.45] - 2026-03-23

### Fixed
- Usage panel: cache rate now uses local device data only, avoiding inaccurate mixed cloud/local percentages (#62)
- Usage panel: show all 24h time buckets for past dates (#61)
- Light sweep effect: improved visibility and fixed right-side trigger (#19)
- Preserve permission level (auto-approve) when restoring Claude sessions (#14)
- Hydra usage now attributed to spawning project instead of separate entry (#21)
- Windows: replace Unix `unzip` with cross-platform `adm-zip` for font downloads (#32)
- Windows: normalize Claude project keys for correct session matching (#63)
- Windows: use `pathToFileURL()` for valid file URLs when opening reports (#64)
- Windows: use junctions instead of symlinks for Hydra skill links (#66)

## [0.8.44] - 2026-03-23

### Fixed
- Usage panel: Codex cached tokens were double-counted in cost calculation — OpenAI's input_tokens includes cached_input_tokens, unlike Claude's API

## [0.8.43] - 2026-03-23

### Fixed
- Hydra connection lines hidden behind ProjectContainer
- Insights "Open Report" option lost after app restart — now scans for latest report on mount

## [0.8.42] - 2026-03-23

### Fixed
- Usage panel: cloud heatmap was not aggregating across devices due to missing polling retry and TokenHeatmap reading local-only data

## [0.8.41] - 2026-03-22

### Fixed
- Usage panel: server-side aggregation via Supabase RPC to avoid 1000-row query truncation
- Usage panel: content-based dedup (record_hash) replaces timestamp-based dedup to prevent same-second data loss
- Usage panel: per-day max merge for heatmap so incomplete cloud data doesn't overwrite local

### Changed
- Sidebar uses distinct background color for light and dark themes

## [0.8.40] - 2026-03-22

### Fixed
- Usage panel: merge local + cloud heatmap data so pre-login days appear in the heat map
- Usage panel: monthly total now includes local usage from before cloud sync
- Usage panel: daily summary (cost, sessions, tokens) uses the larger of cloud vs local to avoid data loss during backfill
- Usage panel: hourly activity chart merges cloud + local buckets for complete daily view

## [0.8.39] - 2026-03-22

### Fixed
- Auth: rewrite OAuth callback server with proper error handling, PKCE support, and 120s timeout
- Auth: surface Supabase error details instead of generic "Login failed" message
- Auth: handle EADDRINUSE when callback port is occupied
- Settings: prevent keyboard shortcuts list from overflowing the modal
- Theme: persist dark/light mode choice to localStorage across sessions
- Workspace: mark project dirty when renaming a terminal tab
- Drag & drop: quote file paths containing spaces or special characters

### Internationalization
- Canvas: internationalize empty state onboarding text (en/zh)
- Update modal: internationalize all UI strings (en/zh)

## [0.8.33] - 2026-03-22

### Fixed
- Insights: pipe long prompts via stdin to avoid E2BIG crash when analyzing 1000+ sessions
- Insights: early-reject codex_exec self-insight sessions during parsing to prevent snowball scanning

## [0.8.32] - 2026-03-22

### Fixed
- GitHub login callback now correctly updates user state and displays account name
- Expanded GitHub username extraction to cover more OAuth metadata fields

## [0.8.31] - 2026-03-22

### Added
- Insights V2: unified cross-CLI report analyzing both Claude Code and Codex sessions together
- Insights V2: time-decay tiers for session analysis (full/50%/25%/metrics-only by age)
- Insights V2: "Your Coding Story" section with achievement wall and AI-generated memorable moments
- Insights V2: time trends chart showing 14-day daily activity breakdown
- Insights V2: tool comparison cards (Claude Code vs Codex side-by-side)
- Insights V2: automatic report language detection matching user's conversation language

### Changed
- Insights: removed hard caps on facet extraction and session loading for full coverage
- Insights: each analysis round now receives section-specific data slices instead of identical context
- Insights: satisfaction inference prompt now includes a concrete rubric instead of bare field name

### Fixed
- Insights: time-of-day heatmap now aggregates from all eligible sessions, not just facet-backed ones
- Insights: report header now shows three-stage counts (scanned/eligible/facet-backed) instead of misleading ratio
- Insights: compact mode button no longer locks into "open report" after generation, allowing re-generation
- Insights: success banner in full mode can now be dismissed

## [0.8.30] - 2026-03-21

### Changed
- Insights: extract richer per-session metrics from Claude and Codex logs, including tool usage, token usage, response timing, language signals, git activity, line deltas, and workflow feature flags
- Insights: upgrade report synthesis from freeform markdown blocks to structured analysis sections with actionable cards, copyable prompts, and partial-section resilience
- Insights: redesign the generated HTML report with a richer dashboard, time-of-day heatmap, stronger breakdowns, and explicit coverage/error visibility

### Fixed
- Insights: long sessions no longer collapse into a head-only transcript snippet, improving facet quality for multi-step runs
- Insights: analysis failures in one section no longer abort the whole report generation pipeline

## [0.8.29] - 2026-03-21

### Changed
- macOS auto-update no longer requires Apple Developer code signing certificate
- Custom updater downloads ZIP from GitHub Releases, verifies SHA-512, and replaces the .app bundle
- Downloaded updates persist across app restarts; auto-install on quit
- Download retry with exponential backoff (up to 3 retries)
- Install script backs up old .app and restores on failure

### Fixed
- macOS auto-update failing with "Code signature did not pass validation"

## [0.8.28] - 2026-03-21

### Changed
- Insights: generate reports per selected CLI instead of mixing Claude and Codex sessions in one run
- Insights: freeze each run's session set, add bounded uncached processing, and surface analyzed/scanned/cache coverage in the HTML report

### Fixed
- Insights: avoid cross-run progress event bleed by isolating jobs with a per-run job id and single-job guard
- Insights: reuse session metadata and facet caches with source fingerprints so stale or mismatched cache entries are not silently reused
- Insights: package report generation code into the desktop build so packaged releases can finish generating insights reports

## [0.8.27] - 2026-03-21

### Added
- Supabase backend: GitHub OAuth login and cross-device usage sync
- Incremental usage sync every 5 minutes when logged in
- One-time history backfill on first login

### Security
- Disable email signup, GitHub OAuth only
- Row-level security on usage_records table

### Fixed
- Dev and production instances on the same machine no longer double-count usage

## [0.8.26] - 2026-03-21

### Changed
- Performance: batch PTY output into 8ms frames to reduce IPC flooding with many terminals
- Performance: cull off-screen projects via content-visibility to skip rendering work
- Performance: pool WebGL contexts (max 8) with LRU eviction to stay under browser limits

## [0.8.25] - 2026-03-21

### Added
- Shortcuts: `Cmd+/` to toggle right panel, `Cmd+F` to star/unstar focused terminal, `Cmd+J`/`Cmd+K` to cycle starred terminals
- Settings: all shortcuts now configurable in settings panel (added save, save-as, close, star, starred nav)
- Settings: continuous minimum contrast ratio slider (1–7) for terminal text readability

### Fixed
- Light mode: ANSI black text nearly invisible against light background
- Light mode: cyan and blue ANSI colors too faint for readability
- Light mode: truecolor text (e.g. Claude Code links/hashes) enforced via xterm.js minimumContrastRatio

## [0.8.24] - 2026-03-21

### Added
- Usage panel: real-time Claude Code quota display showing 5-hour and 7-day rate limit utilization with adaptive polling driven by local usage activity

## [0.8.23] - 2026-03-21

### Changed
- Hydra: skill docs now explicitly document `kimi` support and clarify that `--auto-approve` is ignored for Kimi agents

### Fixed
- Hydra/Kimi: launch initial sub-agent tasks with Kimi's required `--prompt` flag so spawned Kimi terminals actually receive the task
- Terminal: when composer is off, `Cmd+;` / `Ctrl+;` now focuses the terminal and opens the inline custom title editor instead of falling back to a detached prompt flow

## [0.8.22] - 2026-03-21

### Changed
- Fonts: downloadable font sources now use pinned GitHub release archives instead of the old Google Fonts ZIP endpoints
- Fonts: temporarily limit bundled download choices to verified archives (JetBrains Mono, Fira Code, IBM Plex Mono, Hack) until the removed sources are fixed

### Fixed
- Fonts: follow HTTP redirects and download archives through Node `https`, fixing font installs that were failing in both dev mode and packaged builds

## [0.8.21] - 2026-03-21

### Added
- Settings: Agents tab with auto-detect, manual CLI path override, and Validate button for claude/codex/kimi/gemini/opencode
- Settings: CLI command configuration persisted in preferences (cliCommands)
- IPC: cli:validate-command resolves executable path and reports version
- Terminal: actionable error message when agent CLI is not found, pointing to Settings > Agents
- Settings: drawing tools toggle (default off)
- Usage: monthly cost total in usage panel

### Changed
- Terminal: getTerminalLaunchOptions accepts optional cliOverride from user preferences
- Settings: modal state extracted to zustand store, openable from any component to a specific tab
- PTY: structured PtyLaunchError with code and command fields

### Fixed
- Font download button unresponsive due to disabled parent element
- Composer: default to off, marked as experimental
- i18n: corrected Chinese terminal title placeholder and composer rename prompts

## [0.8.20] - 2026-03-20

### Added
- Onboarding: interactive mini canvas tutorial with double-click focus, Cmd+E toggle (focus/fit-all), Cmd+]/[ terminal switching, and scroll zoom/drag pan steps
- Onboarding: all navigation shortcuts work across all tutorial steps, matching real app behavior
- Toolbar: tutorial button to reopen onboarding anytime
- Save: auto-save with dirty tracking, workspace file persistence, and dirty-aware title bar
- Save: Cmd+S / Cmd+Shift+S shortcuts for save and save-as

### Changed
- PTY: graceful shutdown with SIGTERM → 5s timeout → SIGKILL
- State: atomic state.json writes via tmp+rename
- Theme: revert completion glow theme changes

### Fixed
- Theme: disable allowTransparency to fix text fringing
- Theme: darken bright ANSI colors and terminal text for light mode readability
- Electron: isolate dev instance data directory and skip single-instance lock in dev mode
- Composer: rename terminal markers from composer

## [0.8.19] - 2026-03-20

### Fixed
- Theme: soften light mode terminal foreground for reverse video readability
- Fonts: show error notification when font download fails

### Changed
- Theme: redesign light mode with warm stone-toned palette and reduced brightness

## [0.8.18] - 2026-03-20

### Added
- Settings: terminal font selection with 10 curated monospace fonts (Geist Mono, Geist Pixel Square, JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono, Inconsolata, Cascadia Code, Hack, Victor Mono)
- One-click font download for non-bundled fonts, stored in app data directory
- Real-time font switching across all terminal instances

## [0.8.17] - 2026-03-20

### Fixed
- Composer: prevent Enter from selecting slash command without explicit arrow-key navigation, fixing accidental command selection when submitting partial input

## [0.8.16] - 2026-03-20

### Fixed
- Terminal: remove manual scroll management that overrode xterm v6 built-in scroll-pinning, fixing viewport snapping to bottom during AI streaming output

## [0.8.15] - 2026-03-20

### Fixed
- Composer: per-terminal paste strategy so image+text submissions work correctly for both Claude Code and Codex

## [0.8.14] - 2026-03-20

### Fixed
- Composer: send each bracketed paste as a separate pty write so image paths and text are recognised as distinct inputs
- Composer: route all terminal types through Composer for input focus
- Terminal: use xterm v6 onScroll API for scroll-pinning instead of viewport DOM events

## [0.8.13] - 2026-03-20

### Fixed
- Terminal: rewrite scroll-pinning to use input events (wheel/keydown) instead of scroll events, fixing viewport not following output during AI streaming
- Terminal: fix Cmd+Backspace referencing undeclared variable
- Composer: send all bracketed pastes in a single write to eliminate race condition

## [0.8.12] - 2026-03-20

### Fixed
- Composer: restore fixed paste delay to fix image not recognized when sent with text

## [0.8.11] - 2026-03-20

### Fixed
- PTY: debounce output gate so submit key is sent after CLI finishes rendering, not on first output chunk
- Keyboard: auto-focus first worktree after adding a new project via Cmd+O
- Keyboard: auto-focus and zoom to new terminal after Cmd+T
- Keyboard: preserve worktree focus after closing the last terminal with Cmd+D
- Composer: forward backspace to terminal when input is empty

## [0.8.10] - 2026-03-19

### Fixed
- Terminal: fix scroll snapping back to bottom during AI thinking/streaming when user scrolls up

## [0.8.9] - 2026-03-19

### Fixed
- Composer: replace fixed paste delay with output-gated submit to prevent Enter from being swallowed

## [0.8.8] - 2026-03-19

### Fixed
- Keyboard: auto-focus first worktree after adding a new project via Cmd+O
- Keyboard: auto-focus and zoom to new terminal after Cmd+T
- Keyboard: preserve worktree focus after closing the last terminal with Cmd+D

## [0.8.7] - 2026-03-19

### Fixed
- Hydra: use resultFile as primary completion signal instead of relying solely on terminal status
- Hydra: distinguish explicit permission prompts from idle prompts to prevent false stall detection

## [0.8.6] - 2026-03-19

### Fixed
- Composer: restore delay between bracketed paste and Enter key
- Usage panel: include cache creation tokens in cache hit rate denominator

## [0.8.5] - 2026-03-19

### Added
- Composer: drag-and-drop support for files and images
- Usage panel: cache rate section in right panel
- Shortcuts: Cmd+D to close focused terminal
- Updater: error state UI with retry button in update modal

### Fixed
- Composer: add delay before submit when images are attached
- Composer: clean up staged image temp files on each new submit
- Composer: correct paste+submit write coalescing
- Hydra: auto-unblock stalled sub-agents during poll cycles

## [0.8.4] - 2026-03-19

### Fixed
- Browser card: improve webview compatibility — add persistent session, allowpopups, sanitize User-Agent, handle new-window and load errors
- Usage panel: filter out synthetic and unknown model entries from stats

### Changed
- Shortcuts: show keyboard hints on-demand instead of always visible

## [0.8.3] - 2026-03-19

### Added
- Composer: add /skills slash command for Claude and Codex
- Sidebar: unified Figma-style collapsible panels

### Fixed
- Hydra: add concrete permission self-check before spawning sub-agents
- Composer: prevent slash command menu from reopening after dismiss
- Composer: match Codex /skills description to actual CLI
- Drawing panel: prevent panel from being hidden by composer and escaping viewport
- Usage panel: align heatmap with GitHub contribution graph style
- Usage panel: prevent tooltip clipping

## [0.8.2] - 2026-03-19

### Fixed
- Usage panel: batch heatmap data collection into single file scan (91 IPC calls → 1), fixing app freeze when opening usage panel

## [0.8.1] - 2026-03-19

### Fixed
- Drawing panel: constrain drag to viewport bounds, preventing panel from being dragged off-screen
- Composer: fix slash command selection resetting to first item on every keystroke
- Cmd+O: center newly created project in current viewport instead of top-left
- Usage panel: fix hover tooltip positioning (translateX offset) and i18n for heatmap tokens label
- Usage panel: remove dead code (unused dayOfMonth field and tooltipRef)

### Added
- Usage panel: GitHub-style token heatmap calendar showing daily usage over 91 days

## [0.8.0] - 2026-03-19

### Added
- Composer: slash command autocomplete — type `/` to see available commands for the focused terminal's agent type (Claude, Codex)
- Usage panel: interactive date navigation with mini calendar popup, days with data show dot indicators
- Usage panel: enhanced hover states with floating tooltips on sparkline bars, token breakdown, projects, and models
- Usage panel: micro-animations — section fade-in, sparkline bar growth, cost count-up transitions
- Hierarchy: parent-child terminal visualization with SVG bezier connection lines on the canvas
- Hierarchy: terminal badges showing parent/child relationships with click-to-pan navigation
- Hierarchy: hover-to-reveal family tree overlay showing full agent hierarchy
- Hierarchy: `TERMCANVAS_TERMINAL_ID` env var injected into PTY for Hydra auto-detection
- Focus: tree-aware Cmd+[] cycling — DFS pre-order traversal groups parents with their children

### Changed
- Usage panel: larger 24px cost display, inset dividers, improved spacing rhythm

## [0.7.23] - 2026-03-19

### Fixed
- Session watcher: return success/failure from watch() instead of void
- Session: surface watch failures and poll timeouts to the user
- Persistence: log errors in state load/restore instead of silently swallowing
- Session watcher: match Claude CLI projectKey algorithm for paths containing dots
- Terminal: use onScroll as single source of truth for follow-bottom

### Changed
- Demo: rewrite ASCII logo to canvas text rendering for 120fps with true-color gradients

## [0.7.22] - 2026-03-18

### Fixed
- Session capture: use actual CLI process PID for auto-detected terminals, fixing completion glow never appearing
- Session watcher: support detecting multiple turn completions per session
- Session watcher: increase JSONL tail read size from 4KB to 128KB for longer sessions

## [0.7.21] - 2026-03-18

### Changed
- Composer bar: halved vertical footprint, send button moved inside input, notes replaced with placeholder text

## [0.7.20] - 2026-03-18

### Added
- Terminal font size setting in Settings (9–24px slider)
- Non-intrusive update indicator in toolbar with status icons (checking, downloading, ready, error)
- Keyboard shortcuts (Cmd+[/]) now auto-focus the Composer

### Fixed
- Usage pricing: Haiku 4.5 updated from stale 3.5 prices, cache writes split into 5m/1h tiers
- Usage stats: recursive JSONL scan captures subagent sessions, correct project path extraction
- Update modal: fixed transparent background and restart not working on macOS
- Terminal origin indicator moved from border to title bar dot, no longer conflicts with hover/focus

### Changed
- Update flow: silent background download, toolbar indicator replaces intrusive popup modal

## [0.7.19] - 2026-03-18

### Fixed
- Terminal scroll position no longer drifts upward during streaming output when user has scrolled up to read earlier content
- Replaced ResizeObserver-driven fitAddon.fit() with React state-driven fitting to prevent xterm resize/reflow from nudging viewport position

## [0.7.18] - 2026-03-18

### Added
- Auto-update: the app now checks for updates automatically and prompts to install
- Changelog displayed in update dialog with markdown rendering
- Gold border on user-created terminals to distinguish from agent-spawned ones
- Cmd+Arrow keys in Composer forward to CLI for history/cursor navigation
- Empty Enter in Composer passes through to CLI for confirming prompts

### Fixed
- Composer now uses bracketed paste for Claude Code, eliminating clipboard race conditions
- Re-entrancy guard in Composer prevents double submission
- Delay between bracketed paste and Enter key so CLI processes input before submission

### Changed
- All AI CLI terminals (Claude, Codex, Kimi, Gemini, OpenCode) migrated from clipboard paste to bracketed paste
