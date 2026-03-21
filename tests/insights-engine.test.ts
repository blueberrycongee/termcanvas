import test from "node:test";
import assert from "node:assert/strict";

import { buildCliInvocationArgs } from "../electron/insights-cli.ts";
import {
  aggregateFacets,
  buildDeterministicAtAGlance,
  buildTranscriptWindow,
  buildSessionFingerprint,
  isSelfInsightSession,
  parseStructuredSection,
  type SessionFacet,
  type SessionInfo,
} from "../electron/insights-shared.ts";

test("buildCliInvocationArgs keeps Claude insights invocations unchanged", () => {
  assert.deepEqual(
    buildCliInvocationArgs([], "claude", "Reply with exactly: OK"),
    ["-p", "Reply with exactly: OK"],
  );
});

test("buildCliInvocationArgs skips the git repo check for Codex insights runs", () => {
  assert.deepEqual(
    buildCliInvocationArgs([], "codex", "Reply with exactly: OK"),
    ["exec", "--skip-git-repo-check", "Reply with exactly: OK"],
  );
});

test("buildCliInvocationArgs preserves launcher wrapper args", () => {
  assert.deepEqual(
    buildCliInvocationArgs(
      ["/d", "/s", "/c", "codex.cmd"],
      "codex",
      "Reply with exactly: OK",
    ),
    [
      "/d",
      "/s",
      "/c",
      "codex.cmd",
      "exec",
      "--skip-git-repo-check",
      "Reply with exactly: OK",
    ],
  );
});

test("buildSessionFingerprint changes when source metadata changes", () => {
  const base = {
    id: "session-1",
    filePath: "/tmp/session-1.jsonl",
    cliTool: "codex" as const,
    projectPath: "/tmp/project",
    messageCount: 4,
    durationMinutes: 3,
    contentSummary: "user: hello",
    mtimeMs: 1000,
    fileSize: 200,
  };

  const first = buildSessionFingerprint(base);
  const changedMtime = buildSessionFingerprint({ ...base, mtimeMs: 2000 });
  const changedCli = buildSessionFingerprint({ ...base, cliTool: "claude" });

  assert.notEqual(first, changedMtime);
  assert.notEqual(first, changedCli);
});

test("isSelfInsightSession detects insight control prompts", () => {
  assert.equal(
    isSelfInsightSession(
      "Analyze this AI coding session and return a JSON object with exactly these fields:",
    ),
    true,
  );
  assert.equal(
    isSelfInsightSession("RESPOND WITH ONLY A VALID JSON OBJECT matching this schema:"),
    true,
  );
  assert.equal(isSelfInsightSession("user: fix the login bug"), false);
});

test("aggregateFacets reports analyzed totals and preserves pipeline counts", () => {
  const sessions: SessionInfo[] = [
    {
      id: "a",
      filePath: "/tmp/a.jsonl",
      cliTool: "codex",
      projectPath: "/tmp/project-a",
      startTimeMs: 1_000,
      endTimeMs: 721_000,
      messageCount: 10,
      durationMinutes: 12,
      contentSummary: "",
      analysisText: "",
      mtimeMs: 30,
      fileSize: 300,
      metrics: {
        toolCounts: { exec_command: 5, apply_patch: 2 },
        languages: { typescript: 3 },
        modelCounts: { "gpt-5.2": 1 },
        inputTokens: 1_000,
        outputTokens: 400,
        cachedInputTokens: 100,
        reasoningTokens: 80,
        gitCommits: 1,
        gitPushes: 0,
        filesModified: 4,
        linesAdded: 80,
        linesRemoved: 20,
        toolErrorCategories: { shell: 1 },
        assistantResponseSeconds: [30, 45],
        userReplySeconds: [120],
        userInterruptions: 1,
        messageHours: { "09": 6, "10": 4 },
        featureUsage: { apply_patch: 1, plan_updates: 1 },
      },
    },
    {
      id: "b",
      filePath: "/tmp/b.jsonl",
      cliTool: "codex",
      projectPath: "/tmp/project-b",
      startTimeMs: 2_000,
      endTimeMs: 362_000,
      messageCount: 4,
      durationMinutes: 6,
      contentSummary: "",
      analysisText: "",
      mtimeMs: 20,
      fileSize: 200,
      metrics: {
        toolCounts: { exec_command: 2 },
        languages: { markdown: 1, json: 1 },
        modelCounts: { "gpt-5.2": 1 },
        inputTokens: 600,
        outputTokens: 250,
        cachedInputTokens: 0,
        reasoningTokens: 40,
        gitCommits: 0,
        gitPushes: 1,
        filesModified: 2,
        linesAdded: 10,
        linesRemoved: 3,
        toolErrorCategories: {},
        assistantResponseSeconds: [20],
        userReplySeconds: [90, 60],
        userInterruptions: 0,
        messageHours: { "11": 4 },
        featureUsage: { shell: 1 },
      },
    },
    {
      id: "c",
      filePath: "/tmp/c.jsonl",
      cliTool: "codex",
      projectPath: "/tmp/project-c",
      startTimeMs: 3_000,
      endTimeMs: 543_000,
      messageCount: 8,
      durationMinutes: 9,
      contentSummary: "",
      analysisText: "",
      mtimeMs: 10,
      fileSize: 100,
      metrics: {
        toolCounts: {},
        languages: {},
        modelCounts: {},
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        gitCommits: 0,
        gitPushes: 0,
        filesModified: 0,
        linesAdded: 0,
        linesRemoved: 0,
        toolErrorCategories: {},
        assistantResponseSeconds: [],
        userReplySeconds: [],
        userInterruptions: 0,
        messageHours: {},
        featureUsage: {},
      },
    },
  ];

  const facets: SessionFacet[] = [
    {
      session_id: "a",
      cli_tool: "codex",
      underlying_goal: "Fix auth",
      brief_summary: "Fixed auth issue.",
      goal_categories: { bug_fix: 1 },
      outcome: "fully_achieved",
      session_type: "single_task",
      friction_counts: {},
      user_satisfaction: "high",
      project_path: "/tmp/project-a",
      project_area: "product_surface",
      notable_tools: ["exec_command", "apply_patch"],
      dominant_languages: ["typescript"],
      wins: ["Fast direct edits"],
      frictions: ["One shell retry"],
      recommended_next_step: "Keep batching shell inspection before edits.",
    },
    {
      session_id: "b",
      cli_tool: "codex",
      underlying_goal: "Add report",
      brief_summary: "Added report export.",
      goal_categories: { feature: 1 },
      outcome: "mostly_achieved",
      session_type: "iterative",
      friction_counts: { retry: 1 },
      user_satisfaction: "medium",
      project_path: "/tmp/project-b",
      project_area: "delivery_ops",
      notable_tools: ["exec_command"],
      dominant_languages: ["markdown", "json"],
      wins: ["Shipped report export"],
      frictions: ["One retry on formatting"],
      recommended_next_step: "Automate release notes generation.",
    },
  ];

  const stats = aggregateFacets(facets, sessions, {
    sourceCli: "codex",
    analyzerCli: "codex",
    totalScannedSessions: 5,
    totalEligibleSessions: 3,
    cachedFacetSessions: 1,
    failedFacetSessions: 1,
    deferredFacetSessions: 0,
  });

  assert.equal(stats.totalSessions, 2);
  assert.equal(stats.totalMessages, 14);
  assert.equal(stats.totalDurationMinutes, 18);
  assert.equal(stats.totalScannedSessions, 5);
  assert.equal(stats.totalEligibleSessions, 3);
  assert.equal(stats.cachedFacetSessions, 1);
  assert.equal(stats.failedFacetSessions, 1);
  assert.equal(stats.sourceCli, "codex");
  assert.equal(stats.analyzerCli, "codex");
  assert.equal(stats.totalInputTokens, 1_600);
  assert.equal(stats.totalOutputTokens, 650);
  assert.equal(stats.totalCachedInputTokens, 100);
  assert.equal(stats.totalReasoningTokens, 120);
  assert.equal(stats.totalGitCommits, 1);
  assert.equal(stats.totalGitPushes, 1);
  assert.equal(stats.totalFilesModified, 6);
  assert.equal(stats.totalLinesAdded, 90);
  assert.equal(stats.totalLinesRemoved, 23);
  assert.equal(stats.totalUserInterruptions, 1);
  assert.equal(stats.toolBreakdown.exec_command, 7);
  assert.equal(stats.toolBreakdown.apply_patch, 2);
  assert.equal(stats.languageBreakdown.typescript, 3);
  assert.equal(stats.languageBreakdown.markdown, 1);
  assert.equal(stats.projectAreaBreakdown.product_surface, 1);
  assert.equal(stats.projectAreaBreakdown.delivery_ops, 1);
  assert.equal(stats.toolErrorBreakdown.shell, 1);
  assert.equal(stats.featureUsageBreakdown.apply_patch, 1);
  assert.equal(stats.featureUsageBreakdown.plan_updates, 1);
  assert.equal(stats.featureUsageBreakdown.shell, 1);
  assert.equal(stats.messageHourBreakdown["09"], 6);
  assert.equal(stats.responseTimeBreakdown["under_30s"], 1);
  assert.equal(stats.responseTimeBreakdown["30s_to_2m"], 2);
  assert.equal(stats.userReplyBreakdown["under_2m"], 2);
  assert.equal(stats.userReplyBreakdown["2m_to_10m"], 1);
  assert.equal(stats.averageAssistantResponseSeconds, 32);
  assert.equal(stats.averageUserReplySeconds, 90);
});

test("buildTranscriptWindow keeps head, middle, and tail context for long transcripts", () => {
  const parts = [
    "user: start bug report",
    "assistant: inspect files",
    "assistant tool: exec_command rg --files src",
    "user: try another approach",
    "assistant: applying patch",
    "assistant tool: apply_patch package.json",
    "user: please verify and release",
    "assistant: finished release notes",
  ];

  const excerpt = buildTranscriptWindow(parts, 80);

  assert.match(excerpt, /start bug report/);
  assert.match(excerpt, /try another approach|applying patch/);
  assert.match(excerpt, /finished release notes/);
  assert.match(excerpt, /\[\.\.\. transcript condensed \.\.\.\]/);
});

test("parseStructuredSection extracts JSON and validates required fields", () => {
  const parsed = parseStructuredSection(
    "atAGlance",
    "```json\n{\"headline\":\"Shipping velocity is high\",\"bullets\":[\"You batch edits well\",\"Most sessions end in working code\"]}\n```",
  );

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.headline, "Shipping velocity is high");
    assert.deepEqual(parsed.value.bullets, [
      "You batch edits well",
      "Most sessions end in working code",
    ]);
  }

  const invalid = parseStructuredSection(
    "atAGlance",
    "{\"headline\":\"Missing bullets\"}",
  );
  assert.equal(invalid.ok, false);
});

test("buildDeterministicAtAGlance summarizes stats when AI output is unavailable", () => {
  const summary = buildDeterministicAtAGlance({
    sourceCli: "claude",
    analyzerCli: "claude",
    totalScannedSessions: 8,
    totalEligibleSessions: 6,
    cachedFacetSessions: 3,
    failedFacetSessions: 1,
    deferredFacetSessions: 0,
    totalSessions: 5,
    totalMessages: 42,
    totalDurationMinutes: 180,
    totalInputTokens: 12_000,
    totalOutputTokens: 7_500,
    totalCachedInputTokens: 3_000,
    totalReasoningTokens: 1_100,
    totalGitCommits: 2,
    totalGitPushes: 1,
    totalFilesModified: 14,
    totalLinesAdded: 320,
    totalLinesRemoved: 90,
    totalUserInterruptions: 1,
    averageAssistantResponseSeconds: 48,
    averageUserReplySeconds: 240,
    cliBreakdown: { claude: 5 },
    outcomeBreakdown: { fully_achieved: 3, mostly_achieved: 2 },
    sessionTypeBreakdown: { iterative: 3, single_task: 2 },
    goalCategories: { feature: 3, bug_fix: 2 },
    frictionCounts: { retry: 2 },
    satisfactionBreakdown: { high: 3, medium: 2 },
    projectBreakdown: { termcanvas: 4, website: 1 },
    projectAreaBreakdown: { product_surface: 3, release_ops: 2 },
    toolBreakdown: { Bash: 12, Edit: 6 },
    languageBreakdown: { typescript: 8, markdown: 2 },
    modelBreakdown: { "claude-opus-4-6": 5 },
    toolErrorBreakdown: { network: 1 },
    messageHourBreakdown: { "09": 10, "10": 8 },
    responseTimeBreakdown: { under_30s: 2, "30s_to_2m": 3 },
    userReplyBreakdown: { under_2m: 1, "2m_to_10m": 4 },
    featureUsageBreakdown: { web_search: 3, web_fetch: 2 },
  });

  assert.match(summary.headline, /claude/i);
  assert.equal(summary.bullets.length, 4);
  assert.match(summary.bullets.join("\n"), /feature|bug/i);
});
