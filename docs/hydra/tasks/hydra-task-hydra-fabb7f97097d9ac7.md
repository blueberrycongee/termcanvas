# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

你的任务是验证一个 bug 假设。假设内容：在 electron/pty-launch.ts 中，captureLoginShellEnv() 使用 zsh -lc（非交互式 login shell），不会 source ~/.zshrc。因为 nvm 在 ~/.zshrc 中初始化，所以 PATH 缺少 nvm 路径，导致 claude（安装在 ~/.nvm/versions/node/v24.14.0/bin/claude）找不到。

请执行以下验证步骤：
1. 读取 electron/pty-launch.ts，理解 captureLoginShellEnv、parseNullDelimitedEnv、sanitizeEnv、mergePathValue、buildLaunchSpec 的完整流程
2. 读取 ~/.zshrc、~/.zprofile、~/.zshenv、~/.zlogin，确认哪些文件往 PATH 添加了什么
3. 运行 env -i HOME=/Users/zzzz USER=zzzz SHELL=/bin/zsh TERM=xterm-256color /bin/zsh -lc '/usr/bin/env -0' 2>/dev/null | tr '\0' '\n' | grep '^PATH=' 查看非交互式 login shell 的 PATH
4. 运行 env -i HOME=/Users/zzzz USER=zzzz SHELL=/bin/zsh TERM=xterm-256color /bin/zsh -lic '/usr/bin/env -0' 2>/dev/null | tr '\0' '\n' | grep '^PATH=' 查看交互式 login shell 的 PATH
5. 对比两个 PATH，确认 nvm 路径在哪个中存在/缺失
6. 确认 /Users/zzzz/.nvm/versions/node/v24.14.0/bin/claude 是否真实存在

返回结构化结论：CONFIRMED 或 REFUTED，附证据。用中文回复。

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-fabb7f97097d9ac7.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
