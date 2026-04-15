import type { SearchResult } from "../../stores/searchStore";
import { fuzzyScore } from "../../utils/fuzzyScore";
import { useProjectStore } from "../../stores/projectStore";
import { useLeftPanelRepoStore } from "../../stores/leftPanelRepoStore";
import { useSessionStore } from "../../stores/sessionStore";
import { getActionDefs } from "./searchActions";

const MAX_RESULTS = 50;

const CATEGORY_BOOST: Record<string, number> = {
  action: 1.2,
  terminal: 1.1,
  file: 1.0,
  "git-branch": 0.95,
  "git-commit": 0.9,
  memory: 0.9,
  session: 0.85,
};

/**
 * Synchronous tier-1 search: runs on every keystroke against in-memory data.
 * Returns results sorted by score descending, capped at MAX_RESULTS.
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

  // ── Git commits ──
  const gitLogByPath = useLeftPanelRepoStore.getState().gitLogByPath;
  for (const [worktreePath, cache] of Object.entries(gitLogByPath)) {
    if (!cache.loaded) continue;

    // Branches
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

    // Commits (limit to first 100 for performance)
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

  // ── Sessions ──
  const { liveSessions, historySessions } = useSessionStore.getState();
  const allSessions = [...liveSessions, ...historySessions];
  for (const s of allSessions) {
    const label = s.projectDir || s.sessionId;
    const score = fuzzyScore(label, query, [s.sessionId, s.status]) * (CATEGORY_BOOST.session ?? 1);
    if (score > 0) {
      results.push({
        id: `session:${s.sessionId}`,
        category: "session",
        title: label,
        subtitle: `${s.messageCount} msgs · ${s.status}`,
        score,
        data: { type: "session", filePath: s.filePath },
      });
    }
  }

  // Sort and cap
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

/**
 * Asynchronous tier-2 search: file content and session content search via IPC.
 * Only called when query.length >= 3.
 */
export async function collectAsyncResults(query: string): Promise<SearchResult[]> {
  if (!window.termcanvas?.search) return [];

  const results: SearchResult[] = [];

  try {
    const [fileResults, sessionResults] = await Promise.allSettled([
      window.termcanvas.search.fileContents(query),
      window.termcanvas.search.sessionContents(query),
    ]);

    if (fileResults.status === "fulfilled" && fileResults.value) {
      for (const m of fileResults.value) {
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

    if (sessionResults.status === "fulfilled" && sessionResults.value) {
      for (const m of sessionResults.value) {
        results.push({
          id: `session-content:${m.sessionId}:${m.lineNumber}`,
          category: "session",
          title: m.sessionId.slice(0, 8),
          subtitle: m.preview.slice(0, 100),
          score: 0.45,
          data: { type: "session", filePath: m.filePath },
        });
      }
    }
  } catch {
    // Async search failures are non-fatal
  }

  return results;
}
