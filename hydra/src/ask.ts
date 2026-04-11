import { spawn } from "node:child_process";
import type { AgentType } from "./assignment/types.ts";

/**
 * Lead → completed node follow-up.
 *
 * `askFollowUp` spawns a one-shot non-interactive CLI subprocess that
 * resumes the node's previous session and sends a new user message on
 * top of it. It is the subprocess-native dual of `hydra reset --feedback`:
 *   - reset kills the worker, loses its session context, and re-dispatches
 *     a fresh subprocess from task.md
 *   - askFollowUp preserves the worker's session (via claude's
 *     --resume --fork-session or codex's `exec resume`) and injects a
 *     new user turn without touching any orchestration state
 *
 * Use askFollowUp when the Lead just needs an answer to a question about
 * what the worker did. Use reset when the Lead needs the worker to redo
 * work with new guidance.
 *
 * CLI mapping (ground truth verified in subprocess-worker.ts + the spike):
 *   claude: `claude -p --output-format json --resume <sid> --fork-session <msg>`
 *     - `--fork-session` branches off a new session id, leaving the
 *       original session file pristine. Lead + Reviewer can ask questions
 *       without polluting Dev's canonical history.
 *   codex:  `codex exec resume <sid> --json --skip-git-repo-check --cd <workdir> <msg>`
 *     - codex has no headless fork today (openai/codex#13537 unmerged).
 *       The follow-up appends to the original session — the asymmetry
 *       is documented and accepted.
 */

export interface AskFollowUpOptions {
  cli: AgentType;
  sessionId: string;
  message: string;
  /**
   * Absolute path to run the subprocess in. For codex this is also
   * passed as --cd so codex's agent workspace root matches.
   */
  workdir: string;
  /**
   * Upper bound on subprocess wall-clock duration. Defaults to 5 minutes,
   * which is long enough for realistic Q&A but short enough to not hang
   * Lead forever if the subprocess wedges.
   */
  timeoutMs?: number;
  /**
   * Test seam: override spawn. Defaults to node:child_process.spawn.
   */
  spawnImpl?: typeof spawn;
}

export interface AskFollowUpResult {
  answer: string;
  /**
   * The resulting session id after the follow-up. For claude with
   * --fork-session this is a new forked id. For codex this is the
   * same as the input session_id (no fork).
   */
  newSessionId: string | null;
  durationMs: number;
  /** Raw exit code from the subprocess. Callers can log it for audit. */
  exitCode: number | null;
}

function buildAskArgv(
  cli: AgentType,
  sessionId: string,
  message: string,
  workdir: string,
): { shell: string; args: string[] } {
  if (cli === "claude") {
    return {
      shell: "claude",
      args: [
        "-p",
        "--output-format", "json",
        "--dangerously-skip-permissions",
        "--resume", sessionId,
        "--fork-session",
        message,
      ],
    };
  }

  if (cli === "codex") {
    return {
      shell: "codex",
      args: [
        "exec", "resume", sessionId,
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "--cd", workdir,
        "--json",
        message,
      ],
    };
  }

  throw Object.assign(
    new Error(
      `hydra ask supports only claude|codex sessions, got: ${cli}`,
    ),
    { errorCode: "ASK_UNSUPPORTED_CLI", status: 400 },
  );
}

function parseClaudeAnswer(stdout: string): {
  answer: string;
  newSessionId: string | null;
} {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: unknown;
      session_id?: unknown;
    };
    return {
      answer: typeof parsed.result === "string" ? parsed.result : "",
      newSessionId:
        typeof parsed.session_id === "string" ? parsed.session_id : null,
    };
  } catch {
    return { answer: "", newSessionId: null };
  }
}

function parseCodexAnswer(
  stdout: string,
  fallbackSessionId: string,
): { answer: string; newSessionId: string | null } {
  // codex --json emits newline-delimited events. Final assistant text
  // lives in item.completed events whose flattened item has
  // type === "agent_message" (AgentMessageItem.text). We filter out
  // reasoning items since those are internal thinking, not the reply.
  const messages: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: unknown;
        item?: { type?: unknown; text?: unknown };
      };
      if (
        parsed.type === "item.completed" &&
        parsed.item &&
        parsed.item.type === "agent_message" &&
        typeof parsed.item.text === "string"
      ) {
        messages.push(parsed.item.text);
      }
    } catch {
      // skip
    }
  }
  return {
    answer: messages.join("\n"),
    newSessionId: fallbackSessionId, // codex has no fork — session id unchanged
  };
}

export async function askFollowUp(
  options: AskFollowUpOptions,
): Promise<AskFollowUpResult> {
  if (options.cli !== "claude" && options.cli !== "codex") {
    throw Object.assign(
      new Error(
        `hydra ask supports only claude|codex, got: ${options.cli}`,
      ),
      { errorCode: "ASK_UNSUPPORTED_CLI", status: 400 },
    );
  }

  const { shell, args } = buildAskArgv(
    options.cli,
    options.sessionId,
    options.message,
    options.workdir,
  );
  const spawnFn = options.spawnImpl ?? spawn;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const start = Date.now();

  return await new Promise<AskFollowUpResult>((resolve, reject) => {
    const child = spawnFn(shell, args, {
      cwd: options.workdir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let resolved = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (result: AskFollowUpResult): void => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const fail = (err: Error): void => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      reject(err);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err: Error) => {
      fail(
        Object.assign(
          new Error(`hydra ask subprocess failed to spawn: ${err.message}`),
          { errorCode: "ASK_SPAWN_FAILED", stderr: stderrChunks.join("") },
        ),
      );
    });

    child.on("exit", (exitCode: number | null) => {
      const durationMs = Date.now() - start;
      const stdout = stdoutChunks.join("");
      const parsed = options.cli === "claude"
        ? parseClaudeAnswer(stdout)
        : parseCodexAnswer(stdout, options.sessionId);
      finish({
        answer: parsed.answer,
        newSessionId: parsed.newSessionId,
        durationMs,
        exitCode,
      });
    });

    timer = setTimeout(() => {
      try {
        child.kill("SIGHUP");
      } catch {}
      fail(
        Object.assign(
          new Error(`hydra ask timed out after ${timeoutMs}ms`),
          { errorCode: "ASK_TIMEOUT" },
        ),
      );
    }, timeoutMs);
  });
}
