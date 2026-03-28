# LLM Memory Systems Research

Research notes for designing TermCanvas's memory layer component.

## 1. Claude Code Built-in Memory (Reverse Engineered)

### Architecture

Pure file-system approach, zero database. All memory stored as Markdown files with YAML frontmatter.

```
~/.claude/projects/{project-id}/memory/
├── MEMORY.md              # Index file (always injected into context)
├── feedback_xxx.md        # Individual memory files
├── user_xxx.md
├── project_xxx.md
└── reference_xxx.md
```

Project ID: filesystem path with `/` replaced by `-` (e.g., `/Users/foo/bar` → `-Users-foo-bar`).

### Memory File Format

```markdown
---
name: Descriptive name
description: One-line summary for relevance matching
type: feedback
---

Content body...
**Why:** Reasoning
**How to apply:** Usage guidance
```

### Four Memory Types

| Type | Scope | Purpose |
|------|-------|---------|
| `user` | Always private | User role, preferences, expertise |
| `feedback` | Default private | Corrections and confirmations on approach |
| `project` | Default team | Ongoing work, deadlines, decisions |
| `reference` | Usually team | Pointers to external systems (Linear, Grafana, etc.) |

### Loading Pipeline (Session Start)

1. Read MEMORY.md index
2. Truncate to 200 lines / ~25KB (function `L$q()`)
3. Inject into `<system-reminder>` tags
4. Team memory additionally wrapped in `<team-memory-content source="shared">`

Key: MEMORY.md index is always in context, but individual file contents are only loaded on-demand via Read tool (`nested_memory` mode).

### Write Flow

No dedicated API -- standard Write/Edit tools write files:

1. `Write(memory/xxx.md, content)` — write memory file
2. `Edit(memory/MEMORY.md, ...)` — update index
3. `vV6()` detects path is within memory directory
4. Triggers telemetry: `tengu_memdir_file_write`
5. If team memory enabled → ETag conflict resolution → push to server

What to save / not save is entirely controlled by **system prompt instructions**, not code logic.

### Auto-Memory (Dream Mode)

Reflective memory extraction after session ends:

- **Phase 1: Orient** — ls memory/, read MEMORY.md, skim existing files
- **Phase 2: Gather** — grep session JSONL transcripts (narrow search, files can be 7MB+)
- **Phase 3: Consolidate** — deduplicate, update stale memories, merge duplicates, write new files

Constraints: only Read/Write/Edit tools, path-restricted to memory directory, anti-reentrance coalescing.

### Session Memory vs File Memory

| | File Memory | Session Memory |
|---|---|---|
| Persistence | Disk files | In-session only |
| Capacity | 200-line index / 25KB | 12,000 tokens |
| Truncation | Line-count based | Section-priority based (keeps "Current State" and "Errors") |
| Purpose | Cross-session knowledge | Current session working memory |

### Team Memory Sync

- ETag-based conflict resolution (2 retries)
- Secret detection scanning before sync
- Limits: 250KB per file, 200KB batch

### Design Principles

1. **File as database** — no .sqlite/.db, pure Markdown + YAML frontmatter
2. **LLM autonomy** — what to save is decided by prompt instructions, not code rules
3. **Index + on-demand loading** — MEMORY.md always in context, full content loaded lazily
4. **Dream Mode** — post-session automatic extraction, no user initiative needed
5. **Typed semantics** — 4 types determine scope (private vs team) and usage timing
6. **Hard limits** — 200 lines / 25KB / 12,000 tokens, prevent context explosion

---

## 2. claude-mem Plugin (Third-party Enhancement)

GitHub: [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — ~42k stars, AGPL-3.0

### Architecture

Adds a full persistence layer on top of Claude Code's built-in memory:

- **Storage**: SQLite + Chroma vector database (local)
- **Worker**: HTTP service on port 37777
- **MCP Server**: Exposes search/timeline/get_observations tools to LLM
- **Web UI**: Real-time memory stream dashboard at localhost:37777

### Lifecycle Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| Setup | First run | Initialize |
| SessionStart | startup/clear/compact | Start worker service |
| UserPromptSubmit | User sends message | Init SDK session |
| **PostToolUse** | **After each tool call** | **Auto-capture observation** |
| Stop | Session end | Compress observations into summary |
| SessionEnd | Session terminate | Finalize |

### 3-Layer Search (Token-Efficient)

- Layer 1: `search()` — IDs + summaries only (~50-100 tokens/result)
- Layer 2: `timeline()` — chronological context
- Layer 3: `get_observations()` — batch fetch full details

### Observation Types

bugfix, feature, refactor, change, discovery, decision

### vs Built-in Memory

| | Built-in | claude-mem |
|---|---|---|
| Storage | Markdown files | SQLite + Chroma vector DB |
| Search | Index linear scan | FTS5 full-text + semantic vector search |
| Capture | LLM decides to write | PostToolUse hook auto-captures |
| Injection | Full index in context | Progressive context injection (compressed timeline) |

---

## 3. ChatGPT Memory — Four-Layer Context Injection

### Architecture

No vector database, no RAG. Pure context injection with four layers:

1. **Session Metadata**: Device, browser, location, timezone — injected once, discarded after session
2. **User Memory** (`bio` tool): Persistent facts with serial number and ISO date. Format: `[2024-04-26]. User loves dogs.` Auto-merges related memories.
3. **Recent Conversations Summary**: ~15 recent chat summaries — user messages only, no model replies
4. **Current Session Messages**: Full raw conversation, truncated by token limit

### Memory Creation

- Explicit user request: "Remember that I prefer Python"
- Proactive memory (2025+): ChatGPT auto-detects valuable info, avoids sensitive topics

### Overflow Strategy

When token budget exceeded: drop current session messages first, preserve persistent facts and summaries.

### Design Takeaway

Simple and effective. No complex retrieval infrastructure needed for most conversational use cases.

---

## 4. Google Gemini Memory — Single user_context Document

### Architecture

The simplest of all major chatbots: a single structured `user_context` outline document.

### Sections with Different Half-Lives

- **Demographics**: name, age, location, education — rarely changes
- **Interests and preferences**: tech, topics, long-term goals — moderate churn
- **Relationships**: important people — slow change
- **Timestamped events/projects**: ongoing work — frequent updates

### Unique Feature: Traceability

Each memory claim includes:
1. The fact itself
2. Rationale citing the source conversation and exact date

Only system that explicitly exposes temporal provenance.

### Access Control

Strict opt-in. Flash model cannot access user_context at all, only Pro.

---

## 5. Cursor AI — Manual Rules Only

No built-in automatic memory. Relies on:

### Rule Files (`.cursor/rules/`)

- Markdown files with YAML frontmatter
- Loaded as system prompt on session start
- Supports path-specific rules via `paths` field
- Hierarchy: user-level (`~/.cursor/rules/`) < project-level (`.cursor/rules/`)

### Memory Bank (Community Pattern)

Structured markdown files in `memory-bank/`:
- `00-project-overview.md`, `01-architecture.md`, `02-components.md`, etc.
- Six-phase workflow: /van → /plan → /creative → /build → /reflect → /archive

Fully manual — developer maintains everything.

---

## 6. Windsurf / Codeium — Auto Memory + Trigger Modes

### Auto-Generated Memories

- Created by: Cascade AI auto-detects useful context; user can also request
- Storage: `~/.codeium/windsurf/memories/` (local, not committed to repo)
- Scope: workspace-bound, no cross-workspace sharing

### Rules System — Four Trigger Modes

| Mode | Behavior |
|------|----------|
| `always_on` | Included in every message |
| `model_decision` | Only shows description; LLM decides whether to read full content |
| `glob` | Activated by file pattern match (e.g., `*.js`) |
| `manual` | Explicit `@rule-name` activation |

`model_decision` is particularly interesting — lazy loading controlled by LLM.

---

## 7. mem0 — Hybrid Triple-Store (Most Mature Open Source)

GitHub: [mem0ai/mem0](https://github.com/mem0ai/mem0) — 25k+ stars, arXiv paper

### Storage Backend

| Type | Default | Options |
|------|---------|---------|
| Vector store | Qdrant | 24+ options: Pinecone, Chroma, PGVector, FAISS, Milvus, etc. |
| Graph store | Neo4j | Kuzu, Memgraph, Neptune |
| History DB | SQLite | Audit trail for all memory operations |

### Extraction Pipeline

1. LLM extracts structured facts from conversation
2. Similarity search against existing memories
3. LLM decides: ADD / UPDATE / DELETE per fact
4. Parallel write to vector store and graph store

Two modes: **Infer Mode** (LLM-driven) and **Direct Mode** (fast embedding, skip extraction).

### Retrieval

- Vector similarity (semantic search)
- Metadata filtering: `user_id`, `agent_id`, `app_id`, `run_id`
- Graph navigation (cross-entity relationship traversal)
- Re-ranking: Cohere, Sentence Transformer, etc.

### Strengths

Broadest backend compatibility, intelligent fact deduplication, hybrid retrieval.

### Weaknesses

Multiple backends to maintain, LLM extraction adds latency and cost, graph config complexity.

---

## 8. Letta / MemGPT — OS-Style Two-Layer Memory

GitHub: [letta-ai/letta](https://github.com/letta-ai/letta)

### Core Metaphor

LLM = CPU, context window = RAM, external storage = Disk.

### Three Memory Layers

| Layer | Analogy | Behavior |
|-------|---------|----------|
| **Core Memory** | RAM | Always in context. Tagged Blocks (persona, human) with character limits |
| **Recall Memory** | Logs | Full conversation history. Recursive summarization on overflow |
| **Archival Memory** | Disk | Indexed external knowledge. Vector DB backed |

### Self-Editing Memory Tools

Agent manages its own memory via tool calls:
- `core_memory_append` / `core_memory_replace`
- `memory_insert` / `memory_rethink` / `memory_apply_patch`
- `archival_memory_insert()` / `archival_memory_search()`

### Key Innovation

LLM itself acts as the memory manager, deciding what to page in/out — not the framework.

---

## 9. RAG as Memory Mechanism

### Core Pipeline

1. **Index**: documents → chunks → embeddings → vector DB
2. **Retrieve**: query embedding → similarity search → top-k results
3. **Generate**: retrieved context + prompt → LLM response

### Agentic RAG Evolution

Agent orchestrates RAG components: query rewriting, multi-step retrieval, result verification.

### Strengths

Scales to massive document sets, semantic retrieval, no model modification needed.

### Weaknesses

Chunk strategy critically affects quality, no cross-document relationship understanding, retrieval latency, poor on "global questions" requiring synthesis.

---

## 10. Knowledge Graph Memory (GraphRAG / Graphiti)

### Microsoft GraphRAG

Index pipeline: text → entity/relationship extraction → Leiden community detection → hierarchical summaries.

Query modes:
- **Global Search**: community summaries for corpus-wide questions
- **Local Search**: expand from specific entities to neighbors
- **DRIFT Search**: Local + community context

### Graphiti (by Zep)

Temporal-aware knowledge graph with **dual-time model**:

Each edge tracks 4 timestamps:
- `t'_created` / `t'_expired`: system transaction time
- `t_valid` / `t_invalid`: fact validity period

Old facts are **marked invalid, not deleted** — supports historical queries at any point in time.

Hybrid search: cosine similarity + BM25 + breadth-first graph traversal. P95 latency 300ms.

Benchmark: Deep Memory Retrieval 94.8% (vs MemGPT 93.4%).

---

## 11. Theoretical Foundations

### Cognitive Science Mapping

| Human Memory | LLM Equivalent | Typical Implementation |
|-------------|----------------|----------------------|
| Sensory | Context window | Token sequence |
| Working | Conversation buffer / scratchpad | Sliding window, summaries |
| Episodic | Timestamped interaction fragments | Vector database |
| Semantic | Extracted facts / entities | Knowledge graph, fact store |
| Procedural | Tool usage patterns / skills | Skill library, few-shot |

### Six Design Dimensions

1. **Storage granularity**: raw text → chunks → fact triples → summaries → pure embeddings
2. **Retrieval**: recency / relevance / importance / hybrid scoring / LLM self-directed
3. **Write strategy**: passive store-all / LLM selective extraction / structured extraction
4. **Organization**: flat / timeline / hierarchical / graph / hybrid
5. **Forgetting**: time decay / access-frequency decay / capacity eviction / contradiction replacement
6. **Consolidation**: summary compression / fact extraction / reflection generation / graph merge

### Stanford Generative Agents (Reflection Mechanism)

- Memory Stream (temporal) + Retrieval (recency × relevance × importance) + Reflection (generates higher-level observations when importance accumulates past threshold)
- Recursive: L0 raw observation → L1 first-order reflection → L2 second-order reflection

### Key Trade-offs

| Dimension | Pole A | Pole B |
|-----------|--------|--------|
| Compression vs Fidelity | Summaries save tokens | Raw text preserves detail |
| Active vs Passive | LLM judges what to remember | Store everything, filter on retrieval |
| Structured vs Unstructured | Graph enables reasoning | Vector is simpler and more general |
| Implicit vs Explicit | Model weights (non-editable) | External storage (auditable) |
| Individual vs Shared | Per-user isolation | Cross-user knowledge sharing |

### Core Conclusions

1. **Commercial products choose simple approaches** — ChatGPT and Gemini don't use vector DBs; Claude Code uses plain Markdown
2. **Retrieval is the bottleneck** — storage capacity is not the problem; retrieving the right memory at the right time is
3. **Long context doesn't replace memory** — "lost in the middle" problem persists even at 1M tokens
4. **Active management is the trend** — from "store everything, search everything" to LLM self-directed read/write (MemGPT paradigm)
5. **No silver bullet** — every approach trades off compression, retrieval precision, compute cost, and implementation complexity

---

## Comparison Matrix

| System | Storage | Auto-Learn | Semantic Search | Time-Aware | Graph Relations | Decay | Complexity |
|--------|---------|-----------|----------------|------------|----------------|-------|------------|
| ChatGPT | Server-side | Proactive | No | Date stamps | No | None | Low |
| Gemini | Single doc | Yes | No | Rationale | No | Section half-life | Very low |
| Claude Code | Markdown | Dream mode | No | No | No | None | Low |
| Cursor | Markdown | No | No | No | No | None | Very low |
| Windsurf | Local files | Yes | Opaque | No | No | None | Low |
| mem0 | Vector+Graph+KV | LLM extract | Yes | No | Yes | None | High |
| MemGPT/Letta | SQLite+Vector | Self-edit | Yes (archival) | No | No | Eviction | Med-High |
| LangChain | Configurable | Configurable | Yes | No | No | None | Medium |
| GraphRAG | Graph+Vector | Offline index | Yes | No | Yes | No | High |
| Graphiti | Neo4j | Real-time | Yes | Dual-time | Yes | Time invalidation | Very high |
