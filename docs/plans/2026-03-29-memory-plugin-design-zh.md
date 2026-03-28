# TermCanvas 记忆增强插件设计

## 定位

在 TermCanvas 现有插件（`termcanvas@termcanvas`）上增加 SessionStart hook，生成增强索引注入会话上下文。不替代 Claude Code 的记忆机制，补充它没有的信息。

## 设计原则

### 不替模型做判断（The Bitter Lesson）

Claude Code 的记忆本身不做分级、不做排序、不做重要性评估——全部平等地塞进上下文让模型自己判断。我们遵循同样的原则：**只提供客观事实，不做主观排序。**

具体来说：
- **做**：显式引用关系（记忆文件之间的 markdown 链接）、时间事实（某条记忆提到的日期已过去 14 天）
- **不做**：活跃度排序、重要性分级、召回频次展示、共现推测

### 只用显式信号，不做推测

**不做共现关系推断。** 同一 session 内被一起 Read ≠ 语义相关。一个 session 可能因为处理某个 bug 顺便读了完全无关的记忆文件。样本量小时一次偶然共读就会产生一条永久假关系，记忆文件少时几乎所有文件之间都会产生共现，关系图退化成完全图，信息量为零。

只展示 agent 自己在记忆文件中写的 `[text](other.md)` 显式引用——这是 agent 明确表达的关联，不会有假阳性。

### 缓存友好

注入内容越稳定，prompt cache 命中率越高。显式引用和时间预警都极少变化。

---

## 原本 vs 增强：对比

### 场景假设

一个真实项目，有 8 个记忆文件，用了两周。其中 `project_auth_rewrite.md` 的正文中引用了 `feedback_db_tests.md`。

### Claude Code 原本注入的内容

agent 每次会话开始看到的：

```
# auto memory

You have a persistent, file-based memory system at `/Users/zzzz/.claude/projects/-Users-zzzz-myproject/memory/`.

[... 200 行规则指令 ...]

Contents of /Users/zzzz/.claude/projects/-Users-zzzz-myproject/memory/MEMORY.md:

- [Auth rewrite reason](project_auth_rewrite.md) — legal/compliance drove the rewrite, not tech debt
- [DB test policy](feedback_db_tests.md) — integration tests must hit real DB, not mocks
- [API latency dashboard](reference_grafana.md) — grafana.internal/d/api-latency is oncall dashboard
- [User is senior backend](user_role.md) — deep Go expertise, new to React frontend
- [Merge freeze](project_merge_freeze.md) — freeze after 2026-03-15 for mobile release
- [Prefer bundled PRs](feedback_bundled_prs.md) — one bundled PR over many small ones for refactors
- [Linear INGEST project](reference_linear.md) — pipeline bugs tracked in Linear "INGEST"
- [No trailing summaries](feedback_terse.md) — user wants terse responses, no recap
```

**问题：**
- 扁平列表，无结构
- 不知道哪些记忆之间有关联（即使文件内部有引用）
- "Merge freeze 2026-03-15" 已经两周前过期了，但还排在列表里，无任何提示

### TermCanvas 增强后注入的内容

Claude Code 的 MEMORY.md 注入不变（上面那段还在）。我们的 SessionStart hook 额外注入：

```
<memory-graph source="termcanvas">

## References
- project_auth_rewrite.md → feedback_db_tests.md

## Time-sensitive
- project_merge_freeze.md — mentions date 2026-03-15 (>14d ago)

</memory-graph>
```

**增强了什么：**
1. **显式引用** — agent 看到 auth_rewrite 引用了 db_tests，读了一个可以顺着读另一个
2. **过时预警** — merge_freeze 提到的日期已过，agent 使用前会验证

**没有做什么：**
- 没有排序——不替模型决定哪条更"重要"
- 没有分级——不把低频记忆标为"不活跃"
- 没有共现推测——不从 agent 行为中推断关系

### 对比总结

| | 原本 | 增强后 |
|---|---|---|
| 结构 | 扁平列表 | 列表 + 显式引用 + 时间预警 |
| 关联 | 无 | 文件间的显式 markdown 引用 |
| 时效性 | 无信号 | 时间敏感记忆有客观提示 |
| 分级/排序 | 无 | **无（刻意不做）** |
| 注入稳定性 | 高 | 高（只在文件内容变化时才可能变）|
| 缓存友好 | 是 | 是 |

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code / Codex 会话                                │
│                                                         │
│  1. 加载 MEMORY.md 索引 ──→ system-reminder 注入       │
│  2. 运行 SessionStart hook ──→ additionalContext 注入   │
│                                                         │
└───────────────┬─────────────────────────────────────────┘
                │ hook (shell script, reads static file)
                │
┌───────────────▼─────────────────────────────────────────┐
│  TermCanvas API Server (已有，本地端口)                   │
│                                                         │
│  新增 endpoint:                                         │
│  GET /api/memory/index  ← 返回增强索引文本              │
│                                                         │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  增强索引（预生成）                                      │
│                                                         │
│  ~/.termcanvas/memory-index.md    (生成的增强索引)      │
│  ~/.termcanvas/memory-index.hash  (内容 hash 防抖)      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

不需要事件日志、不需要 PostToolUse hook、不需要 Stop hook。索引的刷新靠已有的 fs.watch（memory/ 目录文件变化时触发重新生成）。

---

## Hook 设计

### hooks.json

只需要一个 SessionStart hook：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/../scripts/memory-session-start.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### SessionStart hook

```bash
#!/bin/bash
# memory-session-start.sh
# 读取预生成的增强索引，通过 stdout 返回给 Claude Code

PORT=$(cat ~/.termcanvas/port 2>/dev/null || echo "")
if [ -z "$PORT" ]; then
  # TermCanvas 没运行，静默退出
  exit 0
fi

INDEX=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/memory/index" 2>/dev/null)
if [ -z "$INDEX" ]; then
  exit 0
fi

# 返回 additionalContext 格式
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $(echo "$INDEX" | jq -Rs .)
  }
}
EOF
```

---

## 增强索引生成

### 信号来源

只有两种，都从文件内容静态解析，不依赖运行时事件：

| 信号 | 来源 | 解析方式 |
|------|------|---------|
| 显式引用 | 记忆文件正文中的 `[text](other.md)` 链接 | 正则匹配 markdown 链接 |
| 时间敏感 | 记忆文件正文中的 `YYYY-MM-DD` 日期 | 正则匹配日期，与当前时间比较 |

### 触发时机

1. **TermCanvas 启动时** — 初始生成
2. **memory/ 目录文件变化时** — fs.watch（已有）触发重新生成

不需要额外的 hook 来触发刷新。

### 生成逻辑（伪代码）

```typescript
function generateEnhancedIndex(memoryDir: string): string {
  const graph = scanMemoryDir(memoryDir);
  if (graph.nodes.length === 0) return "";

  // 1. 提取显式引用（记忆文件之间的 markdown 链接）
  const references = findExplicitReferences(graph.nodes);

  // 2. 提取时间敏感记忆
  const timeSensitive = findTimeSensitiveMemories(graph.nodes);

  // 如果没有任何增强信息，返回空
  if (references.length === 0 && timeSensitive.length === 0) return "";

  let output = "<memory-graph source=\"termcanvas\">\n\n";

  if (references.length > 0) {
    output += "## References\n";
    for (const ref of references) {
      output += `- ${ref.from} → ${ref.to}\n`;
    }
    output += "\n";
  }

  if (timeSensitive.length > 0) {
    output += "## Time-sensitive\n";
    for (const ts of timeSensitive) {
      output += `- ${ts.fileName} — mentions date ${ts.date} (>${ts.daysAgo}d ago)\n`;
    }
    output += "\n";
  }

  output += "</memory-graph>";
  return output;
}

function findExplicitReferences(nodes: MemoryNode[]): Reference[] {
  const linkRe = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
  const nodeFileNames = new Set(nodes.map(n => n.fileName));
  const results: Reference[] = [];

  for (const node of nodes) {
    if (node.type === "index") continue; // MEMORY.md 的链接已经在索引中了
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(node.body)) !== null) {
      const target = match[2];
      if (nodeFileNames.has(target) && target !== node.fileName) {
        results.push({ from: node.fileName, to: target });
      }
    }
  }
  return results;
}

function findTimeSensitiveMemories(nodes: MemoryNode[]): TimeSensitiveEntry[] {
  const dateRe = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  const results: TimeSensitiveEntry[] = [];
  const now = Date.now();
  const THRESHOLD_DAYS = 14;

  for (const node of nodes) {
    if (node.type === "index") continue;
    let match: RegExpExecArray | null;
    while ((match = dateRe.exec(node.body)) !== null) {
      const dateMs = new Date(match[1]).getTime();
      const daysAgo = Math.floor((now - dateMs) / 86400000);
      if (daysAgo > THRESHOLD_DAYS) {
        results.push({ fileName: node.fileName, date: match[1], daysAgo });
        break; // 每个文件只报一次
      }
    }
  }
  return results;
}
```

### 防止缓存击穿

```typescript
function maybeUpdateIndex(newContent: string): boolean {
  const hashFile = path.join(dataDir, "memory-index.hash");
  const indexFile = path.join(dataDir, "memory-index.md");

  const newHash = crypto.createHash("md5").update(newContent).digest("hex");

  try {
    const oldHash = fs.readFileSync(hashFile, "utf-8").trim();
    if (oldHash === newHash) return false; // 内容没变，不更新
  } catch {}

  fs.writeFileSync(indexFile, newContent, "utf-8");
  fs.writeFileSync(hashFile, newHash, "utf-8");
  return true;
}
```

### 注入稳定性分析

| 变化来源 | 触发频率 | 影响 |
|---------|---------|------|
| 记忆文件内容被编辑（新增/修改引用链接）| 罕见 | References 可能变化 |
| 时间预警（某条记忆提到的日期刚好超过 14 天阈值）| 极罕见 | 新增一条 Time-sensitive |
| 日常使用 | 频繁 | **无变化** |

增强索引的内容几乎只在记忆文件被编辑时才变 → 绝大多数会话缓存命中。

---

## Skill 增强

在 `skills/skills/using-termcanvas/SKILL.md` 中追加记忆相关指令：

```markdown
## Memory Graph

When the session context contains a `<memory-graph>` block from TermCanvas:

- Check "References" before reading a memory file — referenced files are likely also relevant, follow the links
- If a memory is marked "Time-sensitive" with a date that has clearly passed, verify its content against current project state before acting on it
- Do not cite memory-graph metadata to the user — it's for your navigation, not for display
```

---

## 文件清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `skills/hooks/hooks.json` | 定义 SessionStart 钩子 |
| `skills/scripts/memory-session-start.sh` | SessionStart: 返回增强索引 |
| `electron/memory-index-generator.ts` | 从记忆文件生成增强索引文本 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `electron/api-server.ts` | 新增 `GET /api/memory/index` endpoint |
| `electron/memory-service.ts` | 新增 `findExplicitReferences`、`findTimeSensitiveMemories` |
| `skills/skills/using-termcanvas/SKILL.md` | 追加 Memory Graph 使用指令 |

### 数据文件（运行时生成）

| 文件 | 用途 |
|------|------|
| `~/.termcanvas/memory-index.md` | 预生成的增强索引 |
| `~/.termcanvas/memory-index.hash` | 内容 hash，防止缓存击穿 |

---

## 不做的事情

- **不做共现关系推断** — 同 session 共读 ≠ 语义相关，小样本下信噪比极差，图会退化为完全图
- **不做活跃度分级** — 召回频率 ≠ 重要性，分级会误伤低频高价值记忆
- **不做重要性排序** — 不替模型判断哪条记忆更重要
- **不展示召回次数** — 避免用使用频率暗示价值
- **不记录事件日志** — 没有共现计算就不需要事件日志
- **不需要 PostToolUse/Stop hook** — 索引生成只依赖文件内容，靠 fs.watch 刷新即可
- 不做 LLM 自动记忆提取
- 不起独立的 worker 服务（复用 TermCanvas API server）
- 不搞向量数据库或语义搜索
- 不修改 Claude Code 的 MEMORY.md 文件
- 不替代 Claude Code 的 Dream Mode

---

## 设计质疑与回应

### Q: 低频但重要的记忆会被忽视吗？

不会。我们**不做分级**。所有记忆在增强索引中的待遇完全平等——没有 active/dormant 标签，没有召回次数排序。

### Q: 为什么不做共现关系？

共现关系的信噪比在小样本下极差。记忆文件通常只有 10-30 个，agent 每次 session 可能读其中好几个。一次偶然的共读就会产生永久假关系。当几乎所有文件之间都有共现关系时，关系图退化为完全图，信息量为零。

只展示 agent 自己写的显式 markdown 引用，不做推测。

### Q: 为什么不直接改 MEMORY.md？

1. MEMORY.md 是 Claude Code 管理的文件，我们改了它 Dream Mode 可能会覆盖回去
2. 多个系统同时写一个文件容易冲突
3. additionalContext 是叠加注入，不影响原有内容，更安全

### Q: 如果 Claude Code 自己升级了记忆系统怎么办？

我们的增强是纯叠加的——如果 Claude Code 自己加了引用解析和时间预警，我们的注入会变成冗余信息。到时候可以检测 Claude Code 版本，如果原生支持了就不注入。**最坏情况是信息重复，不是信息冲突。**

### Q: 这个增强能增加记忆的触发频率吗？

不直接增加。agent 何时读取记忆由 Claude Code 的 system prompt 指令决定，我们改不了。但 skill 指令中的 "Check References — follow the links" 可以间接提高关联记忆的召回：读了 A 之后更可能顺着引用读 B。

---

## 已解决的问题

1. **PostToolUse 的 matcher 支持管道分隔** — 逆向 Claude Code 源码确认（`cli.js` 中的 `Ckz` 函数）：matcher 支持精确匹配、管道分隔列表、正则表达式三种格式。
2. **事件日志** — 不再需要。去掉共现关系后，索引生成只依赖文件内容的静态解析。
3. **Codex 兼容** — 后续做，目标是让 Codex 和 Claude Code 共享同一套记忆增强。

## 开放问题

1. **冷启动** — 新项目没有记忆文件之间的引用，也没有带日期的记忆。增强索引为空。这是可以接受的——没有增强信息时不注入任何内容。
