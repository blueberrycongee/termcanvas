# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

你的任务是分析一个修复方案的安全性。修复方案：在 electron/pty-launch.ts 的 captureLoginShellEnv() 中，将 ['-lc', '/usr/bin/env -0'] 改为 ['-lic', '/usr/bin/env -0']（添加 -i 使 shell 变为交互式）。

请执行以下分析：
1. 完整读取 electron/pty-launch.ts，重点关注 parseNullDelimitedEnv() 和 captureLoginShellEnv()
2. 运行 env -i HOME=/Users/zzzz USER=zzzz SHELL=/bin/zsh TERM=xterm-256color /bin/zsh -lic '/usr/bin/env -0' 2>/dev/null | xxd | head -10 检查 stdout 是否有污染（.zshrc 是否在 env 输出前打印了东西）
3. 分析 parseNullDelimitedEnv 能否处理 env 输出前的垃圾文本（如果 .zshrc 打印了欢迎信息会怎样）
4. 检查 -lic 是否可能挂起（.zshrc 中是否有 read 命令或等待输入的逻辑）
5. 读取 ~/.zshrc 检查有无交互式提示、read 命令或可能导致问题的输出
6. 检查 execFile 是否设置了超时，交互式 shell 挂起时会怎样
7. 读取 tests/pty-launch.test.ts 检查是否有测试会被破坏

返回结构化安全报告：SAFE / UNSAFE / CONDITIONALLY SAFE，列出风险及严重级别（HIGH/MEDIUM/LOW），以及缓解建议。用中文回复。

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-b5cadd7fe17ab2f8.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
