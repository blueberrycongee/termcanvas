# Claude Code `/insights` Command — Reverse Engineering Documentation

> Extracted from Claude Code v2.1.78, `cli.js` (bundled, minified)
> Date: 2026-03-21

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Command Registration](#2-command-registration-caz)
3. [Main Orchestrator](#3-main-orchestrator-haz)
4. [Session Scanning & Loading](#4-session-scanning--loading)
5. [Metrics Extraction](#5-metrics-extraction-oaz--li8)
6. [Session Text Representation & Summarization](#6-session-text-representation--summarization)
7. [AI Facet Extraction](#7-ai-facet-extraction)
8. [Statistics Aggregation](#8-statistics-aggregation-faz)
9. [Multi-Clauding Detection](#9-multi-clauding-detection-gaz)
10. [AI Insight Generation (7+1 Tasks)](#10-ai-insight-generation-71-tasks)
11. [HTML Report Generation](#11-html-report-generation-laz)
12. [Caching Layer](#12-caching-layer)
13. [Complete Data Flow Diagram](#13-complete-data-flow-diagram)
14. [Key Constants & Limits](#14-key-constants--limits)

---

## 1. Architecture Overview

`/insights` is a built-in slash command that generates an HTML usage report by:

1. Scanning all local session JSONL files from `~/.claude/projects/`
2. Extracting structured metrics from each session (tools, tokens, git ops, etc.)
3. Using Claude AI to extract semantic "facets" (goals, satisfaction, friction) per session
4. Aggregating all metrics into a unified stats object
5. Running 7 parallel AI analysis tasks + 1 summary task
6. Generating a self-contained HTML report with charts and interactive JS
7. Writing the report to `~/.claude/usage-data/report.html`

All intermediate results (session metadata and facets) are cached to disk for incremental processing.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        /insights command                            │
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │  Scan     │───▶│ Extract  │───▶│ AI Facet │───▶│  Aggregate   │  │
│  │ Sessions  │    │ Metrics  │    │ Analysis │    │   Stats      │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────┬───────┘  │
│                                                          │          │
│                                  ┌──────────────────────▼────────┐ │
│                                  │  7 Parallel AI Analysis Tasks  │ │
│                                  │  + 1 At-a-Glance Summary      │ │
│                                  └──────────────┬────────────────┘ │
│                                                  │                  │
│                                          ┌───────▼───────┐         │
│                                          │  HTML Report   │         │
│                                          │  Generation    │         │
│                                          └───────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Command Registration (CAz)

The command is registered as a `type: "prompt"` slash command, meaning its output is injected
back into the conversation as a prompt for Claude to present to the user.

```js
CAz = {
  type: "prompt",
  name: "insights",
  description: "Generate a report analyzing your Claude Code sessions",
  contentLength: 0,
  isEnabled: () => true,     // Always enabled
  isHidden: false,
  progressMessage: "analyzing your sessions",
  source: "builtin",

  async getPromptForCommand(A) {
    let collectRemote = false;
    let { insights, htmlPath, data, remoteStats } = await hAz({ collectRemote });

    let reportUrl = `file://${htmlPath}`;

    // Build stats summary line
    let statsLine = [
      data.total_sessions_scanned && data.total_sessions_scanned > data.total_sessions
        ? `${data.total_sessions_scanned.toLocaleString()} sessions total · ${data.total_sessions} analyzed`
        : `${data.total_sessions} sessions`,
      `${data.total_messages.toLocaleString()} messages`,
      `${Math.round(data.total_duration_hours)}h`,
      `${data.git_commits} commits`
    ].join(" · ");

    // Build At-a-Glance markdown
    let atAGlance = insights.at_a_glance;
    let glanceText = atAGlance ? `## At a Glance

${atAGlance.whats_working ? `**What's working:** ${atAGlance.whats_working} See _Impressive Things You Did_.` : ""}

${atAGlance.whats_hindering ? `**What's hindering you:** ${atAGlance.whats_hindering} See _Where Things Go Wrong_.` : ""}

${atAGlance.quick_wins ? `**Quick wins to try:** ${atAGlance.quick_wins} See _Features to Try_.` : ""}

${atAGlance.ambitious_workflows ? `**Ambitious workflows:** ${atAGlance.ambitious_workflows} See _On the Horizon_.` : ""}`
    : "_No insights generated_";

    // Build user-facing message
    let userMessage = `# Claude Code Insights

${statsLine}
${data.date_range.start} to ${data.date_range.end}

${glanceText}

Your full shareable insights report is ready: ${reportUrl}`;

    // Return prompt that instructs Claude to output the message
    return [{
      type: "text",
      text: `The user just ran /insights to generate a usage report analyzing their Claude Code sessions.

Here is the full insights data:
${JSON.stringify(insights, null, 2)}

Report URL: ${reportUrl}
HTML file: ${htmlPath}
Facets directory: ${dh1()}

Here is what the user sees:
${userMessage}

Now output the following message exactly:

<message>
Your shareable insights report is ready:
${reportUrl}

Want to dig into any section or try one of the suggestions?
</message>`
    }];
  },

  userFacingName() { return "insights"; }
};
```

---

## 3. Main Orchestrator (hAz)

This is the top-level function that coordinates the entire pipeline.

```js
async function hAz(options) {
  let remoteStats;

  // Step 1: Scan all session files
  let allFiles = await RAz();           // → [{sessionId, path, mtime, size}, ...]
  let totalScanned = allFiles.length;

  const BATCH_SIZE = 50;
  const MAX_UNCACHED = 200;
  let sessionMetas = [];                // Collected session metadata
  let uncachedFiles = [];               // Files needing fresh processing

  // Step 2: Check session-meta cache in batches
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    let batch = allFiles.slice(i, i + BATCH_SIZE);
    let results = await Promise.all(
      batch.map(async (info) => ({
        sessionInfo: info,
        cached: await PAz(info.sessionId)   // Read from session-meta cache
      }))
    );
    for (let { sessionInfo, cached } of results) {
      if (cached) sessionMetas.push(cached);
      else if (uncachedFiles.length < MAX_UNCACHED) uncachedFiles.push(sessionInfo);
    }
  }

  // Step 3: Load raw sessions and extract metadata for uncached
  let rawSessionLogs = new Map();       // sessionId → raw session log

  // Filter: skip self-referencing insights sessions
  let isSelfInsight = (session) => {
    for (let msg of session.messages.slice(0, 5)) {
      if (msg.type === "user" && msg.message) {
        let content = msg.message.content;
        if (typeof content === "string") {
          if (content.includes("RESPOND WITH ONLY A VALID JSON OBJECT") ||
              content.includes("record_facets")) return true;
        }
      }
    }
    return false;
  };

  const LOAD_BATCH = 10;
  for (let i = 0; i < uncachedFiles.length; i += LOAD_BATCH) {
    let batch = uncachedFiles.slice(i, i + LOAD_BATCH);
    let loaded = await Promise.all(
      batch.map(async (f) => {
        try { return await lh1(f.path); }   // Load JSONL session log
        catch { return []; }
      })
    );
    let newMetas = [];
    for (let sessions of loaded) {
      for (let session of sessions) {
        if (isSelfInsight(session) || !$Az(session)) continue;  // Skip invalid
        let meta = Li8(session);             // Extract structured metadata
        sessionMetas.push(meta);
        newMetas.push(meta);
        rawSessionLogs.set(meta.session_id, session);
      }
    }
    // Cache newly extracted metadata
    await Promise.all(newMetas.map((m) => WAz(m)));
  }

  // Step 4: Deduplicate by session_id (keep highest message count)
  let deduped = new Map();
  for (let meta of sessionMetas) {
    let existing = deduped.get(meta.session_id);
    if (!existing ||
        meta.user_message_count > existing.user_message_count ||
        (meta.user_message_count === existing.user_message_count &&
         meta.duration_minutes > existing.duration_minutes)) {
      deduped.set(meta.session_id, meta);
    }
  }
  let dedupedIds = new Set(deduped.keys());
  sessionMetas = [...deduped.values()];

  // Clean up rawSessionLogs to match deduped set
  for (let id of rawSessionLogs.keys()) {
    if (!dedupedIds.has(id)) rawSessionLogs.delete(id);
  }

  // Sort by start_time descending
  sessionMetas.sort((a, b) => b.start_time.localeCompare(a.start_time));

  // Step 5: Filter minimum viable sessions
  let isViable = (meta) => {
    if (meta.user_message_count < 2) return false;   // At least 2 user messages
    if (meta.duration_minutes < 1) return false;      // At least 1 minute
    return true;
  };
  let viableSessions = sessionMetas.filter(isViable);

  // Step 6: Load/extract facets
  let facetsMap = new Map();
  let uncachedForFacets = [];
  const MAX_FACETS = 50;

  let cachedFacets = await Promise.all(
    viableSessions.map(async (meta) => ({
      sessionId: meta.session_id,
      cached: await MAz(meta.session_id)     // Read from facets cache
    }))
  );
  for (let { sessionId, cached } of cachedFacets) {
    if (cached) facetsMap.set(sessionId, cached);
    else {
      let rawLog = rawSessionLogs.get(sessionId);
      if (rawLog && uncachedForFacets.length < MAX_FACETS) {
        uncachedForFacets.push({ log: rawLog, sessionId });
      }
    }
  }

  // Step 7: AI facet extraction for uncached sessions
  const FACET_BATCH = 50;
  for (let i = 0; i < uncachedForFacets.length; i += FACET_BATCH) {
    let batch = uncachedForFacets.slice(i, i + FACET_BATCH);
    let results = await Promise.all(
      batch.map(async ({ log, sessionId }) => {
        let newFacets = await ZAz(log, sessionId);  // AI facet extraction
        return { sessionId, newFacets };
      })
    );
    let toCache = [];
    for (let { sessionId, newFacets } of results) {
      if (newFacets) {
        facetsMap.set(sessionId, newFacets);
        toCache.push(newFacets);
      }
    }
    await Promise.all(toCache.map((f) => XAz(f)));  // Cache new facets
  }

  // Step 8: Filter out warmup_minimal sessions
  let isWarmup = (sessionId) => {
    let facets = facetsMap.get(sessionId);
    if (!facets) return false;
    let cats = facets.goal_categories;
    let active = Object.keys(cats).filter((k) => (cats[k] ?? 0) > 0);
    return active.length === 1 && active[0] === "warmup_minimal";
  };

  let finalSessions = viableSessions.filter((m) => !isWarmup(m.session_id));
  let finalFacets = new Map();
  for (let [id, f] of facetsMap) {
    if (!isWarmup(id)) finalFacets.set(id, f);
  }

  // Step 9: Aggregate statistics
  let stats = fAz(finalSessions, finalFacets);
  stats.total_sessions_scanned = totalScanned;

  // Step 10: Run AI analysis
  let insights = await vAz(stats, facetsMap);

  // Step 11: Generate HTML report
  let html = LAz(stats, insights);

  // Step 12: Write to disk
  try { await mkdir(Uh1(), { recursive: true }); } catch {}
  let htmlPath = join(Uh1(), "report.html");
  await writeFile(htmlPath, html, { encoding: "utf-8", mode: 0o600 });

  return { insights, htmlPath, data: stats, remoteStats, facets: finalFacets };
}
```

---

## 4. Session Scanning & Loading

### RAz — Scan all session files

Scans `~/.claude/projects/` for all `.jsonl` session files across all project directories.

```js
async function RAz() {
  let projectsDir = Px();   // ~/.claude/projects
  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  let subdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => join(projectsDir, e.name));

  let allFiles = [];
  for (let i = 0; i < subdirs.length; i++) {
    let files = or6(subdirs[i]);   // Sync scan for .jsonl files
    for (let [sessionId, info] of files) {
      allFiles.push({
        sessionId,
        path: info.path,
        mtime: info.mtime,
        size: info.size
      });
    }
    // Yield to event loop every 10 dirs
    if (i % 10 === 9) await new Promise((r) => setImmediate(r));
  }

  // Sort by modification time, newest first
  return allFiles.sort((a, b) => b.mtime - a.mtime);
}
```

### or6 — Sync directory scanner for .jsonl files

```js
function or6(dirPath) {
  let fs = O1();   // sync fs module
  let result = new Map();
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return result;
  }

  for (let entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

    let sessionId = KE(basename(entry.name, ".jsonl"));  // Parse session ID
    if (!sessionId) continue;

    let fullPath = join(dirPath, entry.name);
    try {
      let stat = fs.statSync(fullPath);
      result.set(sessionId, {
        path: fullPath,
        mtime: stat.mtime.getTime(),
        ctime: stat.birthtime.getTime(),
        size: stat.size
      });
    } catch {
      log(`Failed to stat session file: ${fullPath}`);
    }
  }
  return result;
}
```

### $Az — Session validity check

```js
function $Az(session) {
  return !Number.isNaN(session.created.getTime()) &&
         !Number.isNaN(session.modified.getTime());
}
```

### Path helpers

```js
function Px()  { return join(d8(), "projects"); }       // ~/.claude/projects
function Uh1() { return join(d8(), "usage-data"); }     // ~/.claude/usage-data
function dh1() { return join(Uh1(), "facets"); }        // ~/.claude/usage-data/facets
function ki8() { return join(Uh1(), "session-meta"); }  // ~/.claude/usage-data/session-meta
```

---

## 5. Metrics Extraction (OAz & Li8)

### Li8 — Extract structured session metadata

Creates a normalized metadata record from a raw session log.

```js
function Li8(session) {
  let metrics = OAz(session);
  let sessionId = o_(session) || "unknown";
  let startTime = session.created.toISOString();
  let durationMinutes = Math.round(
    (session.modified.getTime() - session.created.getTime()) / 1000 / 60
  );

  // Count user and assistant messages
  let userMsgCount = 0, assistantMsgCount = 0;
  for (let msg of session.messages) {
    if (msg.type === "assistant") assistantMsgCount++;
    if (msg.type === "user" && msg.message) {
      let content = msg.message.content;
      let hasText = false;
      if (typeof content === "string" && content.trim()) hasText = true;
      else if (Array.isArray(content)) {
        for (let part of content) {
          if (part.type === "text" && "text" in part) { hasText = true; break; }
        }
      }
      if (hasText) userMsgCount++;
    }
  }

  return {
    session_id: sessionId,
    project_path: session.projectPath || "",
    start_time: startTime,
    duration_minutes: durationMinutes,
    user_message_count: userMsgCount,
    assistant_message_count: assistantMsgCount,
    tool_counts: metrics.toolCounts,
    languages: metrics.languages,
    git_commits: metrics.gitCommits,
    git_pushes: metrics.gitPushes,
    input_tokens: metrics.inputTokens,
    output_tokens: metrics.outputTokens,
    first_prompt: session.firstPrompt || "",
    summary: session.summary,
    user_interruptions: metrics.userInterruptions,
    user_response_times: metrics.userResponseTimes,
    tool_errors: metrics.toolErrors,
    tool_error_categories: metrics.toolErrorCategories,
    uses_task_agent: metrics.usesTaskAgent,
    uses_mcp: metrics.usesMcp,
    uses_web_search: metrics.usesWebSearch,
    uses_web_fetch: metrics.usesWebFetch,
    lines_added: metrics.linesAdded,
    lines_removed: metrics.linesRemoved,
    files_modified: metrics.filesModified.size,
    message_hours: metrics.messageHours,
    user_message_timestamps: metrics.userMessageTimestamps
  };
}
```

### OAz — Detailed metrics extractor

Iterates through all messages in a session to extract 20+ metric categories.

```js
function OAz(session) {
  let toolCounts = {};
  let languages = {};
  let gitCommits = 0, gitPushes = 0;
  let inputTokens = 0, outputTokens = 0;
  let userInterruptions = 0;
  let userResponseTimes = [];
  let toolErrors = 0;
  let toolErrorCategories = {};
  let usesTaskAgent = false;
  let linesAdded = 0, linesRemoved = 0;
  let filesModified = new Set();
  let messageHours = [];
  let userMessageTimestamps = [];
  let usesMcp = false, usesWebSearch = false, usesWebFetch = false;
  let lastAssistantTimestamp = null;

  for (let msg of session.messages) {
    let ts = msg.timestamp;

    // ── Assistant messages ──
    if (msg.type === "assistant" && msg.message) {
      if (ts) lastAssistantTimestamp = ts;

      // Token usage
      let usage = msg.message.usage;
      if (usage) {
        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
      }

      let content = msg.message.content;
      if (Array.isArray(content)) {
        for (let block of content) {
          if (block.type === "tool_use" && "name" in block) {
            let toolName = block.name;

            // Tool usage counting
            toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;

            // Feature detection
            if (toolName === "TaskCreate" || toolName === "TaskAgent")
              usesTaskAgent = true;
            if (toolName.startsWith("mcp__"))
              usesMcp = true;
            if (toolName === "WebSearch")
              usesWebSearch = true;
            if (toolName === "WebFetch")
              usesWebFetch = true;

            let input = block.input;
            if (input) {
              // Language detection from file paths
              let filePath = input.file_path || "";
              if (filePath) {
                let lang = wAz(filePath);   // Map extension → language
                if (lang) languages[lang] = (languages[lang] || 0) + 1;
                if (toolName === "Edit" || toolName === "Write")
                  filesModified.add(filePath);
              }

              // Lines added/removed via diff
              if (toolName === "Edit") {
                let oldStr = input.old_string || "";
                let newStr = input.new_string || "";
                for (let change of diff(oldStr, newStr)) {
                  if (change.added) linesAdded += change.count || 0;
                  if (change.removed) linesRemoved += change.count || 0;
                }
              }
              if (toolName === "Write") {
                let content = input.content || "";
                if (content) linesAdded += content.split("\n").length;
              }

              // Git operation detection
              let command = input.command || "";
              if (command.includes("git commit")) gitCommits++;
              if (command.includes("git push")) gitPushes++;
            }
          }
        }
      }
    }

    // ── User messages ──
    if (msg.type === "user" && msg.message) {
      let content = msg.message.content;
      let hasText = false;

      if (typeof content === "string" && content.trim()) hasText = true;
      else if (Array.isArray(content)) {
        for (let part of content) {
          if (part.type === "text" && "text" in part) { hasText = true; break; }
        }
      }

      if (hasText) {
        // Record message hour for time-of-day chart
        if (ts) {
          try {
            let hour = new Date(ts).getHours();
            messageHours.push(hour);
            userMessageTimestamps.push(ts);
          } catch {}
        }

        // Calculate response time (time from last assistant msg to this user msg)
        if (lastAssistantTimestamp && ts) {
          let assistantTime = new Date(lastAssistantTimestamp).getTime();
          let responseTime = (new Date(ts).getTime() - assistantTime) / 1000;
          if (responseTime > 2 && responseTime < 3600) {
            userResponseTimes.push(responseTime);
          }
        }
      }

      // Tool error categorization
      if (Array.isArray(content)) {
        for (let part of content) {
          if (part.type === "tool_result" && "content" in part) {
            if (part.is_error) {
              toolErrors++;
              let errContent = part.content;
              let category = "Other";
              if (typeof errContent === "string") {
                let lower = errContent.toLowerCase();
                if (lower.includes("exit code"))           category = "Command Failed";
                else if (lower.includes("rejected") ||
                         lower.includes("doesn't want"))   category = "User Rejected";
                else if (lower.includes("string to replace not found") ||
                         lower.includes("no changes"))     category = "Edit Failed";
                else if (lower.includes("modified since read"))
                                                           category = "File Changed";
                else if (lower.includes("exceeds maximum") ||
                         lower.includes("too large"))      category = "File Too Large";
                else if (lower.includes("file not found") ||
                         lower.includes("does not exist")) category = "File Not Found";
              }
              toolErrorCategories[category] = (toolErrorCategories[category] || 0) + 1;
            }
          }
        }
      }

      // User interruption detection
      if (typeof content === "string") {
        if (content.includes("[Request interrupted by user")) userInterruptions++;
      } else if (Array.isArray(content)) {
        for (let part of content) {
          if (part.type === "text" && "text" in part &&
              part.text.includes("[Request interrupted by user")) {
            userInterruptions++;
            break;
          }
        }
      }
    }
  }

  return {
    toolCounts, languages,
    gitCommits, gitPushes,
    inputTokens, outputTokens,
    userInterruptions, userResponseTimes,
    toolErrors, toolErrorCategories,
    usesTaskAgent, usesMcp, usesWebSearch, usesWebFetch,
    linesAdded, linesRemoved, filesModified,
    messageHours, userMessageTimestamps
  };
}
```

### wAz + YAz — File extension to language mapping

```js
const YAz = {
  ".ts": "TypeScript",  ".tsx": "TypeScript",
  ".js": "JavaScript",  ".jsx": "JavaScript",
  ".py": "Python",      ".rb": "Ruby",
  ".go": "Go",          ".rs": "Rust",
  ".java": "Java",      ".md": "Markdown",
  ".json": "JSON",      ".yaml": "YAML",
  ".yml": "YAML",       ".sh": "Shell",
  ".css": "CSS",        ".html": "HTML"
};

function wAz(filePath) {
  let ext = extname(filePath).toLowerCase();
  return YAz[ext] || null;
}
```

---

## 6. Session Text Representation & Summarization

### HAz — Convert session to text

Formats a session log into a human-readable text representation for AI analysis.

```js
function HAz(session) {
  let lines = [];
  let meta = Li8(session);

  lines.push(`Session: ${meta.session_id.slice(0, 8)}`);
  lines.push(`Date: ${meta.start_time}`);
  lines.push(`Project: ${meta.project_path}`);
  lines.push(`Duration: ${meta.duration_minutes} min`);
  lines.push("");

  for (let msg of session.messages) {
    if (msg.type === "user" && msg.message) {
      let content = msg.message.content;
      if (typeof content === "string")
        lines.push(`[User]: ${content.slice(0, 500)}`);
      else if (Array.isArray(content)) {
        for (let part of content)
          if (part.type === "text" && "text" in part)
            lines.push(`[User]: ${part.text.slice(0, 500)}`);
      }
    } else if (msg.type === "assistant" && msg.message) {
      let content = msg.message.content;
      if (Array.isArray(content)) {
        for (let part of content) {
          if (part.type === "text" && "text" in part)
            lines.push(`[Assistant]: ${part.text.slice(0, 300)}`);
          else if (part.type === "tool_use" && "name" in part)
            lines.push(`[Tool: ${part.name}]`);
        }
      }
    }
  }
  return lines.join("\n");
}
```

### DAz — Session summarization for long sessions

If a session's text exceeds 30,000 characters, it's split into 25,000-char chunks
and each chunk is summarized by Claude.

```js
async function DAz(session) {
  let text = HAz(session);

  // Short enough to use directly
  if (text.length <= 30000) return text;

  // Split into chunks and summarize each
  const CHUNK_SIZE = 25000;
  let chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  let summaries = await Promise.all(chunks.map(JAz));
  let meta = Li8(session);

  return [
    `Session: ${meta.session_id.slice(0, 8)}`,
    `Date: ${meta.start_time}`,
    `Project: ${meta.project_path}`,
    `Duration: ${meta.duration_minutes} min`,
    `[Long session - ${chunks.length} parts summarized]`,
    ""
  ].join("\n") + summaries.join("\n\n---\n\n");
}
```

### JAz — Chunk summarization via Claude API

```js
const jAz = `Summarize this portion of a Claude Code session transcript. Focus on:
1. What the user asked for
2. What Claude did (tools used, files modified)
3. Any friction or issues
4. The outcome

Keep it concise - 3-5 sentences. Preserve specific details like file names, error messages, and user feedback.

TRANSCRIPT CHUNK:
`;

async function JAz(chunk) {
  try {
    return (await callClaude({
      systemPrompt: buildSystemPrompt([]),
      userPrompt: jAz + chunk,
      signal: new AbortController().signal,
      options: {
        model: getModel(),          // Current default model
        querySource: "insights",
        agents: [],
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        maxOutputTokensOverride: 500
      }
    })).message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
    || chunk.slice(0, 2000);       // Fallback: truncate
  } catch {
    return chunk.slice(0, 2000);   // Fallback on error
  }
}
```

---

## 7. AI Facet Extraction

### _Az — Facet extraction prompt

```
Analyze this Claude Code session and extract structured facets.

CRITICAL GUIDELINES:

1. **goal_categories**: Count ONLY what the USER explicitly asked for.
   - DO NOT count Claude's autonomous codebase exploration
   - DO NOT count work Claude decided to do on its own
   - ONLY count when user says "can you...", "please...", "I need...", "let's..."

2. **user_satisfaction_counts**: Base ONLY on explicit user signals.
   - "Yay!", "great!", "perfect!" → happy
   - "thanks", "looks good", "that works" → satisfied
   - "ok, now let's..." (continuing without complaint) → likely_satisfied
   - "that's not right", "try again" → dissatisfied
   - "this is broken", "I give up" → frustrated

3. **friction_counts**: Be specific about what went wrong.
   - misunderstood_request: Claude interpreted incorrectly
   - wrong_approach: Right goal, wrong solution method
   - buggy_code: Code didn't work correctly
   - user_rejected_action: User said no/stop to a tool call
   - excessive_changes: Over-engineered or changed too much

4. If very short or just warmup, use warmup_minimal for goal_category
```

### ZAz — Facet extraction caller

```js
async function ZAz(session, sessionId) {
  try {
    let sessionText = await DAz(session);    // Text or summarized text

    let prompt = `${_Az}${sessionText}

RESPOND WITH ONLY A VALID JSON OBJECT matching this schema:
{
  "underlying_goal": "What the user fundamentally wanted to achieve",
  "goal_categories": {"category_name": count, ...},
  "outcome": "fully_achieved|mostly_achieved|partially_achieved|not_achieved|unclear_from_transcript",
  "user_satisfaction_counts": {"level": count, ...},
  "claude_helpfulness": "unhelpful|slightly_helpful|moderately_helpful|very_helpful|essential",
  "session_type": "single_task|multi_task|iterative_refinement|exploration|quick_question",
  "friction_counts": {"friction_type": count, ...},
  "friction_detail": "One sentence describing friction or empty",
  "primary_success": "none|fast_accurate_search|correct_code_edits|good_explanations|proactive_help|multi_file_changes|good_debugging",
  "brief_summary": "One sentence: what user wanted and whether they got it"
}`;

    let response = await callClaude({
      systemPrompt: buildSystemPrompt([]),
      userPrompt: prompt,
      signal: new AbortController().signal,
      options: {
        model: getModel(),
        querySource: "insights",
        agents: [],
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        maxOutputTokensOverride: 4096
      }
    });

    let text = response.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed = JSON.parse(jsonMatch[0]);
    if (!S0q(parsed)) return null;     // Validate schema

    return { ...parsed, session_id: sessionId };
  } catch (err) {
    logError(err instanceof Error ? err : Error("Facet extraction failed"));
    return null;
  }
}
```

### S0q — Facet schema validation

```js
function S0q(obj) {
  if (!obj || typeof obj !== "object") return false;
  return (
    typeof obj.underlying_goal === "string" &&
    typeof obj.outcome === "string" &&
    typeof obj.brief_summary === "string" &&
    obj.goal_categories !== null && typeof obj.goal_categories === "object" &&
    obj.user_satisfaction_counts !== null && typeof obj.user_satisfaction_counts === "object" &&
    obj.friction_counts !== null && typeof obj.friction_counts === "object"
  );
}
```

---

## 8. Statistics Aggregation (fAz)

Aggregates all session metadata and facets into a single stats object for the report.

```js
function fAz(sessions, facetsMap) {
  let stats = {
    total_sessions: sessions.length,
    sessions_with_facets: facetsMap.size,
    date_range: { start: "", end: "" },
    total_messages: 0,
    total_duration_hours: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    tool_counts: {},
    languages: {},
    git_commits: 0,
    git_pushes: 0,
    projects: {},
    goal_categories: {},
    outcomes: {},
    satisfaction: {},
    helpfulness: {},
    session_types: {},
    friction: {},
    success: {},
    session_summaries: [],
    total_interruptions: 0,
    total_tool_errors: 0,
    tool_error_categories: {},
    user_response_times: [],
    median_response_time: 0,
    avg_response_time: 0,
    sessions_using_task_agent: 0,
    sessions_using_mcp: 0,
    sessions_using_web_search: 0,
    sessions_using_web_fetch: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    total_files_modified: 0,
    days_active: 0,
    messages_per_day: 0,
    message_hours: [],
    multi_clauding: { overlap_events: 0, sessions_involved: 0, user_messages_during: 0 }
  };

  let allTimes = [], allResponseTimes = [], allHours = [];

  for (let session of sessions) {
    // Accumulate raw metrics
    allTimes.push(session.start_time);
    stats.total_messages += session.user_message_count;
    stats.total_duration_hours += session.duration_minutes / 60;
    stats.total_input_tokens += session.input_tokens;
    stats.total_output_tokens += session.output_tokens;
    stats.git_commits += session.git_commits;
    stats.git_pushes += session.git_pushes;
    stats.total_interruptions += session.user_interruptions;
    stats.total_tool_errors += session.tool_errors;

    // Merge tool error categories
    for (let [cat, count] of Object.entries(session.tool_error_categories))
      stats.tool_error_categories[cat] = (stats.tool_error_categories[cat] || 0) + count;

    // Feature usage flags
    allResponseTimes.push(...session.user_response_times);
    if (session.uses_task_agent) stats.sessions_using_task_agent++;
    if (session.uses_mcp) stats.sessions_using_mcp++;
    if (session.uses_web_search) stats.sessions_using_web_search++;
    if (session.uses_web_fetch) stats.sessions_using_web_fetch++;

    // Code churn
    stats.total_lines_added += session.lines_added;
    stats.total_lines_removed += session.lines_removed;
    stats.total_files_modified += session.files_modified;
    allHours.push(...session.message_hours);

    // Merge tool counts
    for (let [tool, count] of Object.entries(session.tool_counts))
      stats.tool_counts[tool] = (stats.tool_counts[tool] || 0) + count;

    // Merge language counts
    for (let [lang, count] of Object.entries(session.languages))
      stats.languages[lang] = (stats.languages[lang] || 0) + count;

    // Project frequency
    if (session.project_path)
      stats.projects[session.project_path] = (stats.projects[session.project_path] || 0) + 1;

    // Merge facet-derived metrics
    let facets = facetsMap.get(session.session_id);
    if (facets) {
      for (let [cat, count] of Object.entries(facets.goal_categories || {}))
        if (count > 0) stats.goal_categories[cat] = (stats.goal_categories[cat] || 0) + count;

      stats.outcomes[facets.outcome] = (stats.outcomes[facets.outcome] || 0) + 1;

      for (let [level, count] of Object.entries(facets.user_satisfaction_counts || {}))
        if (count > 0) stats.satisfaction[level] = (stats.satisfaction[level] || 0) + count;

      stats.helpfulness[facets.claude_helpfulness] =
        (stats.helpfulness[facets.claude_helpfulness] || 0) + 1;
      stats.session_types[facets.session_type] =
        (stats.session_types[facets.session_type] || 0) + 1;

      for (let [type, count] of Object.entries(facets.friction_counts || {}))
        if (count > 0) stats.friction[type] = (stats.friction[type] || 0) + count;

      if (facets.primary_success !== "none")
        stats.success[facets.primary_success] =
          (stats.success[facets.primary_success] || 0) + 1;
    }

    // Session summaries (max 50)
    if (stats.session_summaries.length < 50) {
      stats.session_summaries.push({
        id: session.session_id.slice(0, 8),
        date: session.start_time.split("T")[0] || "",
        summary: session.summary || session.first_prompt.slice(0, 100),
        goal: facets?.underlying_goal
      });
    }
  }

  // Date range
  allTimes.sort();
  stats.date_range.start = allTimes[0]?.split("T")[0] || "";
  stats.date_range.end = allTimes[allTimes.length - 1]?.split("T")[0] || "";

  // Response time statistics
  stats.user_response_times = allResponseTimes;
  if (allResponseTimes.length > 0) {
    let sorted = [...allResponseTimes].sort((a, b) => a - b);
    stats.median_response_time = sorted[Math.floor(sorted.length / 2)] || 0;
    stats.avg_response_time = allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length;
  }

  // Activity metrics
  let uniqueDays = new Set(allTimes.map((t) => t.split("T")[0]));
  stats.days_active = uniqueDays.size;
  stats.messages_per_day = stats.days_active > 0
    ? Math.round(stats.total_messages / stats.days_active * 10) / 10
    : 0;

  stats.message_hours = allHours;
  stats.multi_clauding = GAz(sessions);

  return stats;
}
```

---

## 9. Multi-Clauding Detection (GAz)

Detects overlapping concurrent Claude Code sessions using a 30-minute sliding window.

```js
function GAz(sessions) {
  // Collect all user message timestamps across all sessions
  let allEvents = [];
  for (let session of sessions) {
    for (let ts of session.user_message_timestamps) {
      try {
        let time = new Date(ts).getTime();
        allEvents.push({ ts: time, sessionId: session.session_id });
      } catch {}
    }
  }
  allEvents.sort((a, b) => a.ts - b.ts);

  let overlapPairs = new Set();     // "sessionA:sessionB" pairs
  let overlapMessages = new Set();  // "timestamp:sessionId" during overlap
  let windowStart = 0;
  let lastSeen = new Map();         // sessionId → last index in allEvents

  for (let i = 0; i < allEvents.length; i++) {
    let event = allEvents[i];

    // Shrink window: remove events older than 30 minutes
    while (windowStart < i && event.ts - allEvents[windowStart].ts > 1800000) {
      let old = allEvents[windowStart];
      if (lastSeen.get(old.sessionId) === windowStart)
        lastSeen.delete(old.sessionId);
      windowStart++;
    }

    // Check for overlap with different sessions in window
    let prevIdx = lastSeen.get(event.sessionId);
    if (prevIdx !== undefined) {
      for (let j = prevIdx + 1; j < i; j++) {
        let other = allEvents[j];
        if (other.sessionId !== event.sessionId) {
          // Found overlap!
          let pairKey = [event.sessionId, other.sessionId].sort().join(":");
          overlapPairs.add(pairKey);
          overlapMessages.add(`${allEvents[prevIdx].ts}:${event.sessionId}`);
          overlapMessages.add(`${other.ts}:${other.sessionId}`);
          overlapMessages.add(`${event.ts}:${event.sessionId}`);
          break;
        }
      }
    }
    lastSeen.set(event.sessionId, i);
  }

  // Count unique sessions involved
  let sessionsInvolved = new Set();
  for (let pair of overlapPairs) {
    let [a, b] = pair.split(":");
    if (a) sessionsInvolved.add(a);
    if (b) sessionsInvolved.add(b);
  }

  return {
    overlap_events: overlapPairs.size,
    sessions_involved: sessionsInvolved.size,
    user_messages_during: overlapMessages.size
  };
}
```

---

## 10. AI Insight Generation (7+1 Tasks)

### TAz — 7 Analysis Task Definitions

Each task is sent to Claude in parallel with the aggregated stats data.

```js
const TAz = [
  // ── 1. Project Areas ──
  {
    name: "project_areas",
    prompt: `Analyze this Claude Code usage data and identify project areas.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "areas": [
    {"name": "Area name", "session_count": N,
     "description": "2-3 sentences about what was worked on and how Claude Code was used."}
  ]
}

Include 4-5 areas. Skip internal CC operations.`,
    maxTokens: 8192
  },

  // ── 2. Interaction Style ──
  {
    name: "interaction_style",
    prompt: `Analyze this Claude Code usage data and describe the user's interaction style.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "narrative": "2-3 paragraphs analyzing HOW the user interacts with Claude Code.
                Use second person 'you'. Describe patterns: iterate quickly vs
                detailed upfront specs? Interrupt often or let Claude run?
                Include specific examples. Use **bold** for key insights.",
  "key_pattern": "One sentence summary of most distinctive interaction style"
}`,
    maxTokens: 8192
  },

  // ── 3. What Works ──
  {
    name: "what_works",
    prompt: `Analyze this Claude Code usage data and identify what's working well
for this user. Use second person ("you").

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence of context",
  "impressive_workflows": [
    {"title": "Short title (3-6 words)",
     "description": "2-3 sentences describing the impressive workflow or approach.
                     Use 'you' not 'the user'."}
  ]
}

Include 3 impressive workflows.`,
    maxTokens: 8192
  },

  // ── 4. Friction Analysis ──
  {
    name: "friction_analysis",
    prompt: `Analyze this Claude Code usage data and identify friction points
for this user. Use second person ("you").

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence summarizing friction patterns",
  "categories": [
    {"category": "Concrete category name",
     "description": "1-2 sentences explaining this category and what could be done
                     differently. Use 'you' not 'the user'.",
     "examples": ["Specific example with consequence", "Another example"]}
  ]
}

Include 3 friction categories with 2 examples each.`,
    maxTokens: 8192
  },

  // ── 5. Suggestions ──
  {
    name: "suggestions",
    prompt: `Analyze this Claude Code usage data and suggest improvements.

## CC FEATURES REFERENCE (pick from these for features_to_try):
1. **MCP Servers**: Connect Claude to external tools, databases, and APIs via Model Context Protocol.
   - How to use: Run \`claude mcp add <server-name> -- <command>\`
   - Good for: database queries, Slack integration, GitHub issue lookup, connecting to internal APIs

2. **Custom Skills**: Reusable prompts you define as markdown files that run with a single /command.
   - How to use: Create \`.claude/skills/commit/SKILL.md\` with instructions. Then type \`/commit\` to run it.
   - Good for: repetitive workflows - /commit, /review, /test, /deploy, /pr, or complex multi-step workflows

3. **Hooks**: Shell commands that auto-run at specific lifecycle events.
   - How to use: Add to \`.claude/settings.json\` under "hooks" key.
   - Good for: auto-formatting code, running type checks, enforcing conventions

4. **Headless Mode**: Run Claude non-interactively from scripts and CI/CD.
   - How to use: \`claude -p "fix lint errors" --allowedTools "Edit,Read,Bash"\`
   - Good for: CI/CD integration, batch code fixes, automated reviews

5. **Task Agents**: Claude spawns focused sub-agents for complex exploration or parallel work.
   - How to use: Claude auto-invokes when helpful, or ask "use an agent to explore X"
   - Good for: codebase exploration, understanding complex systems

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "claude_md_additions": [
    {"addition": "A specific line or block to add to CLAUDE.md based on workflow patterns.",
     "why": "1 sentence explaining why",
     "prompt_scaffold": "Instructions for where to add this in CLAUDE.md"}
  ],
  "features_to_try": [
    {"feature": "Feature name from CC FEATURES REFERENCE above",
     "one_liner": "What it does",
     "why_for_you": "Why this would help YOU based on your sessions",
     "example_code": "Actual command or config to copy"}
  ],
  "usage_patterns": [
    {"title": "Short title",
     "suggestion": "1-2 sentence summary",
     "detail": "3-4 sentences explaining how this applies to YOUR work",
     "copyable_prompt": "A specific prompt to copy and try"}
  ]
}

IMPORTANT for claude_md_additions: PRIORITIZE instructions that appear MULTIPLE TIMES
in the user data. If user told Claude the same thing in 2+ sessions, that's a PRIME
candidate - they shouldn't have to repeat themselves.

IMPORTANT for features_to_try: Pick 2-3 from the CC FEATURES REFERENCE above.
Include 2-3 items for each category.`,
    maxTokens: 8192
  },

  // ── 6. On the Horizon ──
  {
    name: "on_the_horizon",
    prompt: `Analyze this Claude Code usage data and identify future opportunities.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "intro": "1 sentence about evolving AI-assisted development",
  "opportunities": [
    {"title": "Short title (4-8 words)",
     "whats_possible": "2-3 ambitious sentences about autonomous workflows",
     "how_to_try": "1-2 sentences mentioning relevant tooling",
     "copyable_prompt": "Detailed prompt to try"}
  ]
}

Include 3 opportunities. Think BIG - autonomous workflows, parallel agents, iterating against tests.`,
    maxTokens: 8192
  },

  // (empty spread placeholder in original code: ...[])

  // ── 7. Fun Ending ──
  {
    name: "fun_ending",
    prompt: `Analyze this Claude Code usage data and find a memorable moment.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "headline": "A memorable QUALITATIVE moment from the transcripts - not a statistic.
               Something human, funny, or surprising.",
  "detail": "Brief context about when/where this happened"
}

Find something genuinely interesting or amusing from the session summaries.`,
    maxTokens: 8192
  }
];
```

### vAz — Run all 7+1 analysis tasks

```js
async function vAz(stats, facetsMap) {
  // Prepare input data summaries
  let sessionSummaries = Array.from(facetsMap.values())
    .slice(0, 50)
    .map((f) => `- ${f.brief_summary} (${f.outcome}, ${f.claude_helpfulness})`)
    .join("\n");

  let frictionDetails = Array.from(facetsMap.values())
    .filter((f) => f.friction_detail)
    .slice(0, 20)
    .map((f) => `- ${f.friction_detail}`)
    .join("\n");

  let userInstructions = Array.from(facetsMap.values())
    .flatMap((f) => f.user_instructions_to_claude || [])
    .slice(0, 15)
    .map((i) => `- ${i}`)
    .join("\n");

  // Build main data string
  let dataString = JSON.stringify({
    sessions: stats.total_sessions,
    analyzed: stats.sessions_with_facets,
    date_range: stats.date_range,
    messages: stats.total_messages,
    hours: Math.round(stats.total_duration_hours),
    commits: stats.git_commits,
    top_tools: Object.entries(stats.tool_counts).sort((a, b) => b[1] - a[1]).slice(0, 8),
    top_goals: Object.entries(stats.goal_categories).sort((a, b) => b[1] - a[1]).slice(0, 8),
    outcomes: stats.outcomes,
    satisfaction: stats.satisfaction,
    friction: stats.friction,
    success: stats.success,
    languages: stats.languages
  }, null, 2)
  + `\n\nSESSION SUMMARIES:\n${sessionSummaries}`
  + `\n\nFRICTION DETAILS:\n${frictionDetails}`
  + `\n\nUSER INSTRUCTIONS TO CLAUDE:\n${userInstructions || "None captured"}`;

  // Run all 7 tasks in parallel
  let results = await Promise.all(TAz.map((task) => L0q(task, dataString)));

  let insights = {};
  for (let { name, result } of results) {
    if (result) insights[name] = result;
  }

  // Build At-a-Glance task using results from the 7 tasks
  let projectAreas = insights.project_areas?.areas
    ?.map((a) => `- ${a.name}: ${a.description}`).join("\n") || "";
  let bigWins = insights.what_works?.impressive_workflows
    ?.map((w) => `- ${w.title}: ${w.description}`).join("\n") || "";
  let frictionCats = insights.friction_analysis?.categories
    ?.map((c) => `- ${c.category}: ${c.description}`).join("\n") || "";
  let features = insights.suggestions?.features_to_try
    ?.map((f) => `- ${f.feature}: ${f.one_liner}`).join("\n") || "";
  let patterns = insights.suggestions?.usage_patterns
    ?.map((p) => `- ${p.title}: ${p.suggestion}`).join("\n") || "";
  let horizon = insights.on_the_horizon?.opportunities
    ?.map((o) => `- ${o.title}: ${o.whats_possible}`).join("\n") || "";

  // At-a-Glance synthesis task
  let atAGlanceTask = {
    name: "at_a_glance",
    prompt: `You're writing an "At a Glance" summary for a Claude Code usage insights report.
The goal is to help users understand their usage and improve how they use Claude better.

Use this 4-part structure:

1. **What's working** - What is the user's unique style of interacting with Claude
   and what are some impactful things they've done? Keep it high level. Don't be fluffy
   or overly complimentary. Don't focus on tool calls.

2. **What's hindering you** - Split into (a) Claude's fault (misunderstandings, wrong
   approaches, bugs) and (b) user-side friction (not providing enough context, environment
   issues). Be honest but constructive.

3. **Quick wins to try** - Specific Claude Code features they could try from the examples
   below, or a workflow technique if really compelling. (Avoid stuff like "Ask Claude to
   confirm before taking actions" which are less compelling.)

4. **Ambitious workflows for better models** - As models improve over the next 3-6 months,
   what workflows that seem impossible now will become possible?

Keep each section to 2-3 sentences. Use a coaching tone.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "whats_working": "...",
  "whats_hindering": "...",
  "quick_wins": "...",
  "ambitious_workflows": "..."
}

SESSION DATA:
${dataString}

## Project Areas
${projectAreas}

## Big Wins
${bigWins}

## Friction Categories
${frictionCats}

## Features to Try
${features}

## Usage Patterns to Adopt
${patterns}

## On the Horizon
${horizon}`,
    maxTokens: 8192
  };

  let atAGlanceResult = await L0q(atAGlanceTask, "");
  if (atAGlanceResult.result) insights.at_a_glance = atAGlanceResult.result;

  return insights;
}
```

### L0q — Generic AI analysis caller

```js
async function L0q(task, data) {
  try {
    let response = await callClaude({
      systemPrompt: buildSystemPrompt([]),
      userPrompt: task.prompt + "\n\nDATA:\n" + data,
      signal: new AbortController().signal,
      options: {
        model: getAnalysisModel(),     // Same as default model
        querySource: "insights",
        agents: [],
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        maxOutputTokensOverride: task.maxTokens
      }
    });

    let text = response.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (text) {
      let jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return { name: task.name, result: JSON.parse(jsonMatch[0]) };
        } catch {
          return { name: task.name, result: null };
        }
      }
    }
    return { name: task.name, result: null };
  } catch (err) {
    logError(err instanceof Error ? err : Error(`${task.name} failed`));
    return { name: task.name, result: null };
  }
}
```

---

## 11. HTML Report Generation (LAz)

The `LAz` function generates a self-contained HTML page (~40KB) with:

### Report Structure

| Section | HTML ID | Source Data |
|---------|---------|-------------|
| At a Glance | (top card) | `insights.at_a_glance` |
| What You Work On | `section-work` | `insights.project_areas` |
| Goals Chart + Top Tools | (charts row) | `stats.goal_categories` + `stats.tool_counts` |
| Languages + Session Types | (charts row) | `stats.languages` + `stats.session_types` |
| How You Use Claude Code | `section-usage` | `insights.interaction_style` |
| Response Time Distribution | (chart) | `stats.user_response_times` |
| Multi-Clauding | (stat card) | `stats.multi_clauding` |
| Time of Day + Tool Errors | (charts row) | `stats.message_hours` + `stats.tool_error_categories` |
| Impressive Things You Did | `section-wins` | `insights.what_works` |
| What Helped Most + Outcomes | (charts row) | `stats.success` + `stats.outcomes` |
| Where Things Go Wrong | `section-friction` | `insights.friction_analysis` |
| Friction Types + Satisfaction | (charts row) | `stats.friction` + `stats.satisfaction` |
| Features to Try | `section-features` | `insights.suggestions` |
| Usage Patterns | `section-patterns` | `insights.suggestions.usage_patterns` |
| On the Horizon | `section-horizon` | `insights.on_the_horizon` |
| Fun Ending | (bottom card) | `insights.fun_ending` |

### Chart Rendering Helpers

```js
// Horizontal bar chart
function Ui(data, color, maxBars = 6, orderArray) {
  let entries;
  if (orderArray)
    entries = orderArray.filter((k) => k in data && (data[k] ?? 0) > 0)
                        .map((k) => [k, data[k] ?? 0]);
  else
    entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, maxBars);

  if (entries.length === 0) return '<p class="empty">No data</p>';

  let max = Math.max(...entries.map((e) => e[1]));
  return entries.map(([key, value]) => {
    let pct = (value / max) * 100;
    let label = zAz[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `<div class="bar-row">
      <div class="bar-label">${escape(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="bar-value">${value}</div>
    </div>`;
  }).join("\n");
}

// Response time histogram (bucketized)
function kAz(responseTimes) {
  if (responseTimes.length === 0) return '<p class="empty">No response time data</p>';

  let buckets = {
    "2-10s": 0, "10-30s": 0, "30s-1m": 0,
    "1-2m": 0, "2-5m": 0, "5-15m": 0, ">15m": 0
  };
  for (let t of responseTimes) {
    if (t < 10) buckets["2-10s"]++;
    else if (t < 30) buckets["10-30s"]++;
    else if (t < 60) buckets["30s-1m"]++;
    else if (t < 120) buckets["1-2m"]++;
    else if (t < 300) buckets["2-5m"]++;
    else if (t < 900) buckets["5-15m"]++;
    else buckets[">15m"]++;
  }
  // ... renders as bar chart with #6366f1 (indigo) color
}

// Time-of-day chart (4 periods)
function EAz(hours) {
  let periods = [
    { label: "Morning (6-12)",   range: [6,7,8,9,10,11] },
    { label: "Afternoon (12-18)", range: [12,13,14,15,16,17] },
    { label: "Evening (18-24)",  range: [18,19,20,21,22,23] },
    { label: "Night (0-6)",     range: [0,1,2,3,4,5] }
  ];
  // ... counts per period and renders bars with #8b5cf6 (purple) color
}
```

### Embedded JavaScript

The HTML report includes interactive JavaScript for:

1. **`toggleCollapsible(header)`** — Expand/collapse sections
2. **`copyText(btn)`** — Copy text content to clipboard
3. **`copyCmdItem(idx)`** — Copy a specific command item
4. **`copyAllCheckedClaudeMd()`** — Copy all checked CLAUDE.md suggestions
5. **`updateHourHistogram(offsetFromPT)`** — Re-render time chart with timezone offset

### Ordering Constants

```js
const NAz = ["frustrated", "dissatisfied", "likely_satisfied", "satisfied", "happy", "unsure"];
const VAz = ["not_achieved", "partially_achieved", "mostly_achieved", "fully_achieved", "unclear_from_transcript"];
```

---

## 12. Caching Layer

Two-tier caching under `~/.claude/usage-data/`:

### Session Metadata Cache (`session-meta/`)

```js
// Read cached session metadata
async function PAz(sessionId) {
  let path = join(ki8(), `${sessionId}.json`);
  try {
    let data = await readFile(path, { encoding: "utf-8" });
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Write session metadata to cache
async function WAz(sessionMeta) {
  try { await mkdir(ki8(), { recursive: true }); } catch {}
  let path = join(ki8(), `${sessionMeta.session_id}.json`);
  await writeFile(path, JSON.stringify(sessionMeta, null, 2), {
    encoding: "utf-8",
    mode: 0o600    // Owner read/write only
  });
}
```

### Facets Cache (`facets/`)

```js
// Read cached facets (with validation)
async function MAz(sessionId) {
  let path = join(dh1(), `${sessionId}.json`);
  try {
    let data = await readFile(path, { encoding: "utf-8" });
    let parsed = JSON.parse(data);
    if (!S0q(parsed)) {
      // Invalid cache — delete it
      try { await unlink(path); } catch {}
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Write facets to cache
async function XAz(facets) {
  try { await mkdir(dh1(), { recursive: true }); } catch {}
  let path = join(dh1(), `${facets.session_id}.json`);
  await writeFile(path, JSON.stringify(facets, null, 2), {
    encoding: "utf-8",
    mode: 0o600
  });
}
```

---

## 13. Complete Data Flow Diagram

```
~/.claude/projects/
  ├── project-a/
  │   ├── session-abc123.jsonl
  │   └── session-def456.jsonl
  └── project-b/
      └── session-ghi789.jsonl

          │
          ▼ RAz() + or6()
  ┌─────────────────────┐
  │ Session File Index   │  [{sessionId, path, mtime, size}, ...]
  └─────────┬───────────┘
            │
            ▼ Check PAz() cache
  ┌─────────────────────┐     ┌──────────────────────┐
  │ Cached session-meta │◄────│ ~/.claude/usage-data/ │
  │ (skip processing)   │     │   session-meta/*.json │
  └─────────┬───────────┘     └──────────────────────┘
            │
            ▼ lh1() + Li8() + OAz() for uncached (max 200)
  ┌─────────────────────┐
  │ Session Metadata     │  {session_id, tool_counts, languages,
  │                      │   git_commits, tokens, response_times,
  │                      │   lines_added/removed, ...}
  └─────────┬───────────┘
            │ WAz() → cache
            │
            ▼ Deduplicate + Filter (≥2 msgs, ≥1 min)
  ┌─────────────────────┐
  │ Viable Sessions      │
  └─────────┬───────────┘
            │
            ▼ Check MAz() cache
  ┌─────────────────────┐     ┌──────────────────────┐
  │ Cached facets        │◄────│ ~/.claude/usage-data/ │
  │ (skip extraction)    │     │   facets/*.json       │
  └─────────┬───────────┘     └──────────────────────┘
            │
            ▼ ZAz() → Claude AI for uncached (max 50)
  ┌─────────────────────┐
  │ Semantic Facets      │  {underlying_goal, goal_categories,
  │                      │   outcome, satisfaction, friction,
  │                      │   helpfulness, session_type, ...}
  └─────────┬───────────┘
            │ XAz() → cache
            │
            ▼ Filter out warmup_minimal
            │
            ▼ fAz() + GAz()
  ┌─────────────────────┐
  │ Aggregated Stats     │  20+ merged metric categories
  │ + Multi-Clauding     │  + parallel session detection
  └─────────┬───────────┘
            │
            ▼ vAz() → 7 parallel Claude AI calls
  ┌─────────────────────────────────────────────┐
  │ project_areas │ interaction_style │ what_works │
  │ friction_analysis │ suggestions │ on_horizon  │
  │ fun_ending                                    │
  └─────────────────────┬─────────────────────────┘
                        │
                        ▼ at_a_glance (synthesis of above 7)
  ┌─────────────────────┐
  │ Complete Insights    │  {at_a_glance, project_areas,
  │                      │   interaction_style, what_works,
  │                      │   friction_analysis, suggestions,
  │                      │   on_the_horizon, fun_ending}
  └─────────┬───────────┘
            │
            ▼ LAz()
  ┌─────────────────────┐
  │ report.html          │  Self-contained HTML with
  │ (~40KB)              │  CSS, charts, interactive JS
  └─────────────────────┘
            │
            ▼ Write to ~/.claude/usage-data/report.html
```

---

## 14. Key Constants & Limits

| Constant | Value | Purpose |
|----------|-------|---------|
| Session-meta batch size | 50 | Files checked per batch for cache |
| Max uncached session loads | 200 | Cap on raw JSONL files to parse |
| Session load batch | 10 | Files loaded concurrently |
| Max facet extractions | 50 | Cap on AI facet calls per run |
| Facet batch size | 50 | Facets extracted concurrently |
| Session text threshold | 30,000 chars | Above this, split into chunks |
| Chunk size | 25,000 chars | Each chunk for summarization |
| Chunk summary max tokens | 500 | Claude output limit for chunk summary |
| Facet extraction max tokens | 4,096 | Claude output limit for facets |
| Analysis task max tokens | 8,192 | Claude output limit per analysis task |
| Session summaries cap | 50 | Max summaries in stats object |
| Session summaries for AI | 50 | Max facets fed to analysis prompts |
| Friction details for AI | 20 | Max friction items fed to analysis |
| User instructions for AI | 15 | Max user instruction items |
| Minimum user messages | 2 | Session viability filter |
| Minimum duration | 1 min | Session viability filter |
| Multi-clauding window | 30 min (1,800,000ms) | Sliding window for overlap detection |
| Response time range | 2s - 3600s | Valid user response time bounds |
| File permission | 0o600 (384) | Owner read/write only for cache files |
| Top tools shown | 8 | In analysis data summary |
| Top goals shown | 8 | In analysis data summary |
| Bar chart default max | 6 | Bars shown in HTML charts |

### AI Call Configuration

All AI calls share these parameters:
- `querySource: "insights"` — Telemetry tagging
- `isNonInteractiveSession: true` — Non-interactive mode
- `hasAppendSystemPrompt: false`
- `mcpTools: []` — No MCP tools available
- `agents: []` — No sub-agents

Total AI calls per `/insights` run:
- Up to **200** chunk summarizations (for long sessions, 500 tokens each)
- Up to **50** facet extractions (4,096 tokens each)
- **7** analysis tasks (8,192 tokens each)
- **1** at-a-glance synthesis (8,192 tokens)
- **Total potential**: up to **258** Claude API calls per run
