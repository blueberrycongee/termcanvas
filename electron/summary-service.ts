import fs from "fs";
import { spawn } from "child_process";
import { buildLaunchSpec } from "./pty-launch";
import { resolveSessionFile } from "./session-watcher";

type SummaryCli = "claude" | "codex";
type SessionType = "claude" | "codex";
type Locale = "en" | "zh";

interface SummaryInput {
  terminalId: string;
  sessionId: string;
  sessionType: SessionType;
  cwd: string;
  summaryCli: SummaryCli;
  locale: Locale;
}

interface SummaryResult {
  ok: boolean;
  summary?: string;
  error?: string;
  sessionFileSize?: number;
}

const TIMEOUT_MS = 30_000;
const inFlight = new Set<string>();

const LOCALE_PROMPTS: Record<Locale, string> = {
  en: "Summarize what this session is working on in exactly ONE short sentence (under 60 characters, in English). Output ONLY the summary sentence, nothing else.",
  zh: "用一句简短的中文总结这个会话正在做什么（不超过30个字）。只输出总结本身，不要输出任何其他内容。",
};

async function invokeSummaryCli(
  cliTool: SummaryCli,
  sessionId: string,
  prompt: string,
  cwd: string,
): Promise<string> {
  const spec = await buildLaunchSpec({ cwd, shell: cliTool });

  const cliArgs =
    cliTool === "claude"
      ? [
          "--resume", sessionId,
          "-p", prompt,
          "--max-turns", "1",
          "--no-session-persistence",
          "--output-format", "text",
        ]
      : [
          "exec", "resume", sessionId,
          "--skip-git-repo-check",
          "--ephemeral",
          prompt,
        ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(spec.file, [...spec.args, ...cliArgs], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error("Summary CLI timed out"));
        return;
      }
      if (code !== 0 && code !== null) {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
        reject(new Error(`Summary CLI exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.end();
  });
}

export async function generateSummary(
  input: SummaryInput,
): Promise<SummaryResult> {
  const { terminalId, sessionId, sessionType, cwd, summaryCli, locale } = input;
  const tag = `[Summary ${terminalId.slice(0, 8)}]`;

  if (inFlight.has(terminalId)) {
    console.log(`${tag} skipped: already in flight`);
    return { ok: false, error: "Summary already in progress for this terminal" };
  }

  console.log(`${tag} resolving session file: sessionId=${sessionId} type=${sessionType} cwd=${cwd}`);
  const sessionFile = resolveSessionFile(sessionId, sessionType, cwd);
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    console.warn(`${tag} session file not found: ${sessionFile ?? "null"}`);
    return { ok: false, error: "Session file not found" };
  }
  const fileSize = fs.statSync(sessionFile).size;
  console.log(`${tag} session file: ${sessionFile} (${fileSize} bytes)`);

  inFlight.add(terminalId);
  try {
    const prompt = LOCALE_PROMPTS[locale] ?? LOCALE_PROMPTS.en;
    console.log(`${tag} invoking ${summaryCli} --resume ${sessionId} (locale=${locale})...`);

    const raw = await invokeSummaryCli(summaryCli, sessionId, prompt, cwd);
    const summary = raw.trim().replace(/\n+/g, " ").slice(0, 120);

    if (!summary) {
      console.warn(`${tag} CLI returned empty response`);
      return { ok: false, error: "CLI returned empty response" };
    }

    console.log(`${tag} success: "${summary}"`);
    return { ok: true, summary, sessionFileSize: fileSize };
  } catch (err) {
    console.error(`${tag} failed:`, err);
    return { ok: false, error: String(err) };
  } finally {
    inFlight.delete(terminalId);
  }
}
