import type { SearchResult } from "../../stores/searchStore";
import { fuzzyScore } from "../../utils/fuzzyScore";
import { useProjectStore } from "../../stores/projectStore";
import { useLeftPanelRepoStore } from "../../stores/leftPanelRepoStore";
import { getActionDefs } from "./searchActions";

const MAX_RESULTS = 50;

const CATEGORY_BOOST: Record<string, number> = {
  action: 1.2,
  terminal: 1.1,
  file: 1.0,
  "git-branch": 0.95,
  "git-commit": 0.9,
  memory: 0.9,
  session: 1.15, // sessions are the star of Cmd+K; rank them above most
};

/**
 * Synchronous tier-1 search: runs on every keystroke against in-memory
 * data. Covers everything that doesn't need IPC (actions, terminals,
 * git branches, git commits). Sessions live in a separate async pass
 * that calls `search:sessions:list` and fuzzy-matches against the
 * first user prompt — see `collectSessionResults` below.
 */
export function collectSyncResults(
  query: string,
  t: Record<string, unknown>,
): SearchResult[] {
  if (!query.trim()) return [];

  const results: SearchResult[] = [];

  // ── Actions ──
  for (const action of getActionDefs()) {
    const title = (t[action.titleKey] as string) ?? action.id;
    const score = fuzzyScore(title, query, action.keywords) * (CATEGORY_BOOST.action ?? 1);
    if (score > 0) {
      results.push({
        id: `action:${action.id}`,
        category: "action",
        title,
        subtitle: "",
        score,
        data: { type: "action", actionId: action.id, perform: action.perform },
      });
    }
  }

  // ── Terminals ──
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const term of w.terminals) {
        const label = term.customTitle || term.title || term.type;
        const score = fuzzyScore(label, query, [term.type, p.name, w.name]) * (CATEGORY_BOOST.terminal ?? 1);
        if (score > 0) {
          results.push({
            id: `terminal:${term.id}`,
            category: "terminal",
            title: label,
            subtitle: `${p.name} / ${w.name}`,
            score,
            data: { type: "terminal", terminalId: term.id },
          });
        }
      }
    }
  }

  // ── Git branches & commits ──
  const gitLogByPath = useLeftPanelRepoStore.getState().gitLogByPath;
  for (const [worktreePath, cache] of Object.entries(gitLogByPath)) {
    if (!cache.loaded) continue;

    for (const branch of cache.branches) {
      if (branch.isRemote) continue;
      const score = fuzzyScore(branch.name, query) * (CATEGORY_BOOST["git-branch"] ?? 1);
      if (score > 0) {
        results.push({
          id: `git-branch:${branch.name}`,
          category: "git-branch",
          title: branch.name,
          subtitle: branch.isCurrent ? "current" : "",
          score,
          data: { type: "git-branch", name: branch.name, worktreePath },
        });
      }
    }

    const commits = cache.logEntries.slice(0, 100);
    for (const c of commits) {
      const score = fuzzyScore(c.message, query, [c.hash.slice(0, 7), c.author]) * (CATEGORY_BOOST["git-commit"] ?? 1);
      if (score > 0) {
        results.push({
          id: `git-commit:${c.hash}`,
          category: "git-commit",
          title: c.message,
          subtitle: `${c.hash.slice(0, 7)} · ${c.author}`,
          score,
          data: { type: "git-commit", hash: c.hash, worktreePath },
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

interface SessionIndexEntry {
  sessionId: string;
  provider: "claude" | "codex";
  projectDir: string;
  filePath: string;
  firstPrompt: string;
  startedAt: string;
  lastActivityAt: string;
  estimatedMessageCount: number;
  fileSize: number;
}

/**
 * Human-friendly relative-age formatter. Short + mono-glyph-count
 * values so subtitle layout stays stable across rows.
 */
function formatRelativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function titleForProjectDir(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

/**
 * Fetches the session index for the given project set, fuzzy-matches
 * the query against each session's first prompt, and returns ranked
 * results. When query is empty, returns the most-recent sessions
 * unranked — supports the "just opened Cmd+K, haven't typed yet, show
 * me my last 20 sessions" UX.
 */
export async function collectSessionResults(
  query: string,
  projectDirs: string[],
): Promise<SearchResult[]> {
  if (!window.termcanvas?.search?.listSessions) return [];
  if (projectDirs.length === 0) return [];

  let entries: SessionIndexEntry[];
  try {
    entries = await window.termcanvas.search.listSessions(projectDirs);
  } catch {
    return [];
  }

  const results: SearchResult[] = [];
  const trimmed = query.trim();

  for (const e of entries) {
    const titleText = e.firstPrompt || `(session ${e.sessionId.slice(0, 8)})`;
    const projectName = titleForProjectDir(e.projectDir);
    const age = formatRelativeAge(e.lastActivityAt);
    const subtitle = [projectName, e.provider, age, `${e.estimatedMessageCount} msgs`]
      .filter(Boolean)
      .join(" · ");

    if (trimmed) {
      const score = fuzzyScore(titleText, trimmed, [
        e.sessionId.slice(0, 8),
        e.provider,
        projectName,
      ]) * (CATEGORY_BOOST.session ?? 1);
      if (score <= 0) continue;
      results.push({
        id: `session:${e.sessionId}`,
        category: "session",
        title: titleText,
        subtitle,
        score,
        data: { type: "session", filePath: e.filePath },
      });
    } else {
      // No query — use a recency-based score so recent sessions float
      // to the top of the "empty state" list.
      const ageMs = Date.now() - new Date(e.lastActivityAt).getTime();
      const recency = Math.max(0, 1 - ageMs / (30 * 24 * 60 * 60 * 1000));
      results.push({
        id: `session:${e.sessionId}`,
        category: "session",
        title: titleText,
        subtitle,
        score: 0.5 + recency * 0.5,
        data: { type: "session", filePath: e.filePath },
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

/**
 * Asynchronous tier-2 search: file content and session JSONL content
 * search via IPC. Only called when query.length >= 3 AND the sync
 * tier didn't turn up much — gates the expensive grep behind a signal
 * that the user genuinely needs deep search.
 */
export async function collectAsyncResults(
  query: string,
  projectDirs?: string[],
): Promise<SearchResult[]> {
  if (!window.termcanvas?.search) return [];

  const results: SearchResult[] = [];

  try {
    // File search is scoped to the first project's first worktree if
    // a scope is provided — the whole canvas is not a single rg
    // target. If no scope, skip file content entirely (used to
    // silently fail with an empty worktreePath; explicit no-op is
    // clearer).
    const worktreeToSearch = projectDirs?.[0];

    const promises: Promise<unknown>[] = [
      window.termcanvas.search.sessionContents(query),
    ];
    if (worktreeToSearch) {
      promises.push(window.termcanvas.search.fileContents(query, worktreeToSearch));
    }

    const settled = await Promise.allSettled(promises);
    const sessionResults = settled[0];
    const fileResults = worktreeToSearch ? settled[1] : null;

    if (
      fileResults &&
      fileResults.status === "fulfilled" &&
      Array.isArray(fileResults.value)
    ) {
      for (const m of fileResults.value as Array<{
        filePath: string;
        line: number;
        preview: string;
      }>) {
        results.push({
          id: `file-content:${m.filePath}:${m.line}`,
          category: "file",
          title: m.filePath.split("/").pop() ?? m.filePath,
          subtitle: `L${m.line}: ${m.preview.slice(0, 80)}`,
          score: 0.5,
          data: { type: "file", filePath: m.filePath },
        });
      }
    }

    if (
      sessionResults.status === "fulfilled" &&
      Array.isArray(sessionResults.value)
    ) {
      for (const m of sessionResults.value as Array<{
        sessionId: string;
        filePath: string;
        lineNumber: number;
        preview: string;
      }>) {
        results.push({
          id: `session-content:${m.sessionId}:${m.lineNumber}`,
          category: "session",
          title: `"${m.preview.slice(0, 80)}"`,
          subtitle: `content match · line ${m.lineNumber}`,
          score: 0.45,
          data: { type: "session", filePath: m.filePath },
        });
      }
    }
  } catch {
    // Async search failures are non-fatal.
  }

  return results;
}
