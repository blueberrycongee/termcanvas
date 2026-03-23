# Hydra Review Result — PR #47 & PR #46

## PR #47 — fix: handle Windows backslash paths in session-watcher

**判断：打回**

### 问题分析

变更位于 `electron/session-watcher.ts:91`，将 `cwd.replaceAll(/[/.]/g, "-")` 改为 `cwd.replaceAll(/[/\\.:-]/g, "-")`。

**1. 未验证 Claude CLI 的实际行为**

这是最致命的问题。`projectKey` 必须与 Claude CLI 在 `~/.claude/projects/` 下生成的目录名**完全一致**，否则 session 文件找不到，功能静默失效。

我检查了本机 `~/.claude/projects/` 下的实际目录名，发现 Claude CLI 的转换规则**不止替换 `/` 和 `.`**。例如路径中的 `__`（双下划线）在目录名中变成了 `--`（双连字符），说明 `_` 也被替换了。这意味着：

- 现有代码 `[/.]` 在某些 edge case 下已经是错的
- PR #47 加了 `\` 和 `:`，但没加 `_`，依然可能是错的
- 没有人去读 Claude CLI 的源码确认完整规则

**在没有查证 Claude CLI 源码的情况下猜测正则，就是在赌。** 赌对了省事，赌错了 Windows 用户的 session watching 全部静默失败，没有任何错误提示。

**2. `-` 在字符集中是多余的**

`[/\\.:-]` 中的 `-` 替换为 `-`，是 no-op。不影响正确性，但说明作者没有仔细思考。

**3. 没有测试**

没有单元测试验证转换结果与 Claude CLI 的实际输出一致。这类"必须与外部系统精确匹配"的逻辑最需要测试。

### 修复建议

1. 去读 Claude CLI 的源码，找到它生成 project key 的确切逻辑
2. 或者更好：直接扫描 `~/.claude/projects/` 目录，用前缀匹配找到对应的 project 目录，而不是自己重新实现转换逻辑
3. 加测试

---

## PR #46 — fix: use shell.openPath for cross-platform file opening

**判断：有条件合并（需补充错误处理）**

### 正确的部分

变更位于 `electron/main.ts:691-692`，将 `shell.openExternal(\`file://${filePath}\`)` 替换为 `shell.openPath(filePath)`。

方向是对的：
- `shell.openPath` 是 Electron 打开本地文件的正确 API
- `shell.openExternal` 搭配 `file://` 协议在 Windows 上遇到路径中有空格或特殊字符时会出问题
- 跨平台兼容性确实更好

### 需要修复的问题

**1. 错误被静默吞掉**

`shell.openPath` 返回 `Promise<string>`，成功时返回空字符串，失败时返回错误信息。当前代码：

```ts
ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    await shell.openPath(filePath);  // 错误信息被丢弃
});
```

应改为：

```ts
ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    const error = await shell.openPath(filePath);
    if (error) {
        console.error(`[insights] Failed to open report: ${error}`);
    }
});
```

**2. 路径未校验（预存问题，非本 PR 引入）**

`filePath` 从 renderer 进程传入，无任何校验。虽然追溯调用链发现 `reportPath` 最初由 main 进程的 `insights-engine.ts` 生成（`generateReport` 返回），经 renderer 中转后再传回，但一个被攻破的 renderer 进程可以发送任意路径。`shell.openPath` 会用系统默认程序打开该路径——包括可执行文件。

这是预存的安全问题，不是本 PR 引入的（`shell.openExternal` + `file://` 同样有此风险），但值得记录为后续改进项。理想做法是验证路径在预期目录内（如 `app.getPath('userData')`）。

### 结论

核心改动是正确且有价值的。补上错误处理（一行代码的事）即可合并。安全问题建议单独 issue 跟踪。

---

## Summary

| PR | Verdict | Reason |
|----|---------|--------|
| #47 session-watcher regex | **打回** | 未验证 Claude CLI 实际行为，正则是猜的，静默失败风险高 |
| #46 shell.openPath | **有条件合并** | 方向正确，需补 `shell.openPath` 返回值检查 |

## Files Changed
- `.hydra-result-hydra-09119ce824be88ef.md` — review result (this file)

## Issues Found
1. PR #47: projectKey regex is speculative, not verified against Claude CLI source
2. PR #47: existing regex `[/.]` already doesn't match CLI behavior (underscore handling)
3. PR #46: `shell.openPath` error silently discarded
4. PR #46 (pre-existing): no path validation on IPC handler

## Tests
- N/A (review-only task, no code changes)

## Unresolved Problems
- Claude CLI's exact project key algorithm is unknown; the existing code may already be wrong in edge cases
