# Hydra Review Result — 实用派审查 PR #46 & #47

## 审查人视角

我是一个务实的工程师。我关心的是：这个改动能不能解决真实问题？有没有引入新问题？证据是否充分？

---

## PR #47 — fix: handle Windows backslash paths in session-watcher

**判断：打回**

### 变更分析

当前代码 (`electron/session-watcher.ts:91`):
```typescript
const projectKey = cwd.replaceAll(/[/.]/g, "-");
```

提议改为：
```typescript
const projectKey = cwd.replaceAll(/[/\\.:-]/g, "-");
```

新正则将 `/`、`\`、`.`、`:`、`-` 全部替换为 `-`。

### 理由

**1. 核心问题：没有验证 Claude CLI 的实际行为。**

`projectKey` 的用途是构建路径 `~/.claude/projects/{projectKey}/{sessionId}.jsonl`。这个目录是 **Claude CLI 创建的**，不是我们创建的。我们必须与 CLI 的命名逻辑 100% 一致，否则 session watcher 会静默失效——找不到文件，没有错误，用户完全不知道出了什么问题。

PR 描述中没有任何证据表明作者验证过 Claude CLI 在 Windows 上的 `projectKey` 生成逻辑。这不是"应该差不多"的问题——差一个字符就是完全不同的目录。

**2. 新正则把 `-` 也替换成 `-`，这是无害的但说明作者可能没仔细想过。**

`[/\\.:-]` 中的 `-` 在字符类末尾虽然不会导致语法错误（被当作字面量），但把 `-` 替换成 `-` 是无意义操作，暴露了"往里加字符看看行不行"的思路。

**3. 这个 app 目前是否在 Windows 上运行？**

这是一个 Electron 终端应用。如果没有 Windows 用户报告实际问题，这就是一个假设性修复。假设性修复 + 没有验证 = 引入 bug 的高风险。

### 怎么做才对

1. 在 Windows 上实际运行 Claude CLI，观察 `~/.claude/projects/` 下生成的目录名
2. 或者直接读 Claude CLI 的源码，找到 projectKey 的生成逻辑
3. 写一个单元测试，用 Windows 风格路径（`C:\Users\foo\project`）验证输出与 CLI 一致

---

## PR #46 — fix: use shell.openPath for cross-platform file opening

**判断：有条件合并（需要小改）**

### 变更分析

当前代码 (`electron/main.ts:691-693`):
```typescript
ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    await shell.openExternal(`file://${filePath}`);
});
```

提议改为：
```typescript
ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    await shell.openPath(filePath);
});
```

### 理由

**方向是对的。**

`shell.openExternal` + `file://` 在 Windows 上有已知问题：路径中的空格、中文字符、UNC 路径都可能出问题。`shell.openPath` 是 Electron 官方推荐的打开本地文件的 API，这个替换在语义上是正确的。

而且从安全角度看，`shell.openPath` 反而**更安全**——它只能打开本地文件，而 `shell.openExternal` 可以打开任意 URL（`http://`、`mailto:` 等）。所以这个改动实际上缩小了攻击面。

**但需要处理两个问题：**

**问题 1：错误被静默吞掉。**

`shell.openPath` 返回 `Promise<string>`，空字符串表示成功，非空字符串是错误消息。当前代码 `await` 了但没检查返回值。应该加上错误处理：

```typescript
ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    const error = await shell.openPath(filePath);
    if (error) {
        console.error(`[insights] failed to open report: ${error}`);
    }
});
```

这不是阻塞性问题（原来的 `shell.openExternal` 也没做错误处理），但既然动了这行代码，顺手加上是合理的。

**问题 2：filePath 未校验。**

`filePath` 来自 renderer 进程，没有任何校验。但说实话，这是**原有问题**，不是这个 PR 引入的。而且 `shell.openPath` 比 `shell.openExternal` 的攻击面更小（前面说了）。

如果要彻底修，可以校验 `filePath` 是否在预期目录下（比如 app 的 data 目录）：

```typescript
const expectedDir = path.join(app.getPath("userData"), "insights");
if (!filePath.startsWith(expectedDir)) {
    throw new Error("Invalid report path");
}
```

但这属于"改进"而非"修复"，不应该阻塞这个 PR。

### 合并条件

加上 `shell.openPath` 返回值的错误日志即可合并。路径校验建议作为后续 issue 跟踪。

---

## 总结

| PR | 判断 | 一句话理由 |
|----|------|-----------|
| #47 (Windows paths) | **打回** | projectKey 必须与 Claude CLI 完全一致，但没有验证证据 |
| #46 (shell.openPath) | **有条件合并** | 方向正确且更安全，加个错误日志就行 |

## Files Changed
- `.hydra-result-hydra-85270e77fbf76a15.md` — review result document (this file)

## Issues Found
- PR #47: Unverified assumption about Claude CLI's Windows path behavior — high risk of silent breakage
- PR #46: Minor — `shell.openPath` return value not checked (error silently discarded)
- PR #46: Pre-existing — `filePath` from renderer not validated (not introduced by this PR)

## Tests
- N/A — this is a review task, no code changes to test

## Unresolved Problems
- None — review complete
