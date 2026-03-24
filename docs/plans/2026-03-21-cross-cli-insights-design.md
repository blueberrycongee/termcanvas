# Cross-CLI Insights Design

## Overview

A multi-stage AI-powered analysis pipeline that scans all CLI tool session logs (Claude, Codex, extensible to others), extracts structured facets per session, aggregates statistics, and generates an HTML insights report. Modeled after Claude Code's `/insights` command but operating at a higher level across multiple CLI tools.

## Architecture: Pipeline A (Multi-Stage with Facet Caching)

```
Scan sessions → Filter → Extract facets (AI, per session, cached)
    → Aggregate stats (code) → 5x AI insight rounds → HTML report
```

## 1. Data Layer: Session Collection & Facet Extraction

### Session Scanning

Reuse existing `findClaudeJsonlFiles()` and `findCodexJsonlFiles()` from `electron/usage-collector.ts`, but read full session content (not just token data) for AI analysis.

### Session Filtering

- Messages < 2 → skip
- Duration < 1 minute → skip

### Session Summary Extraction

For each session JSONL file, extract a text summary of the conversation:
- Claude: parse `message.content` fields from assistant/human turns
- Codex: parse `event_msg` payloads with relevant content

Truncate each session summary to ~4000 chars to stay within CLI context limits.

### Facet Schema

```typescript
interface SessionFacet {
  session_id: string;
  cli_tool: "claude" | "codex";
  underlying_goal: string;
  brief_summary: string;
  goal_categories: Record<string, number>;
  outcome: "fully_achieved" | "mostly_achieved" | "partially_achieved" | "not_achieved" | "unclear";
  session_type: "single_task" | "multi_task" | "iterative" | "exploratory" | "quick_question";
  friction_counts: Record<string, number>;
  user_satisfaction: "high" | "medium" | "low" | "unclear";
  project_path: string;
}
```

### Facet Cache

- Location: `~/.termcanvas/insights-cache/facets/{session_id}.json`
- Already-analyzed sessions are never re-analyzed
- Cache invalidation: none needed (session logs are immutable once written)

## 2. Analysis Engine: CLI Process Invocation

### New Module: `electron/insights-engine.ts`

### CLI Invocation

```bash
echo "<prompt>" | claude --print        # Claude non-interactive mode
echo "<prompt>" | codex --quiet         # Codex non-interactive mode
```

User selects which CLI to use for analysis via UI dropdown.

### Pre-flight Validation

Before starting analysis:
1. Check CLI binary exists (`which claude` / `which codex`)
2. Run a simple test prompt to verify auth/login state
3. On failure, return specific error to frontend:
   - CLI not installed
   - Not logged in / auth expired
   - API key invalid
   - Network error
   - Other (raw stderr)

**All errors must be surfaced to the user — never silently swallowed.**

### Processing Pipeline

Batch size: 10 concurrent CLI calls for facet extraction.

1. **Facet extraction**: each session → one CLI call → JSON facet → cache to disk
2. **Aggregation**: code-level stats across all facets
3. **5x AI insight rounds** (sequential CLI calls):
   - Project areas / work domains
   - Interaction style analysis
   - Success cases (what works well)
   - Friction analysis (where things go wrong)
   - Improvement suggestions
4. **At a Glance summary**: one final CLI call producing the overview

### Prompt Design

Facet extraction prompt instructs the AI to:
- Read the session transcript
- Output ONLY a valid JSON object matching the facet schema
- Categorize the session objectively

Insight round prompts receive aggregated stats + sample facets and produce structured analysis text.

## 3. Report Generation: HTML Output

### New Module: `electron/insights-report.ts`

### Output

- File: `~/.termcanvas/insights-reports/insights-{timestamp}.html`
- Auto-opened in system default browser via `shell.openExternal()`

### Report Sections

1. **At a Glance** — high-level summary
2. **CLI Tool Comparison** — Claude vs Codex usage distribution, success rates, friction rates
3. **What You Work On** — project areas and goal categories
4. **How You Use These Tools** — interaction style, session types
5. **What Works Well** — successful workflows and patterns
6. **Where Things Go Wrong** — friction points with examples
7. **Suggestions** — actionable improvements

### Styling

- Dark theme consistent with TermCanvas aesthetic
- Progress bars, charts where applicable
- Responsive layout
- Self-contained (inline CSS, no external dependencies)

## 4. Frontend UI

### Entry Point

Add "Generate Insights" button at the bottom of the existing `UsagePanel.tsx`.

### Interaction Flow

1. Click button → dropdown: "Analyze with Claude" / "Analyze with Codex"
2. Pre-flight CLI validation → on failure, show error message in UI
3. Progress indicator: "Scanning sessions..." → "Analyzing 12/48..." → "Generating report..."
4. On completion: auto-open HTML + show "Report generated" with file path in UI

### Error Display

CLI errors (auth, network, etc.) shown as a dismissible notification/banner in the UsagePanel with the raw error message.

## 5. IPC Interface

```typescript
// Renderer → Main
ipcMain.handle("insights:generate", async (_event, cliTool: "claude" | "codex") =>
  Promise<{ ok: true; reportPath: string } | { ok: false; error: string }>
);

// Main → Renderer (progress events)
mainWindow.webContents.send("insights:progress", {
  stage: "extracting_facets" | "aggregating" | "analyzing" | "generating_report",
  current: number,
  total: number,
  message: string
});
```

## 6. File Structure

```
electron/
  insights-engine.ts      # Core pipeline: scan, filter, extract, analyze
  insights-report.ts      # HTML report generation
  usage-collector.ts       # (existing) reuse session file discovery
src/
  components/
    UsagePanel.tsx          # (existing) add insights button
    usage/
      InsightsButton.tsx    # New: button + CLI selector + progress + error display
```

## 7. MVP Scope

- CLI tools: Claude and Codex only
- Analysis via spawned CLI process (no API keys needed)
- Facet caching for incremental speed
- Single HTML report output
- Error transparency for all CLI failures

## 8. Future Extensions

- Add Kimi, Gemini, OpenCode session parsing as their log formats are understood
- Trend analysis across time periods
- In-app report rendering (instead of external HTML)
- Comparative insights between CLI tools
