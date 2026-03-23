# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

你的任务是搜索代码库中是否存在其他类似的 PATH 问题或相关的补救措施。

背景：从桌面（GUI）启动 TermCanvas 时，captureLoginShellEnv() 用 zsh -lc 获取环境变量，但因为不 source .zshrc，导致 nvm/bun 等工具的路径缺失。

请执行以下分析：
1. 搜索代码库中所有引用 PATH 的地方，看是否有其他 PATH 增强逻辑
2. 检查是否有 fallback 机制（比如在找不到可执行文件时尝试常见路径）
3. 检查 cliConfig.ts 中所有终端类型（claude, codex, kimi, gemini, opencode, lazygit, tmux）— 哪些会受到同样的 PATH 问题影响？
4. 检查 electron-builder.yml 和打包配置，看 claude 是否应该被打包到 app 中（还是纯粹依赖系统 PATH）
5. 搜索是否有类似 fix-path、shell-env、shell-path 等 npm 包被使用或曾经被使用
6. 检查 package.json 的依赖中是否有 shell 环境相关的包

返回完整的分析报告，列出所有受影响的终端类型和可能的其他 PATH 问题。用中文回复。

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-c28bab01827d056e.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
