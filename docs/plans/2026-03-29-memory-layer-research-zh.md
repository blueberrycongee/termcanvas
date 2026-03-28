# LLM 记忆系统调研

为 TermCanvas 记忆层组件设计所做的调研笔记。

## 1. Claude Code 内置记忆（逆向工程）

### 架构

纯文件系统方案，零数据库。所有记忆以 Markdown 文件 + YAML frontmatter 存储。

```
~/.claude/projects/{project-id}/memory/
├── MEMORY.md              # 索引文件（始终注入上下文）
├── feedback_xxx.md        # 独立记忆文件
├── user_xxx.md
├── project_xxx.md
└── reference_xxx.md
```

Project ID 生成规则：文件路径中 `/` 替换为 `-`（如 `/Users/foo/bar` → `-Users-foo-bar`）。

### 记忆文件格式

```markdown
---
name: 描述性名称
description: 一行摘要，用于未来上下文匹配时判断相关性
type: feedback
---

正文内容...
**Why:** 原因
**How to apply:** 应用场景
```

### 四种记忆类型

| 类型 | 作用域 | 用途 |
|------|--------|------|
| `user` | 始终私有 | 用户角色、偏好、专业知识 |
| `feedback` | 默认私有 | 对工作方式的纠正和确认 |
| `project` | 默认团队 | 进行中的工作、截止日期、决策 |
| `reference` | 通常团队 | 外部系统指针（Linear、Grafana 等） |

### 加载管线（会话启动时）

1. 读取 MEMORY.md 索引
2. 截断至 200 行 / ~25KB（函数 `L$q()`）
3. 注入 `<system-reminder>` 标签
4. 团队记忆额外包裹在 `<team-memory-content source="shared">` 中

关键点：MEMORY.md 索引始终在上下文中，但单个记忆文件的完整内容只在通过 Read 工具读取时才加载（`nested_memory` 模式）。

### 写入流程

没有专用 API——使用标准 Write/Edit 工具写文件：

1. `Write(memory/xxx.md, content)` — 写入记忆文件
2. `Edit(memory/MEMORY.md, ...)` — 更新索引
3. `vV6()` 检测路径在记忆目录内
4. 触发遥测：`tengu_memdir_file_write`
5. 若启用团队记忆 → ETag 冲突解决 → 推送到服务器

保存什么、不保存什么完全由 **system prompt 中的指令** 控制，而非代码逻辑。

### 自动记忆（Dream Mode）

会话结束后的反思式记忆提取：

- **阶段 1：定位** — ls memory/、读取 MEMORY.md、浏览现有文件
- **阶段 2：收集** — grep 会话 JSONL 转录文件（窄搜索，文件可达 7MB+）
- **阶段 3：整合** — 去重、更新过时记忆、合并重复、写入新文件

约束：仅允许 Read/Write/Edit 工具，路径限定在记忆目录内，防重入合并机制。

### Session Memory vs File Memory

| | 文件记忆 | 会话记忆 |
|---|---|---|
| 持久化 | 磁盘文件 | 仅在会话内 |
| 容量 | 200 行索引 / 25KB | 12,000 tokens |
| 截断策略 | 按行数截断 | 按 section 优先级截断（保留"Current State"和"Errors"）|
| 用途 | 跨会话知识 | 当前会话工作记忆 |

### 团队记忆同步

- 基于 ETag 的冲突解决（重试 2 次）
- 同步前进行秘密检测扫描
- 限制：单文件 ≤ 250KB，批量 ≤ 200KB

### 设计原则

1. **文件即数据库** — 无 .sqlite/.db，纯 Markdown + YAML frontmatter
2. **LLM 自治** — 保存什么由 prompt 指令决定，而非代码规则
3. **索引 + 按需加载** — MEMORY.md 始终在上下文中，完整内容懒加载
4. **Dream Mode** — 会话后自动提取，无需用户主动发起
5. **类型语义化** — 4 种类型决定作用域（私有 vs 团队）和使用时机
6. **硬上限保护** — 200 行 / 25KB / 12,000 tokens，防止上下文爆炸

---

## 2. claude-mem 插件（第三方增强）

GitHub: [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — ~42k stars，AGPL-3.0

### 架构

在 Claude Code 内置记忆之上添加完整持久化层：

- **存储**：SQLite + Chroma 向量数据库（本地）
- **Worker**：HTTP 服务，端口 37777
- **MCP Server**：向 LLM 暴露 search/timeline/get_observations 工具
- **Web UI**：localhost:37777 的实时记忆流仪表板

### 生命周期钩子

| 钩子 | 触发时机 | 动作 |
|------|---------|------|
| Setup | 首次运行 | 初始化 |
| SessionStart | startup/clear/compact | 启动 worker 服务 |
| UserPromptSubmit | 用户发送消息 | 初始化 SDK session |
| **PostToolUse** | **每次工具调用后** | **自动捕获 observation** |
| Stop | 会话结束 | 压缩 observations 为摘要 |
| SessionEnd | 会话终止 | 终态处理 |

### 三层搜索（节省 Token）

- 第 1 层：`search()` — 仅返回 ID + 摘要（每条约 50-100 tokens）
- 第 2 层：`timeline()` — 时间线上下文
- 第 3 层：`get_observations()` — 批量获取完整内容

### Observation 类型

bugfix、feature、refactor、change、discovery、decision

### 与内置记忆对比

| | 内置记忆 | claude-mem |
|---|---|---|
| 存储 | Markdown 文件 | SQLite + Chroma 向量库 |
| 搜索 | 索引线性扫描 | FTS5 全文 + 语义向量搜索 |
| 捕获 | LLM 自主决定写入 | PostToolUse 钩子自动捕获 |
| 注入 | 全量索引塞入上下文 | 渐进式上下文注入（压缩时间线）|

---

## 3. ChatGPT 记忆 — 四层上下文注入

### 架构

不用向量数据库，不用 RAG。纯上下文注入，四层结构：

1. **会话元数据**：设备、浏览器、位置、时区 — 注入一次，会话结束丢弃
2. **用户记忆**（`bio` 工具）：持久化事实，带序号和 ISO 日期。格式：`[2024-04-26]. User loves dogs.` 自动合并相关记忆
3. **近期对话摘要**：约 15 条近期聊天摘要 — 仅包含用户消息，不含模型回复
4. **当前会话消息**：完整原始对话，按 token 限制截断

### 记忆创建

- 用户显式请求："记住我更喜欢 Python"
- 主动记忆（2025 年起）：ChatGPT 自动检测有价值信息，回避敏感话题

### 溢出策略

Token 预算超限时：优先丢弃当前会话消息，保留持久化事实和摘要。

### 设计启示

简单有效。大多数对话场景不需要复杂的检索基础设施。

---

## 4. Google Gemini 记忆 — 单一 user_context 文档

### 架构

所有主流聊天机器人中最简洁：一个结构化的 `user_context` 大纲文档。

### 按半衰期分区

- **人口统计**：姓名、年龄、位置、教育 — 几乎不变
- **兴趣和偏好**：技术、话题、长期目标 — 中等变化频率
- **人际关系**：重要人物 — 缓慢变化
- **带时间戳的事件/项目**：进行中的工作 — 频繁更新

### 独特功能：可追溯性

每条记忆声明包含：
1. 事实本身
2. 引用来源对话和确切日期的 rationale

唯一明确暴露时间溯源的系统。

### 访问控制

严格 opt-in。Flash 模型完全无法访问 user_context，仅 Pro 模型可以。

---

## 5. Cursor AI — 纯手动规则

没有内置自动记忆，依赖：

### 规则文件（`.cursor/rules/`）

- 带 YAML frontmatter 的 Markdown 文件
- 会话开始时作为 system prompt 加载
- 通过 `paths` 字段支持按路径匹配的规则
- 层级：用户级（`~/.cursor/rules/`）< 项目级（`.cursor/rules/`）

### Memory Bank（社区方案）

`memory-bank/` 目录下的结构化 Markdown 文件：
- `00-project-overview.md`、`01-architecture.md`、`02-components.md` 等
- 六阶段工作流：/van → /plan → /creative → /build → /reflect → /archive

完全手动 — 开发者自行维护一切。

---

## 6. Windsurf / Codeium — 自动记忆 + 触发模式

### 自动生成的记忆

- 创建方式：Cascade AI 自动识别有价值的上下文；用户也可手动请求
- 存储位置：`~/.codeium/windsurf/memories/`（本地，不提交到仓库）
- 作用域：绑定工作区，跨工作区不共享

### 规则系统 — 四种触发模式

| 模式 | 行为 |
|------|------|
| `always_on` | 每条消息都包含 |
| `model_decision` | 仅展示描述，LLM 自行决定是否读取完整内容 |
| `glob` | 按文件模式匹配激活（如 `*.js`）|
| `manual` | 通过 `@rule-name` 显式激活 |

`model_decision` 特别有意思 — 由 LLM 控制的懒加载。

---

## 7. mem0 — 混合三存储（最成熟的开源方案）

GitHub: [mem0ai/mem0](https://github.com/mem0ai/mem0) — 25k+ stars，有 arXiv 论文

### 存储后端

| 类型 | 默认 | 可选项 |
|------|------|--------|
| 向量存储 | Qdrant | 24+ 选项：Pinecone、Chroma、PGVector、FAISS、Milvus 等 |
| 图存储 | Neo4j | Kuzu、Memgraph、Neptune |
| 历史数据库 | SQLite | 所有记忆操作的审计记录 |

### 提取管道

1. LLM 从对话中提取结构化事实
2. 在现有记忆中进行相似性搜索
3. LLM 决定每条事实的操作：ADD / UPDATE / DELETE
4. 并行写入向量存储和图存储

两种模式：**推理模式**（LLM 驱动）和**直接模式**（快速嵌入，跳过提取）。

### 检索

- 向量相似性（语义搜索）
- 元数据过滤：`user_id`、`agent_id`、`app_id`、`run_id`
- 图导航（跨实体关系遍历）
- 重排序：Cohere、Sentence Transformer 等

### 优势

最广泛的后端兼容性、智能事实去重、混合检索。

### 劣势

需要维护多个存储后端、LLM 提取增加延迟和成本、图配置复杂度高。

---

## 8. Letta / MemGPT — OS 式两层记忆

GitHub: [letta-ai/letta](https://github.com/letta-ai/letta)

### 核心隐喻

LLM = CPU，上下文窗口 = RAM，外部存储 = 磁盘。

### 三层记忆

| 层级 | 类比 | 行为 |
|------|------|------|
| **Core Memory** | RAM | 始终在上下文中。带标签的 Block（persona、human），有字符限制 |
| **Recall Memory** | 日志 | 完整对话历史。溢出时递归摘要压缩 |
| **Archival Memory** | 磁盘 | 索引化的外部知识。向量数据库支撑 |

### 自编辑记忆工具

Agent 通过工具调用自主管理记忆：
- `core_memory_append` / `core_memory_replace`
- `memory_insert` / `memory_rethink` / `memory_apply_patch`
- `archival_memory_insert()` / `archival_memory_search()`

### 核心创新

LLM 自身作为记忆管理器，自主决定什么 page in/out — 而非由框架决定。

---

## 9. RAG 作为记忆机制

### 核心管道

1. **索引**：文档 → 分块 → 生成嵌入 → 存入向量数据库
2. **检索**：查询嵌入 → 相似性搜索 → 返回 top-k 结果
3. **生成**：检索结果 + 原始 prompt → LLM 生成回答

### Agentic RAG 演进

Agent 编排 RAG 组件：查询重写、多步检索、结果验证。

### 优势

可扩展到海量文档、语义检索、无需修改模型参数。

### 劣势

分块策略显著影响质量、无法理解跨文档关系、检索延迟、对需要综合多信息片段的"全局性问题"表现差。

---

## 10. 知识图谱记忆（GraphRAG / Graphiti）

### Microsoft GraphRAG

索引管道：文本 → 实体/关系提取 → Leiden 社区检测 → 层级摘要。

查询模式：
- **全局搜索**：利用社区摘要回答关于整个语料库的问题
- **本地搜索**：从特定实体出发，扩展到邻居和关联概念
- **DRIFT 搜索**：本地搜索 + 社区上下文

### Graphiti（Zep 开发）

时间感知的知识图谱，核心是**双时间模型**：

每条边追踪 4 个时间戳：
- `t'_created` / `t'_expired`：系统事务时间
- `t_valid` / `t_invalid`：事实有效期

旧事实被**标记为无效而非删除** — 支持任意时间点的历史查询。

混合搜索：余弦相似性 + BM25 + 广度优先图遍历。P95 延迟 300ms。

基准测试：Deep Memory Retrieval 94.8%（vs MemGPT 93.4%）。

---

## 11. 理论基础

### 认知科学映射

| 人类记忆 | LLM 对应 | 典型实现 |
|---------|---------|---------|
| 感觉记忆 | 上下文窗口 | Token 序列 |
| 工作记忆 | 对话 buffer / scratchpad | 滑动窗口、摘要 |
| 情景记忆 | 带时间戳的交互片段 | 向量数据库 |
| 语义记忆 | 提取的事实/实体 | 知识图谱、fact store |
| 程序性记忆 | 工具使用模式/技能 | Skill library、few-shot |

### 六大设计维度

1. **存储粒度**：原文 → 片段 → 事实三元组 → 摘要 → 纯 embedding
2. **检索机制**：近因性 / 相关性 / 重要性 / 混合评分 / LLM 自主检索
3. **写入策略**：被动全存 / LLM 选择性提取 / 结构化抽取
4. **组织结构**：扁平 / 时间线 / 层次化 / 图 / 混合
5. **遗忘策略**：时间衰减 / 访问频率衰减 / 容量淘汰 / 矛盾替换
6. **巩固机制**：摘要压缩 / 事实抽取 / 反思生成 / 图合并

### Stanford Generative Agents（反思机制）

- Memory Stream（时间序列）+ Retrieval（recency × relevance × importance）+ Reflection（当重要性累积超过阈值时，生成更高层次的观察）
- 递归抽象：L0 原始观察 → L1 一阶反思 → L2 二阶反思

### 关键权衡

| 维度 | 极端 A | 极端 B |
|------|--------|--------|
| 压缩 vs 保真 | 摘要节省 token | 原文保留细节 |
| 主动 vs 被动 | LLM 判断什么值得记 | 全存储，检索时过滤 |
| 结构化 vs 非结构化 | 图支持推理 | 向量更简单通用 |
| 隐式 vs 显式 | 模型权重（不可编辑）| 外部存储（可审计）|
| 个体 vs 共享 | 按用户隔离 | 跨用户知识共享 |

### 核心结论

1. **商业产品普遍选择简单方案** — ChatGPT 和 Gemini 不用向量数据库，Claude Code 用纯 Markdown
2. **检索是最大瓶颈** — 存储容量不是问题，在正确时间检索正确记忆才是
3. **长上下文不能替代记忆** — 即使 1M tokens，"lost in the middle" 问题依然存在
4. **主动管理是趋势** — 从"存一切搜一切"转向 LLM 自主决定读写（MemGPT 范式）
5. **没有银弹** — 每种方案都在压缩率、检索精度、计算成本、实现复杂度之间取舍

---

## 对比矩阵

| 系统 | 存储 | 自动学习 | 语义检索 | 时间感知 | 图关系 | 衰减 | 复杂度 |
|------|------|---------|---------|---------|-------|------|--------|
| ChatGPT | 服务端 | 主动记忆 | 否 | 日期戳 | 否 | 无 | 低 |
| Gemini | 单文档 | 是 | 否 | rationale 溯源 | 否 | 分区半衰期 | 极低 |
| Claude Code | Markdown | Dream Mode | 否 | 否 | 否 | 无 | 低 |
| Cursor | Markdown | 否 | 否 | 否 | 否 | 无 | 极低 |
| Windsurf | 本地文件 | 是 | 不透明 | 否 | 否 | 无 | 低 |
| mem0 | 向量+图+KV | LLM 提取 | 是 | 否 | 是 | 无 | 高 |
| MemGPT/Letta | SQLite+向量 | 自编辑 | 是（档案搜索）| 否 | 否 | 上下文驱逐 | 中高 |
| LangChain | 可配置 | 可配置 | 是 | 否 | 否 | 无 | 中 |
| GraphRAG | 图+向量 | 离线索引 | 是 | 否 | 是 | 否 | 高 |
| Graphiti | Neo4j | 实时 | 是 | 双时间模型 | 是 | 时间失效 | 很高 |
