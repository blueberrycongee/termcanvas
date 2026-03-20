# Hydra Review Result

## Files changed and why

- `.hydra-result-hydra-ea10db05dd18b7ff.md`: 记录本次对 `src/terminal/TerminalTile.tsx` 四次 scroll-pinning 修复演进的审查结论。

## Issues found

### 总结

这四次修复可以分成两类：

1. `9fd6689`、`9a75fd7`、`a32faa2` 都在尝试从“滚动事件/滚动位置”反推出 `followBottom`。
2. `18fd0dc` 改成从“用户输入意图”决定是否退出 auto-follow，再仅用 scroll 事件做“回到底部后的复位”。

我认为前三次属于同一类方案，只是在换事件源和补 guard；`18fd0dc` 才是模型层面的切换，因此它确实比前三次更接近根因。

### 1. `9fd6689` 做了什么，为什么失败

- 该提交把 `followBottom` 的真值来源改成 `xterm.onScroll()`，并加入 `programmaticScroll`，试图把 `scrollToBottom()` 造成的滚动与用户滚动区分开。
- 代码意图是：
  - 任意滚动后，根据 `buf.viewportY >= buf.baseY` 决定是否继续 follow。
  - 当本地代码调用 `scrollToBottom()` 时，用 `programmaticScroll` 跳过这次状态更新。
- 问题在于它选错了“观察点”。
  - `xterm.onScroll()` 更接近 buffer 级别变化，不足以可靠覆盖用户通过 viewport 产生的滚动。
  - 结果是用户向上读历史时，`followBottom` 可能根本没有及时变成 `false`，后续输出继续把视图拉回底部。
- 这次修复本质上仍在做“从滚动结果反推用户意图”，只是事件源换成了 `xterm.onScroll()`。

### 2. `9a75fd7` 做了什么，为什么失败

- 该提交承认 `xterm.onScroll()` 不够用，于是改监听 `.xterm-viewport` 的原生 `scroll` 事件。
- 同时把 guard 升级成 `programmaticScrollCount`，并用 `setTimeout(0)` 延后递减，试图覆盖异步 scroll dispatch。
- 这次确实比 `9fd6689` 更完整地捕获了 wheel、键盘、滚动条拖动等来源。
- 但它仍然把“scroll 事件本身”当作 `followBottom` 的单一事实来源，这就留下了同类问题：
  - 代码无法可靠区分“用户滚动”与“xterm / 本地 `scrollToBottom()` / streaming 输出造成的内部滚动”。
  - 在持续输出时，`programmaticScrollCount` 经常大于 0，用户真正的向上滚动也会被 guard 吞掉。
  - 结果是用户在 streaming 中想往上看历史，状态仍可能来不及切换，视图继续被拉回底部。

### 3. `a32faa2` 做了什么，为什么仍然不够

- 该提交修正了 `9a75fd7` 的一个具体 bug：
  - 以前只要 `programmaticScrollCount > 0` 就忽略 scroll。
  - 现在只在“位于底部且存在 programmatic scroll”时忽略；如果已经离开底部，则允许 `followBottom = false`。
- 这能解决一个真实问题：持续输出时，用户终于可以在某些时机把视图往上拉，不再被所有 scroll 事件一刀切吞掉。
- 但它仍没有脱离旧模型：
  - `followBottom` 还是从 scroll 结果推导，而不是从用户意图推导。
  - 只要 xterm 内部滚动、buffer/baseY 变化、DOM scroll dispatch 顺序出现偏差，仍可能把非用户滚动误判成“用户已经离开底部”，或者反过来错过真实用户滚动。
- 所以它修的是“guard 太粗暴”，不是“根因选错信号源”。

### 4. `18fd0dc` 是否 fundamentally different

是，属于根本不同的状态机。

- 旧方案：
  - 监听 scroll。
  - 再想办法用 `programmaticScroll*` 判断这次 scroll 到底是谁触发的。
  - 失败点是 scroll 本身已经混入了 xterm 内部行为，后续只能靠 guard 猜。
- 新方案：
  - 默认始终 follow。
  - 只有收到“用户明确向上读历史”的输入时，才把 `userScrolledUp = true`。
  - 输出到来时，只要 `userScrolledUp === false`，就直接 `scrollToBottom()`。
  - scroll 事件只负责一件事：用户已经在历史区时，如果后来回到底部，就把状态复位为 `false`。

这意味着：

- `follow` 的关闭不再依赖 scroll 事件，也不再依赖 `viewportY/baseY` 的瞬时关系。
- 因此，xterm streaming 期间自己的内部 auto-scroll、buffer 增长、DOM scroll 时序，不会再把“本来应该继续 follow”误判成“用户滚走了”。

如果原始 bug 是“Claude CLI streaming 时，用户没动，但终端自己停止 follow output”，那么 `18fd0dc` 相比前三次，确实更直接击中了根因。

### 5. `18fd0dc` 仍然存在的边界问题

我不认为它与前三次还是“同一类问题”；旧问题核心是被 scroll 事件污染，新方案基本绕开了这一点。  
但它仍然是启发式，不是完美解，至少还有这些边界：

1. 它不能识别“滚动条拖动向上”这种用户意图。
   - 当前只有 `wheel(deltaY < 0)` 和 `PageUp/Home` 会把 `userScrolledUp` 设为 `true`。
   - 如果用户直接拖 `.xterm-viewport` 的滚动条到上方，只会触发 `scroll`，而 `handleViewportScroll` 在 `userScrolledUp === false` 时直接返回。
   - 结果：这种情况下仍会继续 auto-follow，用户会被拉回底部。

2. 它把部分按键直接等同于“想读历史”，可能出现误报。
   - `Home` / `PageUp` 被无条件视为 scroll intent。
   - 但这些键也可能只是传给终端内应用本身，不一定真的让 viewport 向上滚。
   - 一旦误设 `userScrolledUp = true`，后续输出就不再自动跟随，直到某次 scroll 真正回到底部才恢复。

3. `wheel` 也不一定总等于 viewport scroll。
   - 在某些启用鼠标上报的 TUI / 全屏程序里，wheel 可能被应用消费，而不是实际滚动 terminal viewport。
   - 代码仍会把它当作“用户要读历史”，从而停掉 auto-follow。

4. 现在每次输出都会在 `!userScrolledUp` 时无条件调用 `scrollToBottom()`。
   - 这比旧版 `if (viewportY < baseY) scrollToBottom()` 更激进。
   - 正确性上问题不大，但会引入额外的滚动调用和潜在抖动/性能噪声，尤其在高频 streaming 时。

### 6. 结论

- `9fd6689`、`9a75fd7`、`a32faa2` 是同一路线：试图从 scroll 行为里反推出 follow 状态，因此反复陷入“事件源不纯”和“guard 时序”问题。
- `18fd0dc` 切换到了“显式用户意图驱动”的模型，这一点是实质性进步，也更像是在修根因。
- 但 `18fd0dc` 不是完整解：
  - 它修好了“用户没动却停止 follow”这一类问题。
  - 同时引入/保留了“只识别部分用户操作”的盲区，最明显的是滚动条拖动向上。
- 所以我的判断是：
  - **它不是前三次同类补丁的重复。**
  - **它大概率修到了原始 streaming bug 的根因。**
  - **但它仍有输入覆盖不全的问题，不能宣称 scroll-pinning 语义已经彻底完备。**

## Whether tests pass

- 未运行自动化测试。
- 这是一次历史审查任务，没有修改业务代码，仅新增结果文件。

## Unresolved problems

- `18fd0dc` 仍未覆盖“拖动滚动条向上”这类明确的用户读历史行为。
- `Home/PageUp/wheel` 被直接解释为读历史意图，可能对终端内应用产生误判。
