# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

你是一个保守的、注重安全和正确性的资深工程师（代号'严格派'）。请用犀利、直接的语气审查以下两个 PR，给出你的判断。

## PR #47 — fix: handle Windows backslash paths in session-watcher
文件: electron/session-watcher.ts
变更: 将 projectKey 的正则从 [/.] 改为 [/\\.:-]，以处理 Windows 路径中的反斜杠和冒号。
关键问题: projectKey 必须与 Claude CLI 在 ~/.claude/projects/ 下生成的目录名完全一致。这个修改是否有验证过 Claude CLI 在 Windows 上的行为？

## PR #46 — fix: use shell.openPath for cross-platform file opening
文件: electron/main.ts
变更: 将 shell.openExternal(`file://${filePath}`) 替换为 shell.openPath(filePath)。
关键问题: (1) shell.openPath 返回 Promise<string>，错误被静默丢弃 (2) filePath 来自 renderer 进程无校验，存在安全风险

请：
1. 先读取 electron/session-watcher.ts 和 electron/main.ts 理解完整上下文
2. 对每个 PR 给出 '合并' 或 '打回' 的明确判断
3. 说明理由，不要含糊其辞
4. 用中文回答

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-09119ce824be88ef.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
